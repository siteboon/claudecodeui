import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb, userDb, userPreferencesDb } from '@/modules/database/index.js';
import { generateClaudeSessionTitle } from '@/modules/providers/list/claude/claude-title.provider.js';
import { scheduleSessionTitleGeneration, type SessionTitleRequest } from '@/modules/providers/services/session-title.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import type { LLMProvider } from '@/shared/index.js';

/**
 * A session is created with a truncated first message and renamed by the model
 * a moment later. These cover the three rules around that rename: it replaces
 * the placeholder, it never replaces a name the user typed, and it does not run
 * for a provider with no query path.
 */

async function withIsolatedDatabase(runTest: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'session-title-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** Waits for the background rename to land, which the scheduler does not await. */
async function waitForStoredName(sessionId: string, expected: string): Promise<string | null | undefined> {
  const deadline = Date.now() + 2_000;
  let current = sessionsDb.getSessionById(sessionId)?.custom_name;
  while (current !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    current = sessionsDb.getSessionById(sessionId)?.custom_name;
  }
  return current;
}

test('the model title replaces the truncated first message', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('session-title-1', 'claude', '/tmp/session-title-project', '聊天会话加载延时问题：在有 queue 会话的情况');

    scheduleSessionTitleGeneration({
      sessionId: 'session-title-1',
      provider: 'claude',
      projectPath: '/tmp/session-title-project',
      firstMessage: '聊天会话加载延时问题：在有 queue 会话的情况',
      initialName: '聊天会话加载延时问题：在有 queue 会话的情况',
    }, { generate: async () => '排队会话实时显示' });

    assert.equal(await waitForStoredName('session-title-1', '排队会话实时显示'), '排队会话实时显示');
  });
});

test('a name the user already typed is left alone', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('session-title-2', 'claude', '/tmp/session-title-project', '会议纪要');
    sessionsDb.updateSessionCustomName('session-title-2', '我自己起的名字');

    scheduleSessionTitleGeneration({
      sessionId: 'session-title-2',
      provider: 'claude',
      projectPath: '/tmp/session-title-project',
      firstMessage: '把这段会议纪要整理成行动项',
      initialName: '会议纪要',
    }, { generate: async () => '整理会议行动项' });

    await waitForStoredName('session-title-2', '整理会议行动项');
    // The rename arrived late and must not overwrite the user's own name.
    assert.equal(sessionsDb.getSessionById('session-title-2')?.custom_name, '我自己起的名字');
  });
});

test('providers without a query path are never asked', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('session-title-3', 'codex', '/tmp/session-title-project', '排查构建失败');

    let called = 0;
    scheduleSessionTitleGeneration({
      sessionId: 'session-title-3',
      provider: 'codex' as LLMProvider,
      projectPath: '/tmp/session-title-project',
      firstMessage: '排查构建失败',
      initialName: '排查构建失败',
    }, { generate: async () => { called += 1; return '构建失败排查'; } });

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(called, 0);
    assert.equal(sessionsDb.getSessionById('session-title-3')?.custom_name, '排查构建失败');
  });
});

test('a failed naming leaves the truncated name in place', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('session-title-4', 'claude', '/tmp/session-title-project', '重构登录流程');

    scheduleSessionTitleGeneration({
      sessionId: 'session-title-4',
      provider: 'claude',
      projectPath: '/tmp/session-title-project',
      firstMessage: '重构登录流程',
      initialName: '重构登录流程',
    }, { generate: async () => null });

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(sessionsDb.getSessionById('session-title-4')?.custom_name, '重构登录流程');
  });
});

test('title generation strips mode emojis, quotes, and prefixes without chopping into an ellipsis', async () => {
  const seenSettings: Array<Record<string, unknown>> = [];
  const title = await generateClaudeSessionTitle(
    '微信小程序支付能力获取，需要申请什么？调研一下。',
    {
      runPrompt: async ({ settings }) => {
        seenSettings.push(settings as Record<string, unknown>);
        return '标题：🔍 「红包发放资质调研」...';
      },
    },
  );

  assert.equal(title, '红包发放资质调研');
  assert.equal(seenSettings.length, 1);
  assert.equal(seenSettings[0]?.alwaysThinkingEnabled, false);
  assert.equal(seenSettings[0]?.disableAllHooks, true);
});

test('a Chinese message under ten characters still gets an AI title when its width exceeds the greeting floor', async () => {
  let called = 0;
  const title = await generateClaudeSessionTitle('帮我看看这个怎么修', {
    runPrompt: async () => {
      called += 1;
      return '排查并修复问题';
    },
  });

  assert.equal(called, 1);
  assert.equal(title, '排查并修复问题');
  assert.equal(await generateClaudeSessionTitle('你好', {
    runPrompt: async () => {
      called += 1;
      return '不该调用';
    },
  }), null);
  assert.equal(called, 1);
});

test('an over-budget model title is tightened in one follow-up rather than truncated with an ellipsis', async () => {
  const prompts: string[] = [];
  const title = await generateClaudeSessionTitle(
    '微信红包支付能力获取，需要申请什么，小程序和服务号有区别吗？',
    {
      runPrompt: async ({ prompt }) => {
        prompts.push(prompt);
        if (prompts.length === 1) {
          return '微信红包支付能力申请调研';
        }
        return '微信红包资质调研';
      },
    },
  );

  assert.equal(prompts.length, 2);
  assert.equal(title, '微信红包资质调研');
});

test('title generation falls back to the caller model when the small model fails or leaks tool XML', async () => {
  const triedModels: Array<string | undefined> = [];
  const title = await generateClaudeSessionTitle(
    'Investigate why websocket reconnection drops pending attention badges',
    {
      model: 'claude-sonnet-4-5',
      runPrompt: async ({ model }) => {
        triedModels.push(model);
        if (model === 'haiku') {
          return '<｜DSML｜ calls><｜DSML｜ invoke name="bash">';
        }
        if (model === 'claude-sonnet-4-5') {
          return 'WS perm loss';
        }
        return null;
      },
    },
  );

  assert.deepEqual(triedModels, ['haiku', 'claude-sonnet-4-5']);
  assert.equal(title, 'WS perm loss');
});

test('scheduleSessionTitleGeneration forwards the session model as fallback', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('session-title-model', 'claude', '/tmp/session-title-project', '调查红包发放资质…');
    let forwardedModel: string | undefined;

    scheduleSessionTitleGeneration({
      sessionId: 'session-title-model',
      provider: 'claude',
      projectPath: '/tmp/session-title-project',
      firstMessage: '调查红包发放资质需要什么手续',
      initialName: '调查红包发放资质…',
      model: 'claude-sonnet-4-5',
    }, {
      generate: async (_firstMessage, opts) => {
        forwardedModel = opts?.model;
        return '红包资质调研';
      },
    });

    assert.equal(await waitForStoredName('session-title-model', '红包资质调研'), '红包资质调研');
    assert.equal(forwardedModel, 'claude-sonnet-4-5');
  });
});

test('createAppSession resolves stored chatDefaults model as title fallback for the user', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const user = userDb.createUser('title-user', 'hashed-password');
    const userId = Number(user.id);
    userPreferencesDb.savePreferences(userId, {
      chatDefaults: {
        claude: { model: 'claude-sonnet-4-5', effort: 'high' },
      },
    });

    const scheduled: SessionTitleRequest[] = [];
    const created = sessionsService.createAppSession(
      'claude',
      '/tmp/session-title-defaults',
      '帮我调研一下微信小程序发红包资质',
      {
        userId,
        scheduleTitle: (request) => {
          scheduled.push(request);
        },
      },
    );

    assert.ok(created.sessionId);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0]?.model, 'claude-sonnet-4-5');
  });
});

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { scheduleSessionTitleGeneration } from '@/modules/providers/services/session-title.service.js';
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

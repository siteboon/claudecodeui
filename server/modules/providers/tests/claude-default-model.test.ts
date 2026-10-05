import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import {
  CLAUDE_PREDEFINED_MODELS,
  hasClaudeCodeModelSetting,
} from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { ProviderRuntimeContext } from '@/shared/types.js';

/**
 * "Default (recommended)" has to run whatever Claude Code itself would run
 * (issue #1096). `--model default` pins the CLI's built-in default and
 * outranks a model the user configured for Claude Code (`ANTHROPIC_MODEL` or a
 * settings `model`), so with one configured the runtime must leave the flag
 * off. With nothing configured it keeps sending `default`, because a resume
 * without the flag would keep the session's last model.
 */

type Fixture = {
  /** Stands in for `~/.claude` through CLAUDE_CONFIG_DIR. */
  userDir: string;
  /** The project the run happens in. */
  cwd: string;
};

async function withFixture(runTest: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'claude-default-model-'));
  const fixture = { userDir: path.join(root, 'user'), cwd: path.join(root, 'project') };
  await mkdir(fixture.userDir, { recursive: true });
  await mkdir(path.join(fixture.cwd, '.claude'), { recursive: true });
  try {
    await runTest(fixture);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const writeJson = (filePath: string, value: unknown) => writeFile(filePath, JSON.stringify(value), 'utf8');

/** The reporter's setup: an OmniRoute combo set both ways in the user settings. */
const REPORTER_SETTINGS = {
  env: {
    ANTHROPIC_BASE_URL: 'http://omniroute.local:20128/v1',
    ANTHROPIC_MODEL: 'auto/coding',
    ANTHROPIC_CUSTOM_MODEL_OPTION: 'auto/coding',
  },
  model: 'auto/coding',
};

// ---------------------------------------------------------------------------
// hasClaudeCodeModelSetting
// ---------------------------------------------------------------------------

test('finds no model setting when nothing is configured', async () => {
  await withFixture(async ({ userDir, cwd }) => {
    await writeJson(path.join(userDir, 'settings.json'), {
      env: { ANTHROPIC_BASE_URL: 'http://omniroute.local:20128/v1' },
      effortLevel: 'medium',
    });

    assert.equal(await hasClaudeCodeModelSetting(cwd, { CLAUDE_CONFIG_DIR: userDir }), false);
  });
});

test('finds ANTHROPIC_MODEL in the environment the CLI inherits', async () => {
  await withFixture(async ({ userDir, cwd }) => {
    assert.equal(
      await hasClaudeCodeModelSetting(cwd, { CLAUDE_CONFIG_DIR: userDir, ANTHROPIC_MODEL: 'auto/coding' }),
      true,
    );
  });
});

test('finds a model in the user, project or local settings, as `model` or env.ANTHROPIC_MODEL', async () => {
  const cases: Array<[string, (fixture: Fixture) => string, Record<string, unknown>]> = [
    ['user model', ({ userDir }) => path.join(userDir, 'settings.json'), { model: 'auto/coding' }],
    ['user env', ({ userDir }) => path.join(userDir, 'settings.json'), { env: { ANTHROPIC_MODEL: 'auto/coding' } }],
    ['project model', ({ cwd }) => path.join(cwd, '.claude', 'settings.json'), { model: 'auto/coding' }],
    ['local env', ({ cwd }) => path.join(cwd, '.claude', 'settings.local.json'), { env: { ANTHROPIC_MODEL: 'auto/coding' } }],
  ];

  for (const [label, settingsPath, settings] of cases) {
    await withFixture(async (fixture) => {
      await writeJson(settingsPath(fixture), settings);
      assert.equal(
        await hasClaudeCodeModelSetting(fixture.cwd, { CLAUDE_CONFIG_DIR: fixture.userDir }),
        true,
        label,
      );
    });
  }
});

test('ignores "default", blank values and malformed settings files', async () => {
  await withFixture(async ({ userDir, cwd }) => {
    await writeJson(path.join(userDir, 'settings.json'), { model: 'default', env: { ANTHROPIC_MODEL: '  ' } });
    await writeFile(path.join(cwd, '.claude', 'settings.json'), '{ "model": ', 'utf8');

    assert.equal(
      await hasClaudeCodeModelSetting(cwd, { CLAUDE_CONFIG_DIR: userDir, ANTHROPIC_MODEL: 'Default' }),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// The model flag the runtime hands the SDK
// ---------------------------------------------------------------------------

type RunOptions = {
  model?: string;
  effort?: string;
  /** What the session row answers for a resumed session. */
  recordedModel?: string;
  /** The provider-native id of a session being resumed. */
  providerSessionId?: string;
};

/**
 * Runs one turn through `queryClaudeSDK` with a stand-in SDK and returns the
 * options the runtime built for it. The settings lookup reads the real process
 * env, so CLAUDE_CONFIG_DIR and ANTHROPIC_MODEL are pinned for the turn.
 */
async function captureSdkOptions(
  { userDir, cwd }: Fixture,
  runOptions: RunOptions,
  processAnthropicModel?: string,
): Promise<Record<string, unknown>> {
  const savedEnv = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL };
  process.env.CLAUDE_CONFIG_DIR = userDir;
  if (processAnthropicModel === undefined) {
    delete process.env.ANTHROPIC_MODEL;
  } else {
    process.env.ANTHROPIC_MODEL = processAnthropicModel;
  }

  let captured: Record<string, unknown> | null = null;
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => runOptions.providerSessionId ?? null,
    resolveResumeModel: async (_sessionId, requestedModel) => runOptions.recordedModel ?? requestedModel ?? undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery: ({ options }) => {
      captured = options as Record<string, unknown>;
      // A CLI that answers nothing and exits: the run winds down at once.
      return Object.assign((async function* () { /* no messages */ })(), { interrupt: async () => {} });
    },
  };

  try {
    const writer = { send: () => {}, userId: null };
    await queryClaudeSDK('hello', {
      sessionId: 'app-default-model-session',
      cwd,
      model: runOptions.model,
      effort: runOptions.effort,
    }, writer as never, context);
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  assert.ok(captured, 'expected the runtime to start an SDK query');
  return captured;
}

test('Default leaves the model flag off when the user settings pick a model (the reported OmniRoute setup)', async () => {
  await withFixture(async (fixture) => {
    await writeJson(path.join(fixture.userDir, 'settings.json'), REPORTER_SETTINGS);

    const options = await captureSdkOptions(fixture, { model: 'default', effort: 'medium' });

    assert.equal('model' in options, false, `expected no model flag, got ${String(options.model)}`);
    // Effort is still validated against the "Default" option and forwarded.
    assert.equal(options.effort, 'medium');
  });
});

test('Default leaves the model flag off for a project settings model or a process ANTHROPIC_MODEL', async () => {
  await withFixture(async (fixture) => {
    await writeJson(path.join(fixture.cwd, '.claude', 'settings.json'), { model: 'auto/coding' });
    const options = await captureSdkOptions(fixture, { model: 'default' });
    assert.equal('model' in options, false, `project settings: got ${String(options.model)}`);
  });

  await withFixture(async (fixture) => {
    const options = await captureSdkOptions(fixture, { model: 'default' }, 'auto/coding');
    assert.equal('model' in options, false, `process env: got ${String(options.model)}`);
  });
});

test('a resumed Default session follows the configured model instead of pinning the CLI default', async () => {
  await withFixture(async (fixture) => {
    await writeJson(path.join(fixture.userDir, 'settings.json'), REPORTER_SETTINGS);

    const options = await captureSdkOptions(fixture, {
      model: 'default',
      recordedModel: 'default',
      providerSessionId: 'native-session-1',
    });

    assert.equal(options.resume, 'native-session-1');
    assert.equal('model' in options, false, `expected no model flag, got ${String(options.model)}`);
  });
});

test('a caller that sends no model (/api/agent) also gets the configured model', async () => {
  await withFixture(async (fixture) => {
    await writeJson(path.join(fixture.userDir, 'settings.json'), { model: 'auto/coding' });

    const options = await captureSdkOptions(fixture, {});

    assert.equal('model' in options, false, `expected no model flag, got ${String(options.model)}`);
  });
});

test('Default still sends `default` when Claude Code has no model configured', async () => {
  await withFixture(async (fixture) => {
    await writeJson(path.join(fixture.userDir, 'settings.json'), { env: { ANTHROPIC_BASE_URL: 'http://x' } });

    const fresh = await captureSdkOptions(fixture, { model: 'default', effort: 'max' });
    assert.equal(fresh.model, 'default');
    assert.equal(fresh.effort, 'max');

    // A resume without the flag would keep the session's last model, so it stays explicit.
    const resumed = await captureSdkOptions(fixture, {
      model: 'default',
      recordedModel: 'default',
      providerSessionId: 'native-session-1',
    });
    assert.equal(resumed.model, 'default');
  });
});

test('an explicit picker choice still wins over the configured model', async () => {
  await withFixture(async (fixture) => {
    await writeJson(path.join(fixture.userDir, 'settings.json'), REPORTER_SETTINGS);

    const options = await captureSdkOptions(fixture, { model: 'sonnet', effort: 'xhigh' });

    assert.equal(options.model, 'sonnet');
    assert.equal(options.effort, 'xhigh');
  });
});

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import {
  CLAUDE_PREDEFINED_MODELS,
  resolveClaudeDefaultModelFlag,
} from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { ProviderRuntimeContext } from '@/shared/types.js';

/**
 * "Default (recommended)" has to run whatever Claude Code itself would run
 * (issue #1096). `--model default` pins the CLI's built-in default and outranks
 * a model the user configured for Claude Code. How the runtime avoids that
 * depends on where the model is configured, because the CLI resumes sessions
 * differently for each:
 * - `ANTHROPIC_MODEL` also beats the session's last model on `--resume`, so the
 *   model flag is left off;
 * - a settings `model` loses to the session's last model on `--resume`, so its
 *   value is passed explicitly;
 * - with nothing configured the flag stays `default`.
 */

type Fixture = {
  /** Stands in for the user's home directory during runtime turns. */
  home: string;
  /** `~/.claude`, also passed as CLAUDE_CONFIG_DIR to the settings lookup. */
  userDir: string;
  /** The project the run happens in. */
  cwd: string;
};

async function withFixture(runTest: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'claude-default-model-'));
  const home = path.join(root, 'home');
  const fixture = { home, userDir: path.join(home, '.claude'), cwd: path.join(root, 'project') };
  await mkdir(fixture.userDir, { recursive: true });
  await mkdir(path.join(fixture.cwd, '.claude'), { recursive: true });
  try {
    await runTest(fixture);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const writeJson = (filePath: string, value: unknown) => writeFile(filePath, JSON.stringify(value), 'utf8');

const userSettings = ({ userDir }: Fixture) => path.join(userDir, 'settings.json');
const projectSettings = ({ cwd }: Fixture) => path.join(cwd, '.claude', 'settings.json');
const localSettings = ({ cwd }: Fixture) => path.join(cwd, '.claude', 'settings.local.json');

/** The reporter's setup: an OmniRoute combo set both ways in the user settings. */
const REPORTER_SETTINGS = {
  env: {
    ANTHROPIC_BASE_URL: 'http://omniroute.local:20128/v1',
    ANTHROPIC_MODEL: 'auto/coding',
    ANTHROPIC_CUSTOM_MODEL_OPTION: 'auto/coding',
  },
  model: 'auto/coding',
};

const resolveFlag = (fixture: Fixture, env: NodeJS.ProcessEnv = {}) =>
  resolveClaudeDefaultModelFlag(fixture.cwd, { CLAUDE_CONFIG_DIR: fixture.userDir, ...env });

// ---------------------------------------------------------------------------
// resolveClaudeDefaultModelFlag
// ---------------------------------------------------------------------------

test('keeps `default` when Claude Code has no model configured', async () => {
  await withFixture(async (fixture) => {
    await writeJson(userSettings(fixture), {
      env: { ANTHROPIC_BASE_URL: 'http://omniroute.local:20128/v1' },
      effortLevel: 'medium',
    });

    assert.equal(await resolveFlag(fixture), 'default');
  });
});

test('leaves the flag off for ANTHROPIC_MODEL in the inherited env or any settings env block', async () => {
  await withFixture(async (fixture) => {
    assert.equal(await resolveFlag(fixture, { ANTHROPIC_MODEL: 'auto/coding' }), undefined, 'process env');
  });

  const settingsFiles: Array<[string, (fixture: Fixture) => string]> = [
    ['user env', userSettings],
    ['project env', projectSettings],
    ['local env', localSettings],
  ];
  for (const [label, settingsPath] of settingsFiles) {
    await withFixture(async (fixture) => {
      await writeJson(settingsPath(fixture), { env: { ANTHROPIC_MODEL: 'auto/coding' } });
      assert.equal(await resolveFlag(fixture), undefined, label);
    });
  }
});

test('passes a settings `model` explicitly, local over project over user', async () => {
  const settingsFiles: Array<[string, (fixture: Fixture) => string]> = [
    ['user model', userSettings],
    ['project model', projectSettings],
    ['local model', localSettings],
  ];
  for (const [label, settingsPath] of settingsFiles) {
    await withFixture(async (fixture) => {
      await writeJson(settingsPath(fixture), { model: 'auto/coding' });
      assert.equal(await resolveFlag(fixture), 'auto/coding', label);
    });
  }

  await withFixture(async (fixture) => {
    await writeJson(userSettings(fixture), { model: 'user-model' });
    await writeJson(projectSettings(fixture), { model: 'project-model' });
    assert.equal(await resolveFlag(fixture), 'project-model');

    await writeJson(localSettings(fixture), { model: 'local-model' });
    assert.equal(await resolveFlag(fixture), 'local-model');
  });
});

test('ANTHROPIC_MODEL wins over a settings `model` from any file', async () => {
  await withFixture(async (fixture) => {
    await writeJson(userSettings(fixture), { model: 'user-model' });
    await writeJson(projectSettings(fixture), { env: { ANTHROPIC_MODEL: 'project-env' } });
    await writeJson(localSettings(fixture), { model: 'local-model' });

    assert.equal(await resolveFlag(fixture), undefined);
  });
});

test('ignores blank values and malformed or unreadable settings files', async () => {
  await withFixture(async (fixture) => {
    await writeJson(userSettings(fixture), { model: 'user-model' });
    await writeJson(projectSettings(fixture), { model: '  ', env: { ANTHROPIC_MODEL: ' ' } });
    await writeFile(localSettings(fixture), '{ "model": ', 'utf8');

    assert.equal(await resolveFlag(fixture, { ANTHROPIC_MODEL: '  ' }), 'user-model');
  });

  await withFixture(async (fixture) => {
    // A directory where the file should be cannot be read as JSON.
    await mkdir(userSettings(fixture));
    assert.equal(await resolveFlag(fixture), 'default');
  });
});

// The project can be a cloned repository, and the repository decides what its
// `.claude/settings*.json` are. The lookup runs before every "Default" turn, so
// reading a symlink to a FIFO would hold the turn (and a server fs thread) until
// something wrote to it. The CLI skips such files, and files over 2 MiB.
test('skips a FIFO, a device and an oversized file without waiting, as the CLI does', async (t) => {
  if (process.platform === 'win32') {
    t.skip('needs mkfifo and /dev/null');
    return;
  }

  await withFixture(async (fixture) => {
    await writeJson(userSettings(fixture), { model: 'user-model' });
    const fifoPath = path.join(fixture.cwd, 'settings.fifo');
    execFileSync('mkfifo', [fifoPath]);
    await symlink(fifoPath, projectSettings(fixture));
    await symlink('/dev/null', localSettings(fixture));
    // A lookup that opened the FIFO would read this model instead of blocking forever.
    const writer = spawn('sh', ['-c', `printf %s '{"model":"fifo-model"}' > "$0"`, fifoPath], { stdio: 'ignore' });
    try {
      const startedAt = Date.now();
      assert.equal(await resolveFlag(fixture), 'user-model');
      assert.ok(Date.now() - startedAt < 1000, 'the lookup waited for the FIFO');
    } finally {
      writer.kill();
    }
  });

  await withFixture(async (fixture) => {
    await writeJson(userSettings(fixture), { model: 'user-model' });
    await writeFile(projectSettings(fixture), `{"model":"oversized-model"}${' '.repeat(2 * 1024 * 1024)}`, 'utf8');
    assert.equal(await resolveFlag(fixture), 'user-model');
  });
});

test('reads settings saved with a byte order mark, as the CLI does', async () => {
  await withFixture(async (fixture) => {
    // Windows PowerShell and editors often write one; the CLI still applies the file.
    await writeFile(userSettings(fixture), `\uFEFF${JSON.stringify({ env: { ANTHROPIC_MODEL: 'auto/coding' } })}`, 'utf8');
    assert.equal(await resolveFlag(fixture), undefined, 'UTF-8 with BOM');
  });

  await withFixture(async (fixture) => {
    const text = `\uFEFF${JSON.stringify({ model: 'auto/coding' })}`;
    await writeFile(userSettings(fixture), Buffer.from(text, 'utf16le'));
    assert.equal(await resolveFlag(fixture), 'auto/coding', 'UTF-16LE with BOM');
  });
});

test('resolves a relative CLAUDE_CONFIG_DIR against the project, where the CLI runs', async () => {
  await withFixture(async (fixture) => {
    await mkdir(path.join(fixture.cwd, 'claude-config'));
    await writeJson(path.join(fixture.cwd, 'claude-config', 'settings.json'), { model: 'auto/coding' });

    assert.equal(await resolveFlag(fixture, { CLAUDE_CONFIG_DIR: 'claude-config' }), 'auto/coding');
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
 * options the runtime built for it. HOME and CLAUDE_CONFIG_DIR point at the
 * fixture, so the user settings come from `<home>/.claude` and nothing reads
 * the real home (on Windows os.homedir() ignores HOME), and ANTHROPIC_MODEL is
 * pinned for the turn.
 */
async function captureSdkOptions(
  { home, userDir, cwd }: Fixture,
  runOptions: RunOptions,
  processAnthropicModel?: string,
): Promise<Record<string, unknown>> {
  const pinnedEnv: Record<string, string | undefined> = {
    HOME: home,
    CLAUDE_CONFIG_DIR: userDir,
    ANTHROPIC_MODEL: processAnthropicModel,
  };
  const savedEnv = Object.fromEntries(Object.keys(pinnedEnv).map((key) => [key, process.env[key]]));
  const applyEnv = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

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

  applyEnv(pinnedEnv);
  try {
    const writer = { send: () => {}, userId: null };
    await queryClaudeSDK('hello', {
      sessionId: 'app-default-model-session',
      cwd,
      model: runOptions.model,
      effort: runOptions.effort,
    }, writer as never, context);
  } finally {
    applyEnv(savedEnv);
  }

  assert.ok(captured, 'expected the runtime to start an SDK query');
  return captured;
}

const RESUMED_DEFAULT: RunOptions = {
  model: 'default',
  recordedModel: 'default',
  providerSessionId: 'native-session-1',
};

test('Default leaves the model flag off for the reported OmniRoute setup (ANTHROPIC_MODEL + model)', async () => {
  await withFixture(async (fixture) => {
    await writeJson(userSettings(fixture), REPORTER_SETTINGS);

    const fresh = await captureSdkOptions(fixture, { model: 'default', effort: 'medium' });
    assert.equal('model' in fresh, false, `expected no model flag, got ${String(fresh.model)}`);
    // Effort is still validated against the "Default" option and forwarded.
    assert.equal(fresh.effort, 'medium');

    // ANTHROPIC_MODEL also beats the session's last model, so a resume needs no flag either.
    const resumed = await captureSdkOptions(fixture, RESUMED_DEFAULT);
    assert.equal(resumed.resume, 'native-session-1');
    assert.equal('model' in resumed, false, `expected no model flag on resume, got ${String(resumed.model)}`);
  });
});

test('Default passes a settings `model` explicitly, also when it resumes a session', async () => {
  await withFixture(async (fixture) => {
    await writeJson(userSettings(fixture), { model: 'auto/coding' });

    const fresh = await captureSdkOptions(fixture, { model: 'default', effort: 'max' });
    assert.equal(fresh.model, 'auto/coding');
    assert.equal(fresh.effort, 'max');

    // Without the flag the CLI would resume on the session's last model (e.g. Sonnet
    // after the picker moved from Sonnet to Default), not on the configured one.
    const resumed = await captureSdkOptions(fixture, RESUMED_DEFAULT);
    assert.equal(resumed.resume, 'native-session-1');
    assert.equal(resumed.model, 'auto/coding');
  });
});

test('Default follows project settings and a process ANTHROPIC_MODEL', async () => {
  await withFixture(async (fixture) => {
    await writeJson(userSettings(fixture), { model: 'user-model' });
    await writeJson(projectSettings(fixture), { model: 'auto/coding' });
    const options = await captureSdkOptions(fixture, { model: 'default' });
    assert.equal(options.model, 'auto/coding', 'project settings');
  });

  await withFixture(async (fixture) => {
    await writeJson(userSettings(fixture), { model: 'user-model' });
    const options = await captureSdkOptions(fixture, RESUMED_DEFAULT, 'auto/coding');
    assert.equal('model' in options, false, `process env: got ${String(options.model)}`);
  });
});

test('a caller that sends no model (/api/agent) gets the configured model too', async () => {
  await withFixture(async (fixture) => {
    await writeJson(userSettings(fixture), { model: 'auto/coding' });

    const options = await captureSdkOptions(fixture, {});
    assert.equal(options.model, 'auto/coding');

    // Resuming a session still runs the choice recorded for it, not the settings model.
    const resumed = await captureSdkOptions(fixture, {
      recordedModel: 'sonnet',
      providerSessionId: 'native-session-1',
    });
    assert.equal(resumed.model, 'sonnet');
  });
});

test('Default still sends `default` when Claude Code has no model configured', async () => {
  await withFixture(async (fixture) => {
    await writeJson(userSettings(fixture), { env: { ANTHROPIC_BASE_URL: 'http://x' } });

    const fresh = await captureSdkOptions(fixture, { model: 'default', effort: 'max' });
    assert.equal(fresh.model, 'default');
    assert.equal(fresh.effort, 'max');

    // A resume without the flag would keep the session's last model, so it stays explicit.
    const resumed = await captureSdkOptions(fixture, RESUMED_DEFAULT);
    assert.equal(resumed.model, 'default');
  });
});

test('an explicit picker choice still wins over the configured model', async () => {
  await withFixture(async (fixture) => {
    await writeJson(userSettings(fixture), REPORTER_SETTINGS);

    const options = await captureSdkOptions(fixture, { model: 'sonnet', effort: 'xhigh' });

    assert.equal(options.model, 'sonnet');
    assert.equal(options.effort, 'xhigh');
  });
});

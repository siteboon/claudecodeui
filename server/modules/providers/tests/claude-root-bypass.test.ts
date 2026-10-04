import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';
import { CLAUDE_ROOT_BYPASS_NOTICE } from '@/shared/utils.js';

/**
 * Claude Code refuses bypass-permissions mode as root outside a deliberate
 * sandbox: it prints "--dangerously-skip-permissions cannot be used with
 * root/sudo privileges for security reasons" and exits with code 1 before the
 * turn starts (#641). These drive a chat turn through `context.createQuery`
 * with a stand-in CLI that applies that same startup guard, and check which
 * permission mode the turn is launched with and what the user is shown.
 */

const SANDBOX_ENV_KEYS = ['IS_SANDBOX', 'CLAUDE_CODE_BUBBLEWRAP'] as const;

type TurnOutcome = {
  launchedMode: unknown;
  sent: NormalizedMessage[];
};

/** Runs one chat turn as if the server had `uid`, with Claude Code's sandbox markers set only as given. */
async function runTurnAs(
  uid: number,
  sandboxEnv: Partial<Record<(typeof SANDBOX_ENV_KEYS)[number], string>>,
  options: Record<string, unknown>,
): Promise<TurnOutcome> {
  const originalGetuid = process.getuid;
  const originalEnv = Object.fromEntries(SANDBOX_ENV_KEYS.map((key) => [key, process.env[key]]));
  process.getuid = () => uid;
  for (const key of SANDBOX_ENV_KEYS) {
    if (sandboxEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = sandboxEnv[key];
    }
  }

  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-root-bypass-'));
  const sent: NormalizedMessage[] = [];
  let launchedMode: unknown;
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery: ({ prompt, options: sdkOptions }) => {
      launchedMode = (sdkOptions as { permissionMode?: unknown }).permissionMode;
      void (async () => {
        for await (const _message of prompt) { /* the CLI reads its stdin */ }
      })();

      // The CLI's own startup guard, evaluated in the environment it inherits.
      const refusesBypass = launchedMode === 'bypassPermissions'
        && process.getuid?.() === 0
        && process.env.IS_SANDBOX !== '1'
        && !['1', 'true', 'yes', 'on'].includes((process.env.CLAUDE_CODE_BUBBLEWRAP ?? '').trim().toLowerCase());
      const iterator = (async function* () {
        if (refusesBypass) {
          throw new Error('Claude Code process exited with code 1');
        }
        yield { type: 'system', subtype: 'init', session_id: 'native-root-bypass' };
      })();
      return Object.assign(iterator, { interrupt: async () => {}, stopTask: async () => {} });
    },
  };

  try {
    const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
    await queryClaudeSDK('hello', { sessionId: `app-root-bypass-${Date.now()}-${Math.random()}`, cwd, ...options }, writer as never, context);
  } finally {
    process.getuid = originalGetuid;
    for (const key of SANDBOX_ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    await rm(cwd, { recursive: true, force: true });
  }

  return { launchedMode, sent };
}

const skipPermissionsSetting = { toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: true } };
const notices = (sent: NormalizedMessage[]) => sent.filter((message) => message.kind === 'error');
const completion = (sent: NormalizedMessage[]) => sent.find((message) => message.kind === 'complete') as
  (NormalizedMessage & { exitCode?: number }) | undefined;

test('as root, "skip permissions" runs the turn in the default mode and tells the user why', async () => {
  const { launchedMode, sent } = await runTurnAs(0, {}, skipPermissionsSetting);

  assert.equal(launchedMode, undefined);
  assert.deepEqual(notices(sent).map((message) => message.content), [CLAUDE_ROOT_BYPASS_NOTICE]);
  assert.equal(completion(sent)?.exitCode, 0);
});

test('as root, the composer bypass mode falls back to the default mode too', async () => {
  const { launchedMode, sent } = await runTurnAs(0, {}, { permissionMode: 'bypassPermissions' });

  assert.equal(launchedMode, undefined);
  assert.deepEqual(notices(sent).map((message) => message.content), [CLAUDE_ROOT_BYPASS_NOTICE]);
  assert.equal(completion(sent)?.exitCode, 0);
});

test('as root, "skip permissions" over another composer mode falls back to that mode', async () => {
  const { launchedMode, sent } = await runTurnAs(0, {}, { ...skipPermissionsSetting, permissionMode: 'acceptEdits' });

  assert.equal(launchedMode, 'acceptEdits');
  assert.equal(notices(sent).length, 1);
});

test('as root inside a sandbox Claude Code accepts, bypass is kept', async () => {
  for (const sandboxEnv of [{ IS_SANDBOX: '1' }, { CLAUDE_CODE_BUBBLEWRAP: 'true' }]) {
    const { launchedMode, sent } = await runTurnAs(0, sandboxEnv, skipPermissionsSetting);

    assert.equal(launchedMode, 'bypassPermissions', JSON.stringify(sandboxEnv));
    assert.equal(notices(sent).length, 0, JSON.stringify(sandboxEnv));
    assert.equal(completion(sent)?.exitCode, 0);
  }
});

test('a non-root server keeps bypass and shows no notice', async () => {
  const { launchedMode, sent } = await runTurnAs(1000, {}, skipPermissionsSetting);

  assert.equal(launchedMode, 'bypassPermissions');
  assert.equal(notices(sent).length, 0);
  assert.equal(completion(sent)?.exitCode, 0);
});

test('plan mode is untouched as root', async () => {
  const { launchedMode, sent } = await runTurnAs(0, {}, { ...skipPermissionsSetting, permissionMode: 'plan' });

  assert.equal(launchedMode, 'plan');
  assert.equal(notices(sent).length, 0);
});

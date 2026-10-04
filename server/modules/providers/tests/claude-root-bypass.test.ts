import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';
import { CLAUDE_ROOT_BYPASS_NOTICE, CLAUDE_ROOT_BYPASS_NOTICE_CODE } from '@/shared/utils.js';

/**
 * Claude Code refuses bypass-permissions mode as root outside a deliberate
 * sandbox: it prints "--dangerously-skip-permissions cannot be used with
 * root/sudo privileges for security reasons" and exits with code 1 before the
 * turn starts (#641). These drive a chat turn through `context.createQuery`
 * with a stand-in CLI that applies that same startup guard, and check which
 * permission mode the turn is launched with and what the user is shown.
 */

const SANDBOX_ENV_KEYS = ['IS_SANDBOX', 'CLAUDE_CODE_BUBBLEWRAP'] as const;
type SandboxEnv = Partial<Record<(typeof SANDBOX_ENV_KEYS)[number], string>>;

type TurnOutcome = {
  launchedMode: unknown;
  sent: NormalizedMessage[];
  /** When the stand-in CLI, having recorded the prompt, began its first reply. */
  replyStartedAt: number;
};

type TurnSetup = {
  /** `env` block of `~/.claude/settings.json`. */
  userEnv?: Record<string, string>;
  /** `env` block of the project's `.claude/settings.json`. */
  projectEnv?: Record<string, string>;
  /** The CLI asks to run a tool before it streams any reply. */
  approvalBeforeReply?: boolean;
};

/**
 * The CLI's startup guard as measured on the native 2.1.280 build: the
 * user settings `env` block is copied over the inherited environment first,
 * the project's settings only after the guard.
 */
function standInCliRefusesBypass(): boolean {
  const markers: Record<string, string | undefined> = {
    IS_SANDBOX: process.env.IS_SANDBOX,
    CLAUDE_CODE_BUBBLEWRAP: process.env.CLAUDE_CODE_BUBBLEWRAP,
  };
  try {
    const settings = JSON.parse(readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
    Object.assign(markers, settings?.env ?? {});
  } catch {
    // No user settings.
  }
  return process.getuid?.() === 0
    && markers.IS_SANDBOX !== '1'
    && !['1', 'true', 'yes', 'on'].includes((markers.CLAUDE_CODE_BUBBLEWRAP ?? '').trim().toLowerCase());
}

/** Runs one chat turn as if the server had `uid`, with Claude Code's sandbox markers set only as given. */
async function runTurnAs(
  uid: number,
  sandboxEnv: SandboxEnv,
  options: Record<string, unknown>,
  settings: TurnSetup = {},
): Promise<TurnOutcome> {
  const originalGetuid = process.getuid;
  const originalEnv = Object.fromEntries(
    [...SANDBOX_ENV_KEYS, 'HOME', 'CLAUDE_CONFIG_DIR'].map((key) => [key, process.env[key]]),
  );
  const home = await mkdtemp(path.join(os.tmpdir(), 'claude-root-bypass-home-'));
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-root-bypass-'));
  // An isolated HOME keeps the real ~/.claude settings of whoever runs the
  // suite out of the guard.
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  if (settings.userEnv) {
    await mkdir(path.join(home, '.claude'), { recursive: true });
    await writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({ env: settings.userEnv }));
  }
  if (settings.projectEnv) {
    await mkdir(path.join(cwd, '.claude'), { recursive: true });
    await writeFile(path.join(cwd, '.claude', 'settings.json'), JSON.stringify({ env: settings.projectEnv }));
  }
  process.getuid = () => uid;
  for (const key of SANDBOX_ENV_KEYS) {
    if (sandboxEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = sandboxEnv[key];
    }
  }

  const sent: NormalizedMessage[] = [];
  let launchedMode: unknown;
  let replyStartedAt = Number.NaN;
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

      const refusesBypass = launchedMode === 'bypassPermissions' && standInCliRefusesBypass();
      const iterator = (async function* () {
        if (refusesBypass) {
          throw new Error('Claude Code process exited with code 1');
        }
        yield { type: 'system', subtype: 'init', session_id: 'native-root-bypass' };
        if (settings.approvalBeforeReply) {
          // An already-aborted signal settles the approval at once.
          const { canUseTool } = sdkOptions as { canUseTool: (...args: unknown[]) => Promise<unknown> };
          await canUseTool('Bash', { command: 'ls' }, { signal: AbortSignal.abort() });
        }
        // The real CLI records the prompt between its init and its first reply.
        await new Promise((resolve) => setTimeout(resolve, 25));
        replyStartedAt = Date.now();
        yield {
          type: 'assistant',
          session_id: 'native-root-bypass',
          message: { role: 'assistant', content: [{ type: 'text', text: 'first reply' }] },
        };
      })();
      return Object.assign(iterator, { interrupt: async () => {}, stopTask: async () => {} });
    },
  };

  try {
    const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
    await queryClaudeSDK('hello', { sessionId: `app-root-bypass-${Date.now()}-${Math.random()}`, cwd, ...options }, writer as never, context);
  } finally {
    process.getuid = originalGetuid;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }

  return { launchedMode, sent, replyStartedAt };
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

test('the notice waits until the CLI has started, then comes before its first reply', async () => {
  const { sent, replyStartedAt } = await runTurnAs(0, {}, skipPermissionsSetting);

  const kinds = sent.map((message) => message.kind);
  const noticeIndex = sent.findIndex((message) => message.kind === 'error');
  // Not at init: the merged history would sort it above the prompt row.
  assert.ok(Date.parse(sent[noticeIndex]?.timestamp ?? '') >= replyStartedAt, sent[noticeIndex]?.timestamp);
  const sessionCreatedIndex = kinds.indexOf('session_created');
  const firstReplyIndex = sent.findIndex((message) => message.kind === 'text');
  assert.ok(sessionCreatedIndex >= 0 && sessionCreatedIndex < noticeIndex, kinds.join(','));
  assert.ok(noticeIndex < firstReplyIndex, kinds.join(','));
  assert.equal(sent[noticeIndex]?.noticeCode, CLAUDE_ROOT_BYPASS_NOTICE_CODE);
});

test('as root, a sandbox marked only in ~/.claude/settings.json keeps bypass', async () => {
  for (const userEnv of [{ IS_SANDBOX: '1' }, { CLAUDE_CODE_BUBBLEWRAP: 'on' }] as Record<string, string>[]) {
    const { launchedMode, sent } = await runTurnAs(0, {}, skipPermissionsSetting, { userEnv });

    assert.equal(launchedMode, 'bypassPermissions', JSON.stringify(userEnv));
    assert.equal(notices(sent).length, 0, JSON.stringify(userEnv));
    assert.equal(completion(sent)?.exitCode, 0);
  }
});

test('as root, the user settings can take back a sandbox marked in the environment', async () => {
  const { launchedMode, sent } = await runTurnAs(0, { IS_SANDBOX: '1' }, skipPermissionsSetting, { userEnv: { IS_SANDBOX: '0' } });

  assert.equal(launchedMode, undefined);
  assert.equal(notices(sent).length, 1);
  assert.equal(completion(sent)?.exitCode, 0);
});

test('as root, a project .claude/settings.json cannot mark a sandbox', async () => {
  const { launchedMode, sent } = await runTurnAs(0, {}, skipPermissionsSetting, { projectEnv: { IS_SANDBOX: '1' } });

  assert.equal(launchedMode, undefined);
  assert.equal(notices(sent).length, 1);
  assert.equal(completion(sent)?.exitCode, 0);
});

test('an approval request that comes before any reply is preceded by the notice', async () => {
  const { sent } = await runTurnAs(0, {}, skipPermissionsSetting, { approvalBeforeReply: true });

  const kinds = sent.map((message) => message.kind);
  assert.equal(notices(sent).length, 1, kinds.join(','));
  assert.ok(kinds.indexOf('error') < kinds.indexOf('permission_request'), kinds.join(','));
});

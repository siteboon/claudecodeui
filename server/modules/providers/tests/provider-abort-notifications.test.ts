import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Codex } from '@openai/codex-sdk';
import type { Thread } from '@openai/codex-sdk';
import type { WebSocket } from 'ws';

import {
  closeConnection,
  initializeDatabase,
  notificationPreferencesDb,
  userDb,
} from '@/modules/database/index.js';
import {
  registerDesktopNotificationClient,
  unregisterDesktopNotificationClient,
} from '@/modules/notifications/index.js';
import {
  abortClaudeSDKSession,
  isClaudeSDKSessionActive,
  queryClaudeSDK,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import { cursorRuntime } from '@/modules/providers/list/cursor/cursor-runtime.provider.js';
import { opencodeRuntime } from '@/modules/providers/list/opencode/opencode-runtime.provider.js';
import type { ProviderRuntimeContext } from '@/shared/index.js';

/**
 * A run the user cancels must be reported as stopped/aborted, never as a
 * failure, and Codex must report it at all. Every notification channel (Web
 * Push, desktop, webhooks) receives the same event, so these watch the desktop
 * channel: a registered fake desktop client records each payload it is sent.
 */

type DesktopPayload = { body: string; data: { code: string; provider: string; sessionId: string | null } };

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

const runtimeContext: ProviderRuntimeContext = {
  resolveProviderSessionId: () => null,
  resolveResumeModel: async () => undefined,
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
  normalizeMessage: () => [],
  isProviderInstalled: async () => true,
};

async function waitFor(condition: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Isolated DB + one user whose desktop channel is on, with a fake desktop client attached. */
async function withDesktopListener(
  runTest: (context: { userId: number; payloads: DesktopPayload[]; binDir: string }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const pathKey = findEnvKey('PATH');
  const previousPath = process.env[pathKey];
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-abort-notifications-'));
  const payloads: DesktopPayload[] = [];
  const fakeSocket = {
    OPEN: 1,
    readyState: 1,
    send: (message: string) => {
      payloads.push(JSON.parse(message).payload as DesktopPayload);
    },
    close: () => {},
  } as unknown as WebSocket;

  closeConnection();
  process.env.DATABASE_PATH = path.join(temporaryDirectory, 'auth.db');
  process.env[pathKey] = `${temporaryDirectory}${path.delimiter}${previousPath || ''}`;
  await initializeDatabase();

  try {
    const userId = Number(userDb.createUser('abort-user', 'x').id);
    notificationPreferencesDb.updatePreferences(userId, {
      channels: { desktop: true },
      events: { actionRequired: true, stop: true, error: true },
    });
    registerDesktopNotificationClient({ userId, deviceId: 'test-device', ws: fakeSocket });
    await runTest({ userId, payloads, binDir: temporaryDirectory });
  } finally {
    unregisterDesktopNotificationClient(fakeSocket);
    closeConnection();
    process.env[pathKey] = previousPath;
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/**
 * Installs a fake CLI on PATH. It prints `firstLine`, then either exits with
 * `exitCode` or (when null) idles until it is killed. `exec` keeps the SIGTERM
 * on the node process itself, so no orphan is left behind. The script is
 * `.cjs` so a stray package.json `type: module` above the temp dir cannot
 * turn it into ESM.
 */
async function installFakeCli(binDir: string, name: string, firstLine: object, exitCode: number | null): Promise<void> {
  const scriptPath = path.join(binDir, `${name}.cjs`);
  const ending = exitCode === null ? 'setInterval(() => {}, 1000);' : `process.exitCode = ${exitCode};`;
  await writeFile(scriptPath, `process.stdout.write(${JSON.stringify(`${JSON.stringify(firstLine)}\n`)});\n${ending}\n`, 'utf8');
  if (process.platform === 'win32') {
    await writeFile(path.join(binDir, `${name}.cmd`), `@echo off\r\nnode "%~dp0${name}.cjs" %*\r\n`, 'utf8');
    return;
  }
  const commandPath = path.join(binDir, name);
  await writeFile(commandPath, `#!/bin/sh\nexec node "$(dirname "$0")/${name}.cjs" "$@"\n`, 'utf8');
  await chmod(commandPath, 0o755);
}

const CURSOR_FIRST_LINE = { type: 'system', subtype: 'init', session_id: 'cursor-native-1' };

function createWriter(userId: number) {
  const writer = {
    userId,
    sessionIds: [] as string[],
    send: (_message: unknown) => {},
    setSessionId(sessionId: string) {
      writer.sessionIds.push(sessionId);
    },
  };
  return writer;
}

test('cursor: a cancelled run is reported as stopped/aborted, not as a failure', async () => {
  await withDesktopListener(async ({ userId, payloads, binDir }) => {
    await installFakeCli(binDir, 'cursor-agent', CURSOR_FIRST_LINE, null);
    const sessionId = 'cursor-abort-session';
    const writer = createWriter(userId);

    const run = cursorRuntime.run('hello', { sessionId, cwd: binDir }, writer, runtimeContext);
    const settled = run.then(() => 'resolved', () => 'rejected');
    await waitFor(() => writer.sessionIds.length > 0, 'cursor to start');

    assert.equal(cursorRuntime.abort(sessionId), true);
    await settled;

    const codes = payloads.map((payload) => payload.data.code);
    assert.deepEqual(codes, ['run.stopped'], `notifications sent: ${JSON.stringify(payloads)}`);
    assert.match(payloads[0].body, /aborted$/);
    assert.equal(payloads[0].data.sessionId, sessionId);
  });
});

test('cursor: a run that exits non-zero on its own is still reported as failed', async () => {
  await withDesktopListener(async ({ userId, payloads, binDir }) => {
    await installFakeCli(binDir, 'cursor-agent', CURSOR_FIRST_LINE, 3);
    const writer = createWriter(userId);

    await assert.rejects(cursorRuntime.run('hello', { sessionId: 'cursor-fail-session', cwd: binDir }, writer, runtimeContext));

    assert.deepEqual(payloads.map((payload) => payload.data.code), ['run.failed']);
  });
});

const FAKE_OPENCODE_SERVE = fileURLToPath(new URL('./fixtures/fake-opencode-serve.ts', import.meta.url));

/**
 * Puts the fake `opencode serve` the OpenCode runtime tests use
 * (tests/fixtures/fake-opencode-serve.ts) on PATH, scripted with `scenario`,
 * so a turn goes through the real SDK runtime. HOME points into the temp dir
 * because a finished turn reads its token usage from ~/.local/share/opencode.
 * Returns the path of the fake's request log.
 */
async function installFakeOpenCode(binDir: string, scenario: object): Promise<string> {
  const tsxLoader = import.meta.resolve('tsx/esm');
  if (process.platform === 'win32') {
    await writeFile(
      path.join(binDir, 'opencode.cmd'),
      `@echo off\r\n"${process.execPath}" --import "${tsxLoader}" "${FAKE_OPENCODE_SERVE}" %*\r\n`,
      'utf8',
    );
  } else {
    const commandPath = path.join(binDir, 'opencode');
    await writeFile(commandPath, `#!/bin/sh\nexec "${process.execPath}" --import "${tsxLoader}" "${FAKE_OPENCODE_SERVE}" "$@"\n`, 'utf8');
    await chmod(commandPath, 0o755);
  }
  const logPath = path.join(binDir, 'fake-opencode.jsonl');
  process.env.FAKE_OPENCODE_SCENARIO = JSON.stringify(scenario);
  process.env.FAKE_OPENCODE_LOG = logPath;
  process.env.HOME = binDir;
  process.env.USERPROFILE = binDir;
  delete process.env.OPENCODE_SERVER_PASSWORD;
  return logPath;
}

/** Runs `runTest` with the environment the fake OpenCode needs, restoring it afterwards. */
async function withOpenCodeEnvironment(runTest: () => Promise<void>): Promise<void> {
  const names = ['FAKE_OPENCODE_SCENARIO', 'FAKE_OPENCODE_LOG', 'HOME', 'USERPROFILE', 'OPENCODE_SERVER_PASSWORD'];
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  try {
    await runTest();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

/** Waits until the fake OpenCode server has received the turn's prompt, so the turn is running. */
async function waitForOpenCodePrompt(logPath: string): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    const logged = await readFile(logPath, 'utf8').catch(() => '');
    if (logged.split('\n').some((line) => line.includes('"path":"/session/') && line.includes('/prompt_async"'))) {
      return;
    }
    if (Date.now() - startedAt > 30_000) {
      throw new Error('Timed out waiting for opencode to send the prompt');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('opencode: a stopped turn is reported as stopped/aborted', async () => {
  await withOpenCodeEnvironment(() => withDesktopListener(async ({ userId, payloads, binDir }) => {
    // The turn runs until it is stopped.
    const logPath = await installFakeOpenCode(binDir, { newSessionId: 'ses_abort', steps: [{ type: 'hang' }] });
    const sessionId = 'opencode-abort-session';
    const writer = createWriter(userId);

    const run = opencodeRuntime.run('hello', { sessionId, cwd: binDir }, writer, runtimeContext);
    await waitForOpenCodePrompt(logPath);

    assert.equal(await opencodeRuntime.abort(sessionId), true);
    await run;

    assert.deepEqual(payloads.map((payload) => payload.data.code), ['run.stopped'], `notifications sent: ${JSON.stringify(payloads)}`);
    assert.match(payloads[0].body, /aborted$/);
    assert.equal(payloads[0].data.sessionId, sessionId);
  }));
});

test('opencode: a turn whose server dies is still reported as failed', async () => {
  await withOpenCodeEnvironment(() => withDesktopListener(async ({ userId, payloads, binDir }) => {
    await installFakeOpenCode(binDir, { newSessionId: 'ses_crash', steps: [{ type: 'crash' }] });
    const writer = createWriter(userId);

    await assert.rejects(opencodeRuntime.run('hello', { sessionId: 'opencode-fail-session', cwd: binDir }, writer, runtimeContext));

    assert.deepEqual(payloads.map((payload) => payload.data.code), ['run.failed']);
  }));
});

/** A Codex thread whose stream starts, then waits for the abort signal and ends the way `mode` says. */
function createAbortableThread(mode: 'throws' | 'yields'): Thread {
  return {
    id: 'codex-native-1',
    async runStreamed(_input: unknown, options?: { signal?: AbortSignal }) {
      const signal = options?.signal;
      return {
        events: (async function* () {
          yield { type: 'thread.started', thread_id: 'codex-native-1' };
          await new Promise<void>((resolve) => {
            if (signal?.aborted) {
              resolve();
              return;
            }
            signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          if (mode === 'throws') {
            // What the SDK does: the spawn signal kills the CLI and the
            // generator rethrows the AbortError once stdout closes.
            throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
          }
          yield { type: 'item.completed', item: { id: 'late', type: 'agent_message', text: 'late' } };
        })(),
      };
    },
  } as unknown as Thread;
}

for (const mode of ['throws', 'yields'] as const) {
  test(`codex: a cancelled run is reported as stopped/aborted (stream ${mode} after abort)`, async (t) => {
    await withDesktopListener(async ({ userId, payloads }) => {
      t.mock.method(Codex.prototype, 'startThread', () => createAbortableThread(mode));
      const sessionId = `codex-abort-session-${mode}`;
      const writer = createWriter(userId);

      const run = codexRuntime.run('hello', { sessionId, cwd: process.cwd() }, writer, runtimeContext);
      await waitFor(() => writer.sessionIds.length > 0, 'codex to start');

      // Awaited: the abort may be async (it waits for the CLI to exit).
      assert.equal(await codexRuntime.abort(sessionId), true);
      await run;

      assert.deepEqual(payloads.map((payload) => payload.data.code), ['run.stopped'], `notifications sent: ${JSON.stringify(payloads)}`);
      assert.match(payloads[0].body, /aborted$/);
      assert.equal(payloads[0].data.sessionId, sessionId);
    });
  });
}

test('codex: an error that only mentions "aborted", with no user abort, is not reported as a cancellation', async (t) => {
  await withDesktopListener(async ({ userId, payloads }) => {
    t.mock.method(Codex.prototype, 'startThread', () => ({
      id: 'codex-native-2',
      async runStreamed() {
        return {
          events: (async function* () {
            yield { type: 'thread.started', thread_id: 'codex-native-2' };
            throw new Error('stream aborted by the upstream proxy');
          })(),
        };
      },
    }) as unknown as Thread);
    const writer = createWriter(userId);

    await codexRuntime.run('hello', { sessionId: 'codex-not-aborted', cwd: process.cwd() }, writer, runtimeContext).catch(() => {});

    assert.ok(
      !payloads.some((payload) => payload.data.code === 'run.stopped'),
      `notifications sent: ${JSON.stringify(payloads)}`,
    );
  });
});

/**
 * A stand-in for the Claude SDK query: it reports the session, then waits.
 * `interrupt()` either ends the stream or makes it throw; the Claude CLI on
 * this box (measured in the real app) takes the throwing path:
 * "Claude Code returned an error result: [ede_diagnostic] result_type=user ...".
 */
function createInterruptibleQuery(
  mode: 'throws' | 'ends',
  { afterCompletedTurn = false }: { afterCompletedTurn?: boolean } = {},
): NonNullable<ProviderRuntimeContext['createQuery']> {
  return ({ prompt }) => {
    void (async () => {
      for await (const _message of prompt) { /* the CLI reads its stdin */ }
    })();
    let interrupted: (() => void) | null = null;
    const interruptedSignal = new Promise<void>((resolve) => { interrupted = resolve; });
    const iterator = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'claude-native-abort' };
      if (afterCompletedTurn) {
        // The turn ends while a backgrounded command is still running, so the
        // runtime reports completion and holds the process open for it.
        yield {
          type: 'assistant',
          session_id: 'claude-native-abort',
          message: { content: [{ type: 'tool_use', id: 'bg-1', name: 'Bash', input: { command: 'sleep 60', run_in_background: true } }] },
        };
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 'claude-native-abort' };
      }
      await interruptedSignal;
      if (mode === 'throws') {
        throw new Error('Claude Code returned an error result: [ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null');
      }
    })();
    return Object.assign(iterator, {
      interrupt: async () => { interrupted?.(); },
      stopTask: async () => {},
    });
  };
}

for (const mode of ['throws', 'ends'] as const) {
  test(`claude: a cancelled run is reported as stopped/aborted (stream ${mode} on interrupt)`, async () => {
    await withDesktopListener(async ({ userId, payloads, binDir }) => {
      const sessionId = `claude-abort-session-${mode}`;
      const writer = createWriter(userId);
      const run = queryClaudeSDK('hello', { sessionId, cwd: binDir }, writer as never, {
        ...runtimeContext,
        createQuery: createInterruptibleQuery(mode),
      });
      await waitFor(() => isClaudeSDKSessionActive(sessionId), 'claude to start');

      assert.equal(await abortClaudeSDKSession(sessionId), true);
      await run;

      assert.deepEqual(payloads.map((payload) => payload.data.code), ['run.stopped'], `notifications sent: ${JSON.stringify(payloads)}`);
      assert.match(payloads[0].body, /aborted$/);
      assert.equal(payloads[0].data.sessionId, sessionId);
    });
  });
}

test('claude: cancelling the post-turn hold of a completed turn sends no second notice', async () => {
  await withDesktopListener(async ({ userId, payloads, binDir }) => {
    const sessionId = 'claude-abort-session-held';
    const writer = createWriter(userId);
    const run = queryClaudeSDK('hello', { sessionId, cwd: binDir }, writer as never, {
      ...runtimeContext,
      createQuery: createInterruptibleQuery('throws', { afterCompletedTurn: true }),
    });
    await waitFor(() => payloads.length > 0, 'claude to report the completed turn');
    assert.equal(isClaudeSDKSessionActive(sessionId), true, 'the process is held for the background command');

    assert.equal(await abortClaudeSDKSession(sessionId), true);
    await run;

    assert.deepEqual(payloads.map((payload) => payload.data.code), ['run.stopped'], `notifications sent: ${JSON.stringify(payloads)}`);
    assert.match(payloads[0].body, /completed$/);
  });
});

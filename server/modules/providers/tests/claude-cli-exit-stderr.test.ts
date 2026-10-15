import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { queryClaudeSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { AnyRecord, NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * A CLI that stops before it can emit a `result` (an unknown flag on an older
 * CLI, a temp directory it cannot create, the root/bypass guard) explains
 * itself only on stderr. The SDK drops that stream unless `options.stderr` is
 * set and reports just "Claude Code process exited with code 1", so the chat
 * showed that line and nothing else. The run now keeps the stderr tail and
 * puts it under the bare exit error.
 *
 * Driven through the `context.createQuery` seam: the scripted query writes to
 * the `stderr` callback the runtime handed it, then fails the way the SDK
 * does when the CLI exits.
 */

type ScriptedFailure = {
  stderr?: string[];
  messages?: AnyRecord[];
  error: Error;
};

async function runFailingTurn(failure: ScriptedFailure): Promise<{ sent: NormalizedMessage[]; options: AnyRecord }> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-cli-exit-stderr-'));
  const sent: NormalizedMessage[] = [];
  let seenOptions: AnyRecord = {};
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ options }) => {
    seenOptions = options;
    const iterator = (async function* () {
      for (const chunk of failure.stderr ?? []) {
        (options.stderr as ((data: string) => void) | undefined)?.(chunk);
      }
      for (const message of failure.messages ?? []) {
        yield message;
      }
      throw failure.error;
    })();
    return Object.assign(iterator, { interrupt: async () => {} });
  };

  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery,
  };

  try {
    await queryClaudeSDK('hello', { sessionId: `app-exit-stderr-${Math.random()}`, cwd }, writer as never, context);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
  return { sent, options: seenOptions };
}

const errorRows = (sent: NormalizedMessage[]) => sent.filter((message) => message.kind === 'error').map((message) => message.content);
const exitCodes = (sent: NormalizedMessage[]) => sent.filter((message) => message.kind === 'complete').map((message) => message.exitCode);

test('the runtime asks the SDK for the CLI stderr', async () => {
  const { options } = await runFailingTurn({ error: new Error('Claude Code process exited with code 1') });
  assert.equal(typeof options.stderr, 'function');
});

test('a CLI that exits before any result shows what it wrote to stderr', async () => {
  const { sent } = await runFailingTurn({
    stderr: ["EACCES: permission denied, mkdir '/nonexistent-dir'\n"],
    error: new Error('Claude Code process exited with code 1'),
  });
  assert.deepEqual(errorRows(sent), [
    "Claude Code process exited with code 1\nEACCES: permission denied, mkdir '/nonexistent-dir'",
  ]);
  assert.deepEqual(exitCodes(sent), [1]);
});

test('a CLI killed by a signal shows its last stderr too', async () => {
  const { sent } = await runFailingTurn({
    stderr: ['Background tasks still running after 600s; terminating.\n'],
    error: new Error('Claude Code process terminated by signal SIGTERM'),
  });
  assert.deepEqual(errorRows(sent), [
    'Claude Code process terminated by signal SIGTERM\nBackground tasks still running after 600s; terminating.',
  ]);
});

test('stderr split across chunks is reassembled and stripped of terminal styling', async () => {
  const { sent } = await runFailingTurn({
    stderr: ['\u001b[31merror: unknown ', "option '--effort'\u001b[0m\n"],
    error: new Error('Claude Code process exited with code 1'),
  });
  assert.deepEqual(errorRows(sent), ["Claude Code process exited with code 1\nerror: unknown option '--effort'"]);
});

test('only the tail of a long stderr is kept, and it keeps the last line', async () => {
  const noise = `${'Warning: noisy line\n'.repeat(400)}`;
  const { sent } = await runFailingTurn({
    stderr: ['FIRST LINE\n', noise, 'fatal: the real reason\n'],
    error: new Error('Claude Code process exited with code 1'),
  });
  const [row] = errorRows(sent);
  assert.ok(typeof row === 'string');
  assert.ok(row.endsWith('fatal: the real reason'), 'the last line survives');
  assert.ok(!row.includes('FIRST LINE'), 'the head of the stream is dropped');
  assert.ok(row.length <= 'Claude Code process exited with code 1\n'.length + 2000);
});

test('an exit with nothing on stderr keeps the plain exit message', async () => {
  const { sent } = await runFailingTurn({ error: new Error('Claude Code process exited with code 1') });
  assert.deepEqual(errorRows(sent), ['Claude Code process exited with code 1']);
});

test('an error result already in the CLI words gets no stderr appended', async () => {
  // A turn the CLI finished with an error `result` (here: a gateway that
  // answered with an empty stream). Its stderr warnings are unrelated noise.
  const resultText = 'API Error: API returned an empty or malformed response (HTTP 200)';
  const { sent } = await runFailingTurn({
    stderr: ['Warning: no stdin data received in 3s, proceeding without it.\n'],
    messages: [
      { type: 'system', subtype: 'init', session_id: 'native-exit-stderr' },
      { type: 'result', subtype: 'success', is_error: true, result: resultText, session_id: 'native-exit-stderr' },
    ],
    error: new Error(`Claude Code returned an error result: ${resultText}`),
  });
  assert.deepEqual(errorRows(sent), [`Claude Code returned an error result: ${resultText}`]);
});

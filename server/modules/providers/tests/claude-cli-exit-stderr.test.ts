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
 * puts it, labelled as the CLI's stderr, under the bare exit error.
 *
 * Driven through the `context.createQuery` seam: the scripted query writes to
 * the `stderr` callback the runtime handed it, then fails the way the SDK
 * does when the CLI exits.
 */

type ScriptedFailure = {
  stderr?: string[];
  messages?: AnyRecord[];
  error: Error;
  installed?: boolean;
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
    isProviderInstalled: async () => failure.installed ?? true,
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
const exitRow = (exitError: string, stderr: string) => `${exitError}\nCLI stderr:\n${stderr}`;

test('the runtime asks the SDK for the CLI stderr', async () => {
  const { options } = await runFailingTurn({ error: new Error('Claude Code process exited with code 1') });
  assert.equal(typeof options.stderr, 'function');
});

test('a CLI that exits before any result shows what it wrote to stderr', async (t) => {
  const logged = t.mock.method(console, 'error', () => undefined);
  const { sent } = await runFailingTurn({
    stderr: ["EACCES: permission denied, mkdir '/nonexistent-dir'\n"],
    error: new Error('Claude Code process exited with code 1'),
  });
  assert.deepEqual(errorRows(sent), [
    exitRow('Claude Code process exited with code 1', "EACCES: permission denied, mkdir '/nonexistent-dir'"),
  ]);
  assert.deepEqual(exitCodes(sent), [1]);
  assert.ok(
    logged.mock.calls.some(({ arguments: args }) => args[0] === 'Claude CLI stderr before exit:'
      && args[1] === "EACCES: permission denied, mkdir '/nonexistent-dir'"),
    'the server log gets the stderr too',
  );
});

test('multi-digit exit codes and other signals count as a bare exit', async () => {
  const cases: Array<[exitError: string, stderr: string]> = [
    ['Claude Code process exited with code 127', 'claude: error while loading shared libraries'],
    // 0xC0000005, a Windows access violation.
    ['Claude Code process exited with code 3221225477', 'Segmentation fault at address 0x0'],
    ['Claude Code process terminated by signal SIGSEGV', 'panic(main thread): Segmentation fault'],
    ['Claude Code process terminated by signal SIGTERM', 'Background tasks still running after 600s; terminating.'],
  ];
  for (const [exitError, stderr] of cases) {
    const { sent } = await runFailingTurn({ stderr: [`${stderr}\n`], error: new Error(exitError) });
    assert.deepEqual(errorRows(sent), [exitRow(exitError, stderr)], exitError);
  }
});

test('stderr split across chunks is reassembled and stripped of terminal styling', async () => {
  const { sent } = await runFailingTurn({
    stderr: ['\u001b[31merror: unknown ', "option '--effort'\u001b[0m\n"],
    error: new Error('Claude Code process exited with code 1'),
  });
  assert.deepEqual(errorRows(sent), [exitRow('Claude Code process exited with code 1', "error: unknown option '--effort'")]);
});

test('only whole lines from the tail of a long stderr are kept', async () => {
  const noisy = '\u001b[33mWarning: noisy line\u001b[0m\n';
  const last = 'fatal: out of disk space\n';
  const stderr = ['FIRST LINE\n', noisy.repeat(400), last];
  // The 2000-char window opens inside the closing escape of a noisy line.
  assert.ok(stderr.join('').slice(-2000).startsWith('0m\n'));

  const { sent } = await runFailingTurn({ stderr, error: new Error('Claude Code process exited with code 1') });
  const [header, label, ...lines] = (errorRows(sent)[0] ?? '').split('\n');
  assert.deepEqual([header, label], ['Claude Code process exited with code 1', 'CLI stderr:']);
  assert.equal(lines.at(-1), 'fatal: out of disk space', 'the last line survives');
  assert.ok(lines.length > 1 && lines.length <= 2000 / noisy.length + 1, 'the tail is capped');
  assert.deepEqual(new Set(lines.slice(0, -1)), new Set(['Warning: noisy line']), 'no cut line or escape remnant');
});

test('a cap that cuts exactly between two lines keeps the first whole line', async () => {
  // 100 lines of 20 chars fill the 2000-char window exactly.
  const stderr = ['FIRST LINE\n', 'kept: a whole line.\n', 'Warning: noisy line\n'.repeat(99)];
  assert.ok(stderr.join('').slice(-2000).startsWith('kept: '));

  const { sent } = await runFailingTurn({ stderr, error: new Error('Claude Code process exited with code 1') });
  const [, , ...lines] = (errorRows(sent)[0] ?? '').split('\n');
  assert.equal(lines[0], 'kept: a whole line.');
  assert.equal(lines.length, 100);
});

test('a single stderr line longer than the cap is kept cut rather than dropped', async () => {
  const { sent } = await runFailingTurn({
    stderr: [`${'x'.repeat(2500)}\n`],
    error: new Error('Claude Code process exited with code 1'),
  });
  assert.deepEqual(errorRows(sent), [exitRow('Claude Code process exited with code 1', 'x'.repeat(1999))]);
});

test('an exit with nothing on stderr keeps the plain exit message', async (t) => {
  const logged = t.mock.method(console, 'error', () => undefined);
  const { sent } = await runFailingTurn({ error: new Error('Claude Code process exited with code 1') });
  assert.deepEqual(errorRows(sent), ['Claude Code process exited with code 1']);
  assert.ok(
    !logged.mock.calls.some(({ arguments: args }) => args[0] === 'Claude CLI stderr before exit:'),
    'no stderr line is logged when the CLI wrote nothing',
  );
});

test('the not-installed message stays as it was', async () => {
  const { sent } = await runFailingTurn({
    stderr: ['/bin/sh: 1: claude: not found\n'],
    error: new Error('Claude Code process exited with code 127'),
    installed: false,
  });
  assert.deepEqual(errorRows(sent), [
    'Claude Code is not installed. Please install it first: https://docs.anthropic.com/en/docs/claude-code',
  ]);
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
  // Other rows about the same failure may come and go (open PR #1538 adds
  // one); what matters is that none of them carries the stderr.
  const rows = errorRows(sent);
  assert.ok(rows.includes(`Claude Code returned an error result: ${resultText}`), rows.join('\n'));
  assert.ok(rows.every((row) => !row?.includes('CLI stderr:') && !row?.includes('no stdin data')), rows.join('\n'));
});

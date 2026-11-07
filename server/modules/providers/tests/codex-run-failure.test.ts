import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Codex } from '@openai/codex-sdk';
import type { Thread, ThreadEvent } from '@openai/codex-sdk';

import { sessionRuntimeFailuresDb } from '@/modules/database/index.js';
import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext, SessionRuntimeFailure } from '@/shared/index.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';

const reply: ThreadEvent = { type: 'item.completed', item: { type: 'agent_message', id: 'reply', text: 'Done' } };
const complete: ThreadEvent = { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, reasoning_output_tokens: 0 } };

async function runFixture(t: test.TestContext, thread: Thread) {
  const frames: NormalizedMessage[] = [];
  const failures: SessionRuntimeFailure[] = [];
  const logs: unknown[][] = [];
  t.mock.method(Codex.prototype, 'startThread', () => thread);
  t.mock.method(sessionRuntimeFailuresDb, 'record', (failure: SessionRuntimeFailure) => failures.push(failure));
  t.mock.method(console, 'error', (...args: unknown[]) => logs.push(args));
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => 'test-model',
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
    isProviderInstalled: async () => true,
    normalizeMessage: (raw) => new CodexSessionsProvider().normalizeMessage(raw, 'native-thread'),
  };
  await codexRuntime.run('PRIVATE USER PROMPT', { sessionId: 'app-failure', cwd: process.cwd() }, {
    isWebSocketWriter: true, send: (frame) => frames.push(frame as NormalizedMessage),
  }, context);
  return { frames, failures, logs };
}

function scripted(events: ThreadEvent[], error?: Error, abort = false): Thread {
  return { id: 'native-thread', async runStreamed() {
    return { events: (async function* () {
      for (const event of events) yield event;
      if (abort) codexRuntime.abort('app-failure');
      if (error) throw error;
    })() };
  } } as unknown as Thread;
}

for (const error of [new Error('stream aborted: ECONNRESET'), Object.assign(new Error('transport ended'), { name: 'AbortError' })]) {
  test(`transport ${error.name} is not mistaken for user cancellation`, async (t) => {
    const result = await runFixture(t, scripted([], error));
    assert.equal(result.frames.filter((frame) => frame.kind === 'error').length, 1);
    assert.equal(result.frames.filter((frame) => frame.kind === 'complete' && frame.exitCode === 1).length, 1);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].code, 'CODEX_STREAM_ERROR');
    assert.equal(result.failures[0].diagnostics.errorName, error.name);
  });
}

for (const [events, expected] of [
  [[], 'CODEX_INCOMPLETE_STREAM'],
  [[reply], 'CODEX_INCOMPLETE_STREAM'],
] as const) {
  test(`stream end is a failure without a complete reply (${expected}, ${events.length})`, async (t) => {
    const result = await runFixture(t, scripted([...events]));
    assert.equal(result.failures[0]?.code, expected);
    assert.equal(result.frames.filter((frame) => frame.kind === 'complete' && frame.exitCode === 1).length, 1);
  });
}

test('a complete reply remains successful and is not journaled', async (t) => {
  const result = await runFixture(t, scripted([reply, complete]));
  assert.equal(result.failures.length, 0);
  assert.equal(result.frames.filter((frame) => frame.kind === 'complete' && frame.exitCode === 0).length, 1);
});

test('a nonfatal item error neither fails a recovered turn nor hides a later terminal error', async (t) => {
  const warning: ThreadEvent = { type: 'item.completed', item: { type: 'error', id: 'warning', message: 'Nonfatal' } };
  const recovered = await runFixture(t, scripted([warning, reply, complete]));
  assert.equal(recovered.failures.length, 0);
  assert.equal(recovered.frames.filter((frame) => frame.kind === 'complete' && frame.exitCode === 0).length, 1);
  t.mock.restoreAll();
  const disconnected = await runFixture(t, scripted([warning], new Error('ECONNRESET')));
  assert.equal(disconnected.failures.length, 1);
  assert.equal(disconnected.frames.filter((frame) => frame.kind === 'error').length, 1);
});

test('a recovered top-level reconnect event is not a failed turn', async (t) => {
  const result = await runFixture(t, scripted([
    { type: 'error', message: 'Reconnecting... 1/2 (stream disconnected before completion)' }, reply, complete,
  ]));
  assert.equal(result.failures.length, 0);
  assert.equal(result.frames.filter((frame) => frame.kind === 'error').length, 0);
  assert.equal(result.frames.filter((frame) => frame.kind === 'complete' && frame.exitCode === 0).length, 1);
});

test('completed tool-only and empty turns keep their existing behavior', async (t) => {
  const tool: ThreadEvent = { type: 'item.completed', item: {
    id: 'command', type: 'command_execution', command: 'pwd', aggregated_output: '/fixture', exit_code: 0, status: 'completed',
  } };
  for (const events of [[complete], [tool, complete]]) {
    const result = await runFixture(t, scripted(events));
    assert.equal(result.failures.length, 0);
    assert.equal(result.frames.filter((frame) => frame.kind === 'error').length, 0);
    assert.equal(result.frames.filter((frame) => frame.kind === 'complete' && frame.exitCode === 0).length, 1);
    t.mock.restoreAll();
  }
});

test('actual Stop does not become a transport failure or duplicate completion', async (t) => {
  const result = await runFixture(t, scripted([], new Error('aborted'), true));
  assert.equal(result.failures.length, 0);
  assert.equal(result.frames.length, 0);
});

test('turn.failed cannot become success even if the stream exits normally', async (t) => {
  const result = await runFixture(t, scripted([{ type: 'turn.failed', error: { message: 'fatal' } }, reply, complete]));
  assert.equal(result.failures[0]?.code, 'CODEX_TURN_FAILED');
  assert.equal(result.frames.filter((frame) => frame.kind === 'error').length, 1);
  assert.equal(result.frames.filter((frame) => frame.kind === 'complete' && frame.exitCode === 1).length, 1);
});

test('SDK exit after turn.failed produces one error and preserves process diagnostics without raw stderr', async (t) => {
  const result = await runFixture(t, scripted([{ type: 'turn.failed', error: { message: 'failed' } }],
    new Error('Codex Exec exited with code 7: PRIVATE STDERR sk-secret PRIVATE USER PROMPT ECONNRESET')));
  assert.equal(result.frames.filter((frame) => frame.kind === 'error').length, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].diagnostics.exitCode, 7);
  assert.equal(result.failures[0].diagnostics.transportCode, 'ECONNRESET');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE STDERR|sk-secret|PRIVATE USER PROMPT/);
});

test('a journal write failure still produces one visible error and completion', async (t) => {
  const thread = scripted([]);
  const original = sessionRuntimeFailuresDb.record;
  const runStreamed = thread.runStreamed.bind(thread);
  thread.runStreamed = async (...args) => {
    t.mock.method(sessionRuntimeFailuresDb, 'record', () => { throw new Error('disk unavailable'); });
    return runStreamed(...args);
  };
  try {
    const result = await runFixture(t, thread);
    assert.equal(result.frames.filter((frame) => frame.kind === 'error').length, 1);
    assert.equal(result.frames.filter((frame) => frame.kind === 'complete').length, 1);
  } finally { sessionRuntimeFailuresDb.record = original; }
});

for (const mode of ['exit-zero', 'exit-error', 'signal'] as const) {
  test(`real SDK subprocess reports ${mode} without a model request`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codex-exit-fixture-'));
    try {
      const executable = path.join(root, 'codex-fixture');
      await writeFile(executable, `#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>{\n`
        + `console.log(JSON.stringify({type:'thread.started',thread_id:'native-fixture'}));\n`
        + (mode === 'exit-zero' ? '' : mode === 'signal'
          ? `process.kill(process.pid,'SIGTERM');\n`
          : `process.stderr.write('stream aborted ECONNRESET PRIVATE STDERR');process.exitCode=7;\n`)
        + `});\n`);
      await chmod(executable, 0o700);
      const nativeThread = new Codex({ codexPathOverride: executable }).startThread();
      const result = await runFixture(t, nativeThread);
      assert.equal(result.failures.length, 1);
      assert.equal(result.frames.filter((frame) => frame.kind === 'error').length, 1);
      assert.equal(result.frames.filter((frame) => frame.kind === 'complete' && frame.exitCode === 1).length, 1);
      assert.equal(result.failures[0].diagnostics.exitCode, mode === 'exit-error' ? 7 : null);
      assert.equal(result.failures[0].diagnostics.signal, mode === 'signal' ? 'SIGTERM' : null);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE STDERR|PRIVATE USER PROMPT/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

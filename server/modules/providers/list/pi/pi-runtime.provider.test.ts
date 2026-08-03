import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPiRuntime,
  mapPiEvent,
  isSettledEvent,
  type PiRuntimeRpc,
} from './pi-runtime.provider.js';
import { PiRpcClient } from './pi-rpc-client.provider.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** Stub RPC client that lets tests drive the event/lifecycle timeline. */
class FakeRpc implements PiRuntimeRpc {
  startCalls = 0;
  abortCalls = 0;
  closeCalls: number[] = [];
  promptCalls: string[] = [];
  state: { sessionId: string; sessionFile?: string; isStreaming: boolean } = {
    sessionId: 'native-1',
    isStreaming: false,
  };
  startError: Error | null = null;

  private eventListeners = new Set<(e: unknown) => void>();
  private closeListeners = new Set<() => void>();

  async start(): Promise<void> {
    this.startCalls += 1;
    if (this.startError) throw this.startError;
  }

  onEvent(listener: (e: unknown) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  async getState() {
    return this.state as never;
  }

  async prompt(message: string): Promise<void> {
    this.promptCalls.push(message);
  }

  async abort(): Promise<void> {
    this.abortCalls += 1;
  }

  async close(graceMs: number): Promise<void> {
    this.closeCalls.push(graceMs);
  }

  getStderr(): string {
    return '';
  }

  emit(event: unknown): void {
    for (const l of [...this.eventListeners]) l(event);
  }

  closeProcess(): void {
    for (const l of [...this.closeListeners]) l();
  }
}

interface CapturedMessage {
  kind: string;
  content?: string;
  code?: string;
  success?: boolean;
  aborted?: boolean;
  newSessionId?: string;
  sessionId?: string;
  [key: string]: unknown;
}

function makeWriter() {
  const sent: CapturedMessage[] = [];
  const sessionIds: string[] = [];
  const writer = {
    send(data: unknown) {
      sent.push(data as CapturedMessage);
    },
    setSessionId(id: string) {
      sessionIds.push(id);
    },
  };
  return { writer, sent, sessionIds };
}

function makeContext(mapped: string | null = null) {
  return {
    resolveProviderSessionId: () => mapped,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => ({}) as never,
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
// Pure event mapping (T1 stream shape, T3 protocol, T4 unknown)
// ---------------------------------------------------------------------------

test('mapPiEvent maps text_delta and thinking_delta to normalized stream events', () => {
  assert.deepEqual(
    mapPiEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
    }),
    { kind: 'stream_delta', content: 'hello' },
  );
  assert.deepEqual(
    mapPiEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'ponder' },
    }),
    { kind: 'thinking', content: 'ponder' },
  );
});

test('mapPiEvent maps tool execution start/end and retry/turn_end to status', () => {
  assert.deepEqual(
    mapPiEvent({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { a: 1 } }),
    { kind: 'tool_use', toolId: 't1', toolName: 'bash', toolInput: { a: 1 } },
  );
  assert.deepEqual(
    mapPiEvent({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash', result: 'ok', isError: false }),
    { kind: 'tool_result', toolId: 't1', toolName: 'bash', toolResult: { content: 'ok', isError: false }, isError: false },
  );
  assert.equal(mapPiEvent({ type: 'turn_end', turnIndex: 0 })?.status, 'turn_end');
  assert.equal(
    mapPiEvent({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 10, errorMessage: 'x' })?.status,
    'retry',
  );
});

// T3: known event, illegal payload → ERR-PI-RPC-PROTOCOL (thrown, not success)
test('T3: mapPiEvent throws ERR-PI-RPC-PROTOCOL on illegal known-event payload', () => {
  assert.throws(
    () => mapPiEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta' } }),
    (err: unknown) => (err as { code?: string }).code === 'ERR-PI-RPC-PROTOCOL',
  );
  assert.throws(
    () => mapPiEvent({ type: 'tool_execution_start', toolName: 'bash' }),
    (err: unknown) => (err as { code?: string }).code === 'ERR-PI-RPC-PROTOCOL',
  );
});

// T4: unknown event → ignored (null), no throw
test('T4: mapPiEvent returns null for unknown events', () => {
  assert.equal(mapPiEvent({ type: 'totally_unknown' }), null);
  assert.equal(mapPiEvent({ type: 'queue_update', steering: [], followUp: [] }), null);
  assert.equal(mapPiEvent({ notAnEvent: true }), null);
});

test('isSettledEvent detects only agent_settled', () => {
  assert.equal(isSettledEvent({ type: 'agent_settled' }), true);
  assert.equal(isSettledEvent({ type: 'agent_end', messages: [], willRetry: false }), false);
  assert.equal(isSettledEvent({ type: 'turn_end' }), false);
});

// ---------------------------------------------------------------------------
// Runtime state machine
// ---------------------------------------------------------------------------

// T1: normal stream → normalized text/thinking + one success complete
test('T1: streams normalized text/thinking then completes once on agent_settled', async () => {
  const fake = new FakeRpc();
  const runtime = createPiRuntime({ createRpcClient: () => fake });
  const { writer, sent } = makeWriter();

  const runPromise = runtime.run('hi', { sessionId: 'app-1' }, writer, makeContext());
  await tick();

  fake.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hel' } });
  fake.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' } });
  fake.emit({ type: 'agent_settled' });

  const outcome = await runPromise;
  assert.equal(outcome.status, 'settled');

  const streamDeltas = sent.filter((m) => m.kind === 'stream_delta');
  const thinking = sent.filter((m) => m.kind === 'thinking');
  const completes = sent.filter((m) => m.kind === 'complete');
  assert.equal(streamDeltas.length, 1);
  assert.equal(streamDeltas[0].content, 'Hel');
  assert.equal(thinking.length, 1);
  assert.equal(completes.length, 1);
  assert.equal(completes[0].success, true);
});

// T2: process close before agent_settled → ERR-PI-RUN-FAILED failure complete
test('T2: process close before settle fails with ERR-PI-RUN-FAILED', async () => {
  const fake = new FakeRpc();
  const runtime = createPiRuntime({ createRpcClient: () => fake });
  const { writer, sent } = makeWriter();

  const runPromise = runtime.run('hi', { sessionId: 'app-1' }, writer, makeContext());
  await tick();

  fake.closeProcess();

  const outcome = await runPromise;
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.errorCode, 'ERR-PI-RUN-FAILED');

  const errors = sent.filter((m) => m.kind === 'error');
  const completes = sent.filter((m) => m.kind === 'complete');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'ERR-PI-RUN-FAILED');
  assert.equal(completes.length, 1);
  assert.equal(completes[0].success, false);
});

// T3 (runtime side): illegal known-event payload → ERR-PI-RPC-PROTOCOL failure
test('T3: runtime fails with ERR-PI-RPC-PROTOCOL on illegal known-event payload', async () => {
  const fake = new FakeRpc();
  const runtime = createPiRuntime({ createRpcClient: () => fake });
  const { writer, sent } = makeWriter();

  const runPromise = runtime.run('hi', { sessionId: 'app-1' }, writer, makeContext());
  await tick();

  fake.emit({ type: 'tool_execution_start', toolName: 'bash' });

  const outcome = await runPromise;
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.errorCode, 'ERR-PI-RPC-PROTOCOL');
  assert.equal(sent.filter((m) => m.kind === 'error')[0].code, 'ERR-PI-RPC-PROTOCOL');
});

// T4: unknown event ignored, run continues to success
test('T4: unknown event is ignored and does not affect the run', async () => {
  const fake = new FakeRpc();
  const runtime = createPiRuntime({ createRpcClient: () => fake });
  const { writer, sent } = makeWriter();

  const runPromise = runtime.run('hi', { sessionId: 'app-1' }, writer, makeContext());
  await tick();

  fake.emit({ type: 'totally_unknown', foo: 1 });
  fake.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'ok' } });
  fake.emit({ type: 'agent_settled' });

  const outcome = await runPromise;
  assert.equal(outcome.status, 'settled');
  assert.equal(sent.filter((m) => m.kind === 'stream_delta').length, 1);
});

// T5: binding happens before the first live event
test('T5: persists app/native binding before the first live event', async () => {
  const fake = new FakeRpc();
  fake.state = { sessionId: 'native-xyz', isStreaming: false };
  const runtime = createPiRuntime({ createRpcClient: () => fake });
  const { writer, sent, sessionIds } = makeWriter();

  // context returns null → app session not yet mapped → fresh binding expected
  const runPromise = runtime.run('hi', { sessionId: 'app-1' }, writer, makeContext(null));
  await tick();

  fake.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'x' } });
  fake.emit({ type: 'agent_settled' });
  await runPromise;

  const bindIdx = sent.findIndex((m) => m.kind === 'session_created');
  const firstLiveIdx = sent.findIndex((m) => m.kind === 'stream_delta');
  assert.ok(bindIdx >= 0, 'binding event emitted');
  assert.ok(bindIdx < firstLiveIdx, 'binding precedes first live event');
  assert.equal(sent[bindIdx].newSessionId, 'native-xyz');
  assert.deepEqual(sessionIds, ['native-xyz']);
});

// ---------------------------------------------------------------------------
// Abort (T7, T8, T9)
// ---------------------------------------------------------------------------

// T7: abort a streaming run via request.signal → one aborted complete
test('T7: abort during stream produces exactly one aborted complete', async () => {
  const fake = new FakeRpc();
  const runtime = createPiRuntime({ createRpcClient: () => fake, abortGraceMs: 5000 });
  const { writer, sent } = makeWriter();
  const controller = new AbortController();

  const runPromise = runtime.run(
    'hi',
    { sessionId: 'app-1', signal: controller.signal },
    writer,
    makeContext(),
  );
  await tick();

  fake.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'x' } });
  controller.abort();
  await tick();
  // Pi responds to abort with agent_settled inside the grace window.
  fake.emit({ type: 'agent_settled' });

  const outcome = await runPromise;
  assert.equal(outcome.status, 'aborted');
  assert.equal(fake.abortCalls, 1);
  const completes = sent.filter((m) => m.kind === 'complete');
  assert.equal(completes.length, 1);
  assert.equal(completes[0].aborted, true);
  assert.equal(completes[0].success, false);
});

// T8: late native event after abort → still only one terminal outcome
test('T8: late native event after abort yields a single terminal', async () => {
  const fake = new FakeRpc();
  const runtime = createPiRuntime({ createRpcClient: () => fake, abortGraceMs: 5000 });
  const { writer, sent } = makeWriter();
  const controller = new AbortController();

  const runPromise = runtime.run(
    'hi',
    { sessionId: 'app-1', signal: controller.signal },
    writer,
    makeContext(),
  );
  await tick();

  controller.abort();
  await tick();
  fake.emit({ type: 'agent_settled' });
  await runPromise;

  // Pi keeps emitting after the terminal; these must be ignored.
  fake.emit({ type: 'agent_settled' });
  fake.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'late' } });
  await tick();

  const completes = sent.filter((m) => m.kind === 'complete');
  assert.equal(completes.length, 1);
  assert.equal(completes[0].aborted, true);
  assert.equal(sent.filter((m) => m.content === 'late').length, 0);
});

// T9: grace window elapses with no response → force-kill + aborted complete
test('T9: force-kills after grace window and still completes as aborted', async () => {
  const fake = new FakeRpc();
  const runtime = createPiRuntime({ createRpcClient: () => fake, abortGraceMs: 10 });
  const { writer, sent } = makeWriter();
  const controller = new AbortController();

  const runPromise = runtime.run(
    'hi',
    { sessionId: 'app-1', signal: controller.signal },
    writer,
    makeContext(),
  );
  await tick();

  controller.abort();
  // No agent_settled ever arrives; the bounded window fires close(0).
  const outcome = await runPromise;
  assert.equal(outcome.status, 'aborted');
  assert.equal(fake.abortCalls, 1);
  assert.deepEqual(fake.closeCalls, [0]);
  const completes = sent.filter((m) => m.kind === 'complete');
  assert.equal(completes.length, 1);
  assert.equal(completes[0].aborted, true);
});

// abort() by app session id targets runs owned by that session only
test('abort(sessionId) aborts the matching run', async () => {
  const fake = new FakeRpc();
  const runtime = createPiRuntime({ createRpcClient: () => fake, abortGraceMs: 10 });
  const { writer } = makeWriter();

  const runPromise = runtime.run('hi', { sessionId: 'app-1' }, writer, makeContext());
  await tick();

  assert.equal(runtime.abort('other-session'), false);
  assert.equal(runtime.abort('app-1'), true);

  const outcome = await runPromise;
  assert.equal(outcome.status, 'aborted');
});

// ---------------------------------------------------------------------------
// T28: runtime spawn flags include --no-extensions (matches probe)
// ---------------------------------------------------------------------------

test('T28: default RPC client spawns with --no-extensions', () => {
  let captured: string[] = [];
  const client = new PiRpcClient(
    {},
    {
      createClient: (options) => {
        captured = (options.args as string[]) ?? [];
        return {
          start: async () => {},
          stop: async () => {},
          onEvent: () => () => {},
          getStderr: () => '',
          prompt: async () => {},
          abort: async () => {},
          getState: async () => ({}) as never,
          getAvailableModels: async () => [],
          getCommands: async () => [],
        };
      },
    },
  );
  void client.start();
  assert.ok(captured.includes('--no-extensions'), 'runtime spawn flags include --no-extensions');
});

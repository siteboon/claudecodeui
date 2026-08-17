import assert from 'node:assert/strict';
import test from 'node:test';

import type { StreamBuffers, StreamFlushScheduler, StreamRowSink } from './streamBuffers';
import {
  appendStreamDelta,
  closeStreamBuffer,
  dropStreamBuffers,
  isStreamBoundaryKind,
} from './streamBuffers';

type Write = { call: 'update' | 'finalize'; sessionId: string; text?: string };

/** Records store writes in order, so tests can assert on row lifecycle. */
const createSink = (writes: Write[]): StreamRowSink => ({
  update: (sessionId, text) => writes.push({ call: 'update', sessionId, text }),
  finalize: (sessionId) => writes.push({ call: 'finalize', sessionId }),
});

/** Scheduler whose pending flushes only run when a test says so. */
const createScheduler = () => {
  const pending = new Map<number, () => void>();
  let nextTimer = 1;
  const scheduler: StreamFlushScheduler = {
    schedule: (flush) => {
      const timer = nextTimer++;
      pending.set(timer, flush);
      return timer;
    },
    cancel: (timer) => {
      pending.delete(timer);
    },
  };
  return {
    scheduler,
    flushAll: () => {
      const due = [...pending.values()];
      pending.clear();
      for (const flush of due) flush();
    },
    pendingCount: () => pending.size,
  };
};

test('boundary kinds are the frames that carry a row of their own', () => {
  for (const kind of ['text', 'thinking', 'tool_use', 'tool_result']) {
    assert.equal(isStreamBoundaryKind(kind), true, kind);
  }
  for (const kind of ['stream_delta', 'status', 'complete', 'error', undefined]) {
    assert.equal(isStreamBoundaryKind(kind), false, String(kind));
  }
});

test('deltas are coalesced into one write per flush', () => {
  const writes: Write[] = [];
  const buffers: StreamBuffers = new Map();
  const { scheduler, flushAll, pendingCount } = createScheduler();

  appendStreamDelta(buffers, 's1', 'Hel', createSink(writes), scheduler);
  appendStreamDelta(buffers, 's1', 'lo ', createSink(writes), scheduler);
  appendStreamDelta(buffers, 's1', 'there', createSink(writes), scheduler);

  assert.equal(pendingCount(), 1);
  assert.deepEqual(writes, []);

  flushAll();
  assert.deepEqual(writes, [{ call: 'update', sessionId: 's1', text: 'Hello there' }]);
});

test('a boundary finalizes the row so the next message does not replace it', () => {
  const writes: Write[] = [];
  const sink = createSink(writes);
  const buffers: StreamBuffers = new Map();
  const { scheduler, flushAll } = createScheduler();

  appendStreamDelta(buffers, 's1', 'first message', sink, scheduler);
  flushAll();

  closeStreamBuffer(buffers, 's1', sink, scheduler);

  appendStreamDelta(buffers, 's1', 'second message', sink, scheduler);
  flushAll();
  closeStreamBuffer(buffers, 's1', sink, scheduler);

  assert.deepEqual(writes, [
    { call: 'update', sessionId: 's1', text: 'first message' },
    { call: 'finalize', sessionId: 's1' },
    { call: 'update', sessionId: 's1', text: 'second message' },
    { call: 'finalize', sessionId: 's1' },
  ]);
});

test('closing flushes deltas that never reached a scheduled flush', () => {
  const writes: Write[] = [];
  const sink = createSink(writes);
  const buffers: StreamBuffers = new Map();
  const { scheduler, flushAll, pendingCount } = createScheduler();

  appendStreamDelta(buffers, 's1', 'tail text', sink, scheduler);
  closeStreamBuffer(buffers, 's1', sink, scheduler);

  assert.deepEqual(writes, [
    { call: 'update', sessionId: 's1', text: 'tail text' },
    { call: 'finalize', sessionId: 's1' },
  ]);

  // The cancelled flush must not fire afterwards and re-open the closed row.
  assert.equal(pendingCount(), 0);
  flushAll();
  assert.equal(writes.length, 2);
});

test('closing with no open buffer still frees a row left parked by an earlier switch', () => {
  const writes: Write[] = [];
  const buffers: StreamBuffers = new Map();
  const { scheduler } = createScheduler();

  closeStreamBuffer(buffers, 's1', createSink(writes), scheduler);

  assert.deepEqual(writes, [{ call: 'finalize', sessionId: 's1' }]);
});

test('closing does not repeat a write the row already holds', () => {
  const writes: Write[] = [];
  const sink = createSink(writes);
  const buffers: StreamBuffers = new Map();
  const { scheduler, flushAll } = createScheduler();

  appendStreamDelta(buffers, 's1', 'complete message', sink, scheduler);
  flushAll();
  closeStreamBuffer(buffers, 's1', sink, scheduler);

  assert.deepEqual(writes, [
    { call: 'update', sessionId: 's1', text: 'complete message' },
    { call: 'finalize', sessionId: 's1' },
  ]);
});

test('concurrent sessions keep separate text', () => {
  const writes: Write[] = [];
  const sink = createSink(writes);
  const buffers: StreamBuffers = new Map();
  const { scheduler, flushAll } = createScheduler();

  appendStreamDelta(buffers, 's1', 'from one', sink, scheduler);
  appendStreamDelta(buffers, 's2', 'from two', sink, scheduler);
  flushAll();

  assert.deepEqual(writes, [
    { call: 'update', sessionId: 's1', text: 'from one' },
    { call: 'update', sessionId: 's2', text: 'from two' },
  ]);
});

test('closing one session leaves another session mid-stream untouched', () => {
  const writes: Write[] = [];
  const sink = createSink(writes);
  const buffers: StreamBuffers = new Map();
  const { scheduler, flushAll } = createScheduler();

  appendStreamDelta(buffers, 's1', 'viewed', sink, scheduler);
  appendStreamDelta(buffers, 's2', 'background', sink, scheduler);

  closeStreamBuffer(buffers, 's1', sink, scheduler);
  flushAll();

  assert.deepEqual(writes, [
    { call: 'update', sessionId: 's1', text: 'viewed' },
    { call: 'finalize', sessionId: 's1' },
    { call: 'update', sessionId: 's2', text: 'background' },
  ]);
});

test('dropping one session keeps the other pending flush alive', () => {
  const writes: Write[] = [];
  const sink = createSink(writes);
  const buffers: StreamBuffers = new Map();
  const { scheduler, flushAll } = createScheduler();

  appendStreamDelta(buffers, 's1', 'abandoned', sink, scheduler);
  appendStreamDelta(buffers, 's2', 'still running', sink, scheduler);

  dropStreamBuffers(buffers, scheduler, 's1');
  flushAll();

  assert.deepEqual(writes, [{ call: 'update', sessionId: 's2', text: 'still running' }]);
  assert.equal(buffers.has('s1'), false);
});

test('dropping without a session id abandons every buffer silently', () => {
  const writes: Write[] = [];
  const sink = createSink(writes);
  const buffers: StreamBuffers = new Map();
  const { scheduler, flushAll, pendingCount } = createScheduler();

  appendStreamDelta(buffers, 's1', 'one', sink, scheduler);
  appendStreamDelta(buffers, 's2', 'two', sink, scheduler);

  dropStreamBuffers(buffers, scheduler);
  flushAll();

  assert.deepEqual(writes, []);
  assert.equal(buffers.size, 0);
  assert.equal(pendingCount(), 0);
});

test('a turn that interleaves deltas with a tool call produces one row per message', () => {
  const writes: Write[] = [];
  const sink = createSink(writes);
  const buffers: StreamBuffers = new Map();
  const { scheduler, flushAll } = createScheduler();

  // The OpenCode live sequence: text deltas, a tool_use mid-turn, more deltas,
  // then step_finish. Only the frames that touch the buffer appear here.
  for (const part of ['Reading ', 'the helper.']) {
    appendStreamDelta(buffers, 's1', part, sink, scheduler);
  }
  flushAll();

  closeStreamBuffer(buffers, 's1', sink, scheduler); // tool_use boundary

  for (const part of ['Renamed ', 'it.']) {
    appendStreamDelta(buffers, 's1', part, sink, scheduler);
  }
  flushAll();

  closeStreamBuffer(buffers, 's1', sink, scheduler); // stream_end

  const finalized = writes
    .filter((write, index) => write.call === 'update' && writes[index + 1]?.call === 'finalize')
    .map((write) => write.text);

  assert.deepEqual(finalized, ['Reading the helper.', 'Renamed it.']);
});

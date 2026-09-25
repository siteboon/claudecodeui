import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import {
  handleChatConnection,
  type ProviderRuntimeGateway,
} from '@/modules/websocket/services/chat-websocket.service.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';
import type { AnyRecord, LLMProvider } from '@/shared/types.js';

const SESSION_ID = 'steer-session';

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: Array<Record<string, unknown>>;
    send: (data: string) => void;
  };
  socket.readyState = 1;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(JSON.parse(data) as Record<string, unknown>);
  return socket;
}

type Calls = {
  steer: Array<{ provider: LLMProvider; sessionId: string; command: string; options: AnyRecord }>;
  run: Array<{ provider: LLMProvider; command: string; options: AnyRecord }>;
  order: string[];
};

/** A gateway whose steer/abort/run are all observable, so ordering and arguments can be asserted directly. */
function createRuntimeStub(canSteer: boolean): { runtime: ProviderRuntimeGateway; calls: Calls } {
  const calls: Calls = { steer: [], run: [], order: [] };

  const runtime: ProviderRuntimeGateway = {
    hasRuntime: () => true,
    run: async (provider, command, options) => {
      calls.run.push({ provider, command, options });
      calls.order.push('run');
    },
    abort: async () => {
      calls.order.push('abort');
      return true;
    },
    stopBackgroundTask: async () => false,
    hasBackgroundWork: () => false,
    resolveToolApproval: () => {},
    getPendingApprovalsForSession: () => [],
    canSteer: () => canSteer,
    steer: async (provider, sessionId, command, options) => {
      calls.steer.push({ provider, sessionId, command, options });
      return { uuid: 'u1' };
    },
  };

  return { runtime, calls };
}

async function withGateway(
  canSteer: boolean,
  runTest: (context: { socket: ReturnType<typeof createFakeSocket>; calls: Calls }) => Promise<void>,
): Promise<void> {
  const { runtime, calls } = createRuntimeStub(canSteer);
  await withCustomGateway(runtime, calls, runTest);
}

/**
 * Same setup as `withGateway`, but for a caller that needs a `runtime` whose
 * `steer` does something beyond the default stub (e.g. resolving `null`, or
 * mutating `chatRunRegistry` mid-call) — used to cover the "turn ended while
 * `steer` was in flight" race.
 */
async function withCustomGateway(
  runtime: ProviderRuntimeGateway,
  calls: Calls,
  runTest: (context: { socket: ReturnType<typeof createFakeSocket>; calls: Calls }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-steer-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const socket = createFakeSocket();

  try {
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory);

    handleChatConnection(socket as never, { user: { id: 1 } } as never, { runtime });

    await runTest({ socket, calls });
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** The handler is async and the socket listener does not await it. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 30); });

test('chat.steer on a running session folds in: echoes to the run, acks the sender, never calls run', async () => {
  await withGateway(true, async ({ socket, calls }) => {
    chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: socket as never,
      userId: 1,
    });

    socket.emit('message', JSON.stringify({ type: 'chat.steer', sessionId: SESSION_ID, content: 'also do X' }));
    await settle();

    assert.deepEqual(calls.steer.map((call) => [call.provider, call.sessionId, call.command]), [['claude', SESSION_ID, 'also do X']]);
    assert.equal(calls.run.length, 0, 'a fold never starts a new run');

    const echo = socket.frames.find((frame) => frame.kind === 'text' && frame.role === 'user');
    assert.ok(echo, 'the steered message is echoed on the run stream');
    assert.equal(echo?.id, 'local_steer_u1');
    assert.equal(echo?.steered, true);

    const ack = socket.frames.find((frame) => frame.kind === 'chat_steered');
    assert.ok(ack, 'the sender gets an ack');
    assert.equal(ack?.uuid, 'u1');
  });
});

test('chat.steer on an idle session behaves like chat.send', async () => {
  await withGateway(true, async ({ socket, calls }) => {
    socket.emit('message', JSON.stringify({ type: 'chat.steer', sessionId: SESSION_ID, content: 'hello' }));
    await settle();

    assert.equal(calls.run.length, 1, 'nothing running, so it dispatches as an ordinary run');
    assert.equal(calls.steer.length, 0);
    assert.equal(socket.frames.some((frame) => frame.kind === 'protocol_error'), false);

    // The sender still needs a `chat_steered` ack (its composer is waiting on
    // one, not a plain `complete`) but flagged `fallback: true` — no uuid, no
    // fold — so the client can convert its pending steer into a normal send.
    const ack = socket.frames.find((frame) => frame.kind === 'chat_steered');
    assert.ok(ack, 'the sender gets a fallback ack even though nothing was folded');
    assert.equal(ack?.uuid, null);
    assert.equal(ack?.fallback, true);
  });
});

test('chat.steer is refused with STEER_UNSUPPORTED when the provider cannot steer', async () => {
  await withGateway(false, async ({ socket, calls }) => {
    chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: socket as never,
      userId: 1,
    });

    socket.emit('message', JSON.stringify({ type: 'chat.steer', sessionId: SESSION_ID, content: 'also do X' }));
    await settle();

    assert.equal(calls.steer.length, 0);
    assert.equal(calls.run.length, 0);
    const error = socket.frames.find((frame) => frame.kind === 'protocol_error');
    assert.ok(error);
    assert.equal(error?.code, 'STEER_UNSUPPORTED');
    // Tags the error with the frame that triggered it so the client can tell
    // this apart from an ordinary chat.send/chat.edit-send RUN_IN_PROGRESS
    // that happens to share a code with a pending-steer rejection — see
    // useChatRealtimeHandlers.ts's protocol_error handling.
    assert.equal(error?.requestType, 'chat.steer');
  });
});

test('chat.steer whose runtime throws reports STEER_UNSUPPORTED, not an untagged INTERNAL_ERROR', async () => {
  const calls: Calls = { steer: [], run: [], order: [] };
  const runtime: ProviderRuntimeGateway = {
    hasRuntime: () => true,
    run: async (provider, command, options) => {
      calls.run.push({ provider, command, options });
      calls.order.push('run');
    },
    abort: async () => {
      calls.order.push('abort');
      return true;
    },
    stopBackgroundTask: async () => false,
    hasBackgroundWork: () => false,
    resolveToolApproval: () => {},
    getPendingApprovalsForSession: () => [],
    canSteer: () => true,
    steer: async (provider, sessionId, command, options) => {
      calls.steer.push({ provider, sessionId, command, options });
      // e.g. buildPromptMessages failing on an unreadable image attachment.
      throw new Error('cannot read attachment');
    },
  };

  await withCustomGateway(runtime, calls, async ({ socket }) => {
    chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: socket as never,
      userId: 1,
    });

    socket.emit('message', JSON.stringify({ type: 'chat.steer', sessionId: SESSION_ID, content: 'also do X' }));
    await settle();

    assert.equal(socket.frames.some((frame) => frame.code === 'INTERNAL_ERROR'), false, 'must not fall through to the generic untagged handler');

    const error = socket.frames.find((frame) => frame.kind === 'protocol_error');
    assert.ok(error, 'the sender gets a protocol error');
    assert.equal(error?.code, 'STEER_UNSUPPORTED');
    assert.equal(error?.sessionId, SESSION_ID, 'tagged with the session so the client can re-queue the steer');
    assert.equal(error?.requestType, 'chat.steer');
  });
});

test('chat.send refused with RUN_IN_PROGRESS carries requestType: chat.send, not chat.steer', async () => {
  await withGateway(true, async ({ socket }) => {
    chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: socket as never,
      userId: 1,
    });

    socket.emit('message', JSON.stringify({ type: 'chat.send', sessionId: SESSION_ID, content: 'hello' }));
    await settle();

    const error = socket.frames.find((frame) => frame.kind === 'protocol_error');
    assert.ok(error);
    assert.equal(error?.code, 'RUN_IN_PROGRESS');
    assert.equal(error?.requestType, 'chat.send');
  });
});

test('chat.steer whose turn ends mid-call (steer resolves null after the run completes) falls back to a normal run', async () => {
  const calls: Calls = { steer: [], run: [], order: [] };
  const runtime: ProviderRuntimeGateway = {
    hasRuntime: () => true,
    run: async (provider, command, options) => {
      calls.run.push({ provider, command, options });
      calls.order.push('run');
    },
    abort: async () => {
      calls.order.push('abort');
      return true;
    },
    stopBackgroundTask: async () => false,
    hasBackgroundWork: () => false,
    resolveToolApproval: () => {},
    getPendingApprovalsForSession: () => [],
    canSteer: () => true,
    steer: async (provider, sessionId, command, options) => {
      calls.steer.push({ provider, sessionId, command, options });
      // Simulates the turn finishing while `steer` was still awaiting its
      // own async work (e.g. reading image attachments): the registry
      // already sees the run as completed by the time `steer` returns.
      chatRunRegistry.completeRun(sessionId, { exitCode: 0 });
      return null;
    },
  };

  await withCustomGateway(runtime, calls, async ({ socket }) => {
    chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: socket as never,
      userId: 1,
    });

    socket.emit('message', JSON.stringify({ type: 'chat.steer', sessionId: SESSION_ID, content: 'also do X' }));
    await settle();

    assert.equal(calls.run.length, 1, 'falls back to a normal run instead of dropping the message');
    assert.equal(socket.frames.some((frame) => frame.code === 'STEER_UNSUPPORTED'), false);

    const ack = socket.frames.find((frame) => frame.kind === 'chat_steered');
    assert.ok(ack, 'the sender still gets a chat_steered ack');
    assert.equal(ack?.uuid, null);
    assert.equal(ack?.fallback, true);
  });
});

test('chat.steer returning null while the run is still processing stays STEER_UNSUPPORTED, no run', async () => {
  const calls: Calls = { steer: [], run: [], order: [] };
  const runtime: ProviderRuntimeGateway = {
    hasRuntime: () => true,
    run: async (provider, command, options) => {
      calls.run.push({ provider, command, options });
      calls.order.push('run');
    },
    abort: async () => {
      calls.order.push('abort');
      return true;
    },
    stopBackgroundTask: async () => false,
    hasBackgroundWork: () => false,
    resolveToolApproval: () => {},
    getPendingApprovalsForSession: () => [],
    canSteer: () => true,
    steer: async (provider, sessionId, command, options) => {
      calls.steer.push({ provider, sessionId, command, options });
      // The run is still registered as processing — `steer` just failed for
      // some other reason (e.g. the process is winding down but hasn't
      // reported completion yet).
      return null;
    },
  };

  await withCustomGateway(runtime, calls, async ({ socket }) => {
    chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: socket as never,
      userId: 1,
    });

    socket.emit('message', JSON.stringify({ type: 'chat.steer', sessionId: SESSION_ID, content: 'also do X' }));
    await settle();

    assert.equal(calls.run.length, 0, 'still processing, so no fallback run is started');
    const error = socket.frames.find((frame) => frame.kind === 'protocol_error');
    assert.ok(error);
    assert.equal(error?.code, 'STEER_UNSUPPORTED');
  });
});

test('chat.send with options.interrupt on a running session aborts, then runs — never RUN_IN_PROGRESS', async () => {
  await withGateway(true, async ({ socket, calls }) => {
    chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: socket as never,
      userId: 1,
    });

    socket.emit('message', JSON.stringify({
      type: 'chat.send',
      sessionId: SESSION_ID,
      content: 'replace it',
      options: { interrupt: true },
    }));
    await settle();

    assert.deepEqual(calls.order, ['abort', 'run']);
    assert.equal(socket.frames.some((frame) => frame.code === 'RUN_IN_PROGRESS'), false);

    // The interrupted run's own `complete {aborted:true}` must say a
    // replacement run is taking over, so the client does not idle the
    // session for the whole replacement turn.
    const abortComplete = socket.frames.find((frame) => frame.kind === 'complete' && frame.aborted === true);
    assert.ok(abortComplete, 'the interrupted run emits its terminal complete');
    assert.equal(abortComplete?.replaced, true);
  });
});

test('chat.send with options.interrupt carries a second attached socket over to the replacement run', async () => {
  const calls: Calls = { steer: [], run: [], order: [] };
  const runtime: ProviderRuntimeGateway = {
    hasRuntime: () => true,
    run: async (provider, command, options, writer) => {
      calls.run.push({ provider, command, options });
      calls.order.push('run');
      // The replacement run's own live event — distinct from the old run's
      // `complete { replaced: true }` — proves a carried-over socket is
      // actually attached to the NEW run's writer, not just a leftover.
      writer.send({ kind: 'text', role: 'assistant', content: 'replacement turn', sessionId: SESSION_ID, provider });
    },
    abort: async () => {
      calls.order.push('abort');
      return true;
    },
    stopBackgroundTask: async () => false,
    hasBackgroundWork: () => false,
    resolveToolApproval: () => {},
    getPendingApprovalsForSession: () => [],
    canSteer: () => true,
    steer: async () => null,
  };

  await withCustomGateway(runtime, calls, async ({ socket: socketA }) => {
    chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: socketA as never,
      userId: 1,
    });

    // A second tab on the same session, attached via chat.subscribe the same
    // way a real reconnect/second-tab would be.
    const socketB = createFakeSocket();
    handleChatConnection(socketB as never, { user: { id: 1 } } as never, { runtime });
    socketB.emit('message', JSON.stringify({ type: 'chat.subscribe', sessions: [{ sessionId: SESSION_ID, lastSeq: 0 }] }));
    await settle();

    socketA.emit('message', JSON.stringify({
      type: 'chat.send',
      sessionId: SESSION_ID,
      content: 'replace it',
      options: { interrupt: true },
    }));
    await settle();

    const replacedComplete = socketB.frames.find((frame) => frame.kind === 'complete' && frame.replaced === true);
    assert.ok(replacedComplete, 'B sees the old run end with replaced: true, as before');

    const replacementEvent = socketB.frames.find((frame) => frame.kind === 'text' && frame.content === 'replacement turn');
    assert.ok(replacementEvent, 'B must also receive the replacement run\'s own events, not just the old run\'s replaced-complete');

    const completes = socketB.frames.filter((frame) => frame.kind === 'complete');
    assert.equal(completes.length, 2, 'B sees both the old run\'s replaced complete and the new run\'s own terminal complete');
    assert.notEqual(completes[1]?.replaced, true, 'the replacement run\'s own terminal complete is not itself flagged replaced');
  });
});

test('chat.abort emits a complete that does NOT carry replaced: true', async () => {
  await withGateway(true, async ({ socket, calls }) => {
    chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: socket as never,
      userId: 1,
    });

    socket.emit('message', JSON.stringify({ type: 'chat.abort', sessionId: SESSION_ID }));
    await settle();

    assert.deepEqual(calls.order, ['abort']);
    const abortComplete = socket.frames.find((frame) => frame.kind === 'complete' && frame.aborted === true);
    assert.ok(abortComplete, 'the aborted run emits its terminal complete');
    assert.notEqual(abortComplete?.replaced, true);
  });
});

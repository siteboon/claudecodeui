import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RequestRouter,
  defaultServerRequestHandler,
} from '@/modules/providers/list/zcode/zcode-request-router.js';

type FakeTransport = {
  ensureRunningCalls: number;
  written: string[];
};

function createRouter() {
  const transport: FakeTransport = { ensureRunningCalls: 0, written: [] };
  const router = new RequestRouter({
    ensureRunning: async () => {
      transport.ensureRunningCalls += 1;
    },
    writeLine: (line: string) => {
      transport.written.push(line);
    },
  });
  return { router, transport };
}

/**
 * Lets the async request() bodies run past their internal
 * `await transport.ensureRunning()` so pending entries and written lines
 * exist before the test asserts on them.
 */
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('request correlates the response by id and ensures the engine is running', async () => {
  const { router, transport } = createRouter();

  const pending = router.request<{ echoed: number }>('session/create', { workspace: {} });
  await flush();

  assert.equal(transport.ensureRunningCalls, 1);
  assert.equal(transport.written.length, 1);

  const request = JSON.parse(transport.written[0]) as { id: number; method: string };
  assert.equal(request.method, 'session/create');

  router.handleLine(JSON.stringify({ id: request.id, result: { echoed: request.id } }));
  assert.deepEqual(await pending, { echoed: request.id });
});

test('request rejects with a protocol error message when the engine returns an error', async () => {
  const { router, transport } = createRouter();

  const pending = router.request('session/subscribe', {});
  await flush();

  const request = JSON.parse(transport.written[0]) as { id: number };
  router.handleLine(JSON.stringify({ id: request.id, error: { code: -32004, message: 'inactive session' } }));

  await assert.rejects(pending, (error: unknown) => {
    const err = error as { message: string; code?: number };
    return err.message === 'inactive session' && err.code === -32004;
  });
});

test('request times out when no response arrives', async () => {
  const { router } = createRouter();

  await assert.rejects(
    () => router.request('session/send', {}, 10),
    /Request timeout after 10ms/,
  );
});

test('a timeout of zero never times the request out', async () => {
  const { router } = createRouter();

  let settled = false;
  const pending = router.request('session/send', {}, 0).then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(settled, false);
});

test('default handler answers runtime preferences and rejects unknown methods', () => {
  const preferences = defaultServerRequestHandler({
    id: 'server-1',
    method: 'session/requestRuntimePreferences',
  });
  assert.deepEqual(preferences, { result: { nativeSearchEnhancementsEnabled: false } });

  const unknown = defaultServerRequestHandler({
    id: 'server-2',
    method: 'interaction/requestPermission',
  });
  assert.deepEqual(unknown, { error: { code: -32601, message: 'Method not found: interaction/requestPermission' } });
});

test('server requests are answered through the injectable handler', async () => {
  const { router, transport } = createRouter();
  router.setServerRequestHandler((request) => ({ result: { answeredFor: request.method } }));

  router.handleLine(JSON.stringify({
    id: 'server-5',
    method: 'session/customCallback',
    params: {},
  }));
  await flush();

  const response = JSON.parse(transport.written[0]) as { id: string; result: unknown };
  assert.deepEqual(response, {
    id: 'server-5',
    result: { answeredFor: 'session/customCallback' },
  });
});

test('a throwing server-request handler answers with an internal error instead of silence', async () => {
  const { router, transport } = createRouter();
  router.setServerRequestHandler(() => {
    throw new Error('handler exploded');
  });

  router.handleLine(JSON.stringify({ id: 'server-6', method: 'session/anything', params: {} }));
  await flush();

  const response = JSON.parse(transport.written[0]) as { id: string; error: { code: number; message: string } };
  assert.equal(response.id, 'server-6');
  assert.equal(response.error.code, -32603);
  assert.match(response.error.message, /handler exploded/);
});

test('session events route to listeners by flat and nested session ids only', () => {
  const { router } = createRouter();
  const received: string[] = [];
  const listener = (notification: { params: Record<string, unknown> }) => {
    received.push(JSON.stringify(notification.params));
  };

  router.addSessionListener('sess_route', listener);
  router.handleLine(JSON.stringify({
    method: 'session/event',
    params: { sessionId: 'sess_route', type: 'model_streaming' },
  }));
  router.handleLine(JSON.stringify({
    method: 'session/event',
    params: { event: { sessionId: 'sess_route', type: 'turn_complete' } },
  }));
  // Other sessions and other methods never reach the listener.
  router.handleLine(JSON.stringify({
    method: 'session/event',
    params: { sessionId: 'sess_other' },
  }));
  router.handleLine(JSON.stringify({
    method: 'workspace/stateChanged',
    params: { sessionId: 'sess_route' },
  }));

  assert.equal(received.length, 2);
});

test('failAllPending rejects every in-flight request with the given reason', async () => {
  const { router, transport } = createRouter();

  const pending = router.request('session/send', {}, 0);
  const second = router.request('session/create', {}, 0);
  await flush();
  assert.equal(transport.written.length, 2);

  router.failAllPending(new Error('ZCode process terminated unexpectedly'));

  await assert.rejects(pending, /ZCode process terminated unexpectedly/);
  await assert.rejects(second, /ZCode process terminated unexpectedly/);
});

test('notifySessionLost delivers a synthetic loss notification to every registered session', () => {
  const { router } = createRouter();
  const lost: Array<{ sessionId: string; code: number | null }> = [];
  const listener = (notification: { method: string; params: Record<string, unknown> }) => {
    const params = notification.params as { sessionId: string; code: number | null };
    lost.push({ sessionId: params.sessionId, code: params.code });
  };

  router.addSessionListener('sess_1', listener);
  router.addSessionListener('sess_2', listener);
  router.notifySessionLost(1, null);

  assert.deepEqual(lost, [
    { sessionId: 'sess_1', code: 1 },
    { sessionId: 'sess_2', code: 1 },
  ]);
});

test('removeSessionListener detaches exactly the registered function', () => {
  const { router } = createRouter();
  let calls = 0;
  const listener = () => {
    calls += 1;
  };

  router.addSessionListener('sess_remove', listener);
  router.removeSessionListener('sess_remove', listener);
  router.handleLine(JSON.stringify({ method: 'session/event', params: { sessionId: 'sess_remove' } }));

  assert.equal(calls, 0);
});

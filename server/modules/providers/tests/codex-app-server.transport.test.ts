import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';

import {
  CodexAppServerTransport,
  JsonRpcRemoteError,
  JsonRpcTransportClosedError,
  type JsonRpcWireFormat,
  type JsonRpcDiagnostic,
  type JsonRpcRequest,
} from '@/modules/providers/list/codex/codex-app-server.transport.js';

type TransportHarness = {
  input: PassThrough;
  output: PassThrough;
  stderr: PassThrough;
  diagnostics: JsonRpcDiagnostic[];
  transport: CodexAppServerTransport;
  nextOutputMessage: () => Promise<Record<string, unknown>>;
};

function createHarness(options: {
  wireFormat?: JsonRpcWireFormat;
  onRequest?: (request: JsonRpcRequest) => unknown | Promise<unknown>;
  onNotification?: (notification: { jsonrpc: '2.0'; method: string; params?: unknown }) => void;
} = {}): TransportHarness {
  const input = new PassThrough();
  const output = new PassThrough();
  const stderr = new PassThrough();
  const diagnostics: JsonRpcDiagnostic[] = [];
  const outputQueue: Record<string, unknown>[] = [];
  const outputWaiters: Array<(message: Record<string, unknown>) => void> = [];
  let outputBuffer = '';

  output.on('data', (chunk: Buffer | string) => {
    outputBuffer += String(chunk);
    let newlineIndex = outputBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = outputBuffer.slice(0, newlineIndex).trim();
      outputBuffer = outputBuffer.slice(newlineIndex + 1);
      if (line) {
        const message = JSON.parse(line) as Record<string, unknown>;
        const waiter = outputWaiters.shift();
        if (waiter) {
          waiter(message);
        } else {
          outputQueue.push(message);
        }
      }
      newlineIndex = outputBuffer.indexOf('\n');
    }
  });

  const transport = new CodexAppServerTransport({
    input,
    output,
    stderr,
    wireFormat: options.wireFormat,
    onRequest: options.onRequest,
    onNotification: options.onNotification,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  return {
    input,
    output,
    stderr,
    diagnostics,
    transport,
    nextOutputMessage: () => {
      const queued = outputQueue.shift();
      if (queued) {
        return Promise.resolve(queued);
      }
      return new Promise((resolve) => outputWaiters.push(resolve));
    },
  };
}

function writeInput(input: PassThrough, message: unknown): void {
  input.write(`${JSON.stringify(message)}\n`);
}

test('times out unanswered requests by default and ignores late responses', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const harness = createHarness();
  const requestPromise = harness.transport.request('thread/fork', { threadId: 'thread-1' });
  const rejection = assert.rejects(requestPromise, /thread\/fork timed out after 30000 ms/);
  const request = await harness.nextOutputMessage();

  context.mock.timers.tick(29_999);
  assert.equal(harness.transport.pendingRequestCount, 1);
  context.mock.timers.tick(1);
  await rejection;
  assert.equal(harness.transport.pendingRequestCount, 0);

  writeInput(harness.input, { jsonrpc: '2.0', id: request.id, result: {} });
  assert.equal(harness.diagnostics.at(-1)?.type, 'orphan_response');
  const nextPromise = harness.transport.request('thread/list');
  const nextRequest = await harness.nextOutputMessage();
  writeInput(harness.input, { jsonrpc: '2.0', id: nextRequest.id, result: { threads: [] } });
  assert.deepEqual(await nextPromise, { threads: [] });
});

test('honors a per-request deadline and rejects invalid deadlines', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const harness = createHarness();
  const requestPromise = harness.transport.request('initialize', {}, { timeoutMs: 10 });
  const rejection = assert.rejects(requestPromise, /initialize timed out after 10 ms/);
  await harness.nextOutputMessage();
  context.mock.timers.tick(10);
  await rejection;

  for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
    await assert.rejects(harness.transport.request('initialize', {}, { timeoutMs }), RangeError);
  }
  assert.equal(harness.transport.pendingRequestCount, 0);
});

test('decodes UTF-8 characters split across stdout chunks without corrupting frames', () => {
  const notifications: unknown[] = [];
  const harness = createHarness({ onNotification: (notification) => notifications.push(notification) });
  const notification = {
    jsonrpc: '2.0',
    method: 'item/completed',
    params: { text: '你好，世界 🌍 café' },
  };

  for (const byte of Buffer.from(`${JSON.stringify(notification)}\n`)) {
    harness.input.write(Buffer.from([byte]));
  }

  assert.deepEqual(notifications, [notification]);
  assert.deepEqual(harness.diagnostics, []);
});

test('flushes an incomplete UTF-8 character when stdout ends', async () => {
  const harness = createHarness();
  harness.input.write(Buffer.from([0xe4, 0xb8]));
  await new Promise<void>((resolve) => {
    harness.input.once('end', resolve);
    harness.input.end();
  });

  const diagnostic = harness.diagnostics.find((entry) => entry.type === 'malformed_message');
  assert.equal(diagnostic?.line, '\ufffd');
  assert.equal(harness.transport.isClosed, true);
});

for (const closeTarget of ['transport', 'output', 'input']) {
  test(`settles backpressured and queued writes when ${closeTarget} closes`, async () => {
    const input = new PassThrough();
    const output = new Writable({ highWaterMark: 1, write() {} });
    const transport = new CodexAppServerTransport({ input, output });
    const firstWrite = transport.notify('first');
    const queuedWrite = transport.notify('second');
    const rejections = Promise.all([
      assert.rejects(firstWrite, JsonRpcTransportClosedError),
      assert.rejects(queuedWrite, JsonRpcTransportClosedError),
    ]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(output.listenerCount('drain'), 1);

    if (closeTarget === 'transport') {
      transport.close();
    } else if (closeTarget === 'output') {
      output.destroy();
    } else {
      input.destroy();
    }

    await rejections;
    assert.equal(output.listenerCount('drain'), 0);
    assert.equal(output.listenerCount('error'), 1);
  });
}

test('removes backpressure listeners after a successful drain', async () => {
  const output = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, callback) {
      setImmediate(callback);
    },
  });
  const transport = new CodexAppServerTransport({ input: new PassThrough(), output });

  await transport.notify('initialized');

  assert.equal(output.listenerCount('drain'), 0);
  assert.equal(output.listenerCount('error'), 1);
});

test('does not send a queued request after its deadline has expired', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const messages: string[] = [];
  let releaseWrite: (() => void) | undefined;
  const output = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      messages.push(String(chunk));
      if (messages.length === 1) {
        releaseWrite = callback;
      } else {
        callback();
      }
    },
  });
  const transport = new CodexAppServerTransport({ input: new PassThrough(), output });
  const firstWrite = transport.notify('first');
  await new Promise<void>((resolve) => setImmediate(resolve));
  const requestPromise = transport.request('thread/fork', {}, { timeoutMs: 10 });
  const rejection = assert.rejects(requestPromise, /timed out/);

  context.mock.timers.tick(10);
  await rejection;
  assert.ok(releaseWrite);
  releaseWrite();
  await firstWrite;
  await transport.notify('last');

  assert.deepEqual(messages.map((message) => JSON.parse(message).method), ['first', 'last']);
});

test('correlates out-of-order responses and preserves JSON-RPC request framing', async () => {
  const harness = createHarness();
  const firstPromise = harness.transport.request<{ value: string }>('thread/start', { cwd: '/tmp/one' });
  const secondPromise = harness.transport.request<{ value: string }>('thread/read');

  const firstRequest = await harness.nextOutputMessage();
  const secondRequest = await harness.nextOutputMessage();

  assert.equal(firstRequest.jsonrpc, '2.0');
  assert.equal(firstRequest.method, 'thread/start');
  assert.deepEqual(firstRequest.params, { cwd: '/tmp/one' });
  assert.equal(secondRequest.method, 'thread/read');

  writeInput(harness.input, { jsonrpc: '2.0', id: secondRequest.id, result: { value: 'history' } });
  writeInput(harness.input, { jsonrpc: '2.0', id: firstRequest.id, result: { value: 'started' } });

  assert.deepEqual(await firstPromise, { value: 'started' });
  assert.deepEqual(await secondPromise, { value: 'history' });
  assert.equal(harness.transport.pendingRequestCount, 0);
});

test('supports Codex app-server headerless stdio frames', async () => {
  const harness = createHarness({ wireFormat: 'codex-app-server' });
  const responsePromise = harness.transport.request<{ ready: boolean }>('initialize', {
    clientInfo: { name: 'cloudcli' },
  });

  const request = await harness.nextOutputMessage();
  assert.equal(request.jsonrpc, undefined);
  assert.equal(request.method, 'initialize');

  writeInput(harness.input, { id: request.id, result: { ready: true } });
  assert.deepEqual(await responsePromise, { ready: true });
});

test('dispatches server requests and writes the handler result as a response', async () => {
  const seenRequests: JsonRpcRequest[] = [];
  const harness = createHarness({
    onRequest: async (request) => {
      seenRequests.push(request);
      return { decision: 'accept' };
    },
  });

  writeInput(harness.input, {
    jsonrpc: '2.0',
    id: 41,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 'thread-1', turnId: 'turn-1' },
  });

  const response = await harness.nextOutputMessage();
  assert.deepEqual(seenRequests, [{
    jsonrpc: '2.0',
    id: 41,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 'thread-1', turnId: 'turn-1' },
  }]);
  assert.deepEqual(response, {
    jsonrpc: '2.0',
    id: 41,
    result: { decision: 'accept' },
  });
});

test('returns method-not-found for an unhandled server request and records a diagnostic', async () => {
  const harness = createHarness();

  writeInput(harness.input, { jsonrpc: '2.0', id: 'server-request-1', method: 'unknown/request' });

  const response = await harness.nextOutputMessage();
  assert.deepEqual(response, {
    jsonrpc: '2.0',
    id: 'server-request-1',
    error: {
      code: -32601,
      message: 'No handler registered for unknown/request',
    },
  });
  assert.deepEqual(harness.diagnostics, [{
    type: 'unhandled_request',
    request: { jsonrpc: '2.0', id: 'server-request-1', method: 'unknown/request' },
  }]);
});

test('encodes an undefined server-handler result as JSON null', async () => {
  const harness = createHarness({
    onRequest: () => undefined,
  });

  writeInput(harness.input, { jsonrpc: '2.0', id: 9, method: 'server/notification' });

  assert.deepEqual(await harness.nextOutputMessage(), {
    jsonrpc: '2.0',
    id: 9,
    result: null,
  });
});

test('rejects remote errors with their JSON-RPC code and data', async () => {
  const harness = createHarness();
  const requestPromise = harness.transport.request('thread/resume', { threadId: 'missing' });
  const request = await harness.nextOutputMessage();

  writeInput(harness.input, {
    jsonrpc: '2.0',
    id: request.id,
    error: { code: -32004, message: 'Thread not found', data: { threadId: 'missing' } },
  });

  await assert.rejects(requestPromise, (error: unknown) => {
    assert.ok(error instanceof JsonRpcRemoteError);
    assert.equal(error.requestId, request.id);
    assert.equal(error.code, -32004);
    assert.deepEqual(error.data, { threadId: 'missing' });
    return true;
  });
});

test('diagnoses malformed and invalid messages without stopping later frames', async () => {
  const notifications: unknown[] = [];
  const harness = createHarness({
    onNotification: (notification) => notifications.push(notification),
  });

  harness.input.write('{not-json}\n');
  writeInput(harness.input, { jsonrpc: '1.0', method: 'ignored' });
  writeInput(harness.input, { jsonrpc: '2.0', method: 'status/changed', params: { status: 'idle' } });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(harness.transport.isClosed, false);
  assert.deepEqual(notifications, [{
    jsonrpc: '2.0',
    method: 'status/changed',
    params: { status: 'idle' },
  }]);
  assert.equal(harness.diagnostics.filter((diagnostic) => diagnostic.type === 'malformed_message').length, 1);
  assert.equal(harness.diagnostics.filter((diagnostic) => diagnostic.type === 'invalid_message').length, 1);
});

test('surfaces stderr diagnostics and rejects pending requests when input ends', async () => {
  const harness = createHarness();
  const requestPromise = harness.transport.request('initialize');
  await harness.nextOutputMessage();

  harness.stderr.write('Codex diagnostic\n');
  harness.input.write('{"jsonrpc":"2.0"');
  harness.input.end();

  await assert.rejects(requestPromise, JsonRpcTransportClosedError);
  assert.equal(harness.transport.isClosed, true);
  assert.equal(harness.transport.pendingRequestCount, 0);
  assert.equal(harness.diagnostics.some(
    (diagnostic) => diagnostic.type === 'stderr' && diagnostic.text.includes('Codex diagnostic'),
  ), true);
  assert.equal(harness.diagnostics.some(
    (diagnostic) => diagnostic.type === 'malformed_message'
      && diagnostic.error.message.includes('incomplete line'),
  ), true);
});

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
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

/**
 * Real unit tests for StdioJsonRpcClient.
 *
 * Backs the JSON-RPC 2.0 wire protocol against an in-process child substitute:
 * a Node Duplex acting as the child's stdio pair so we can drive byte streams
 * exactly like the real ChildProcessWithoutNullStreams. No mocks, no spies —
 * the assertions exercise the real transport state machine.
 *
 * Run with `node --test --import tsx`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import { StdioJsonRpcClient } from '@/modules/providers/list/kiro/stdio-jsonrpc-client.js';

// Build a minimal stand-in matching the surface area StdioJsonRpcClient uses:
// stdin (writable), stdout (readable), stderr (readable), and the EE for
// 'close' / 'error'. The class never touches any other ChildProcess fields.
function makeFakeChild(): {
  child: ChildProcessWithoutNullStreams;
  emitStdout: (chunk: string) => void;
  emitStderr: (chunk: string) => void;
  emitClose: (code: number | null) => void;
  emitError: (err: Error) => void;
  stdinWrites: string[];
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdinWrites: string[] = [];
  const stdin = {
    write(chunk: string, callback?: (err?: Error | null) => void): boolean {
      stdinWrites.push(chunk);
      callback?.(null);
      return true;
    },
    end(): void {},
  };

  const ee = new EventEmitter();
  const fake = Object.assign(ee, {
    stdin,
    stdout,
    stderr,
    killed: false,
  });

  return {
    child: fake as unknown as ChildProcessWithoutNullStreams,
    emitStdout: (chunk: string) => stdout.write(chunk),
    emitStderr: (chunk: string) => stderr.write(chunk),
    emitClose: (code: number | null) => ee.emit('close', code),
    emitError: (err: Error) => ee.emit('error', err),
    stdinWrites,
  };
}

describe('StdioJsonRpcClient', () => {
  it('correlates request id to response result', async () => {
    const fake = makeFakeChild();
    const client = new StdioJsonRpcClient(fake.child);

    const promise = client.request<{ value: number }>('test/method', { foo: 1 });

    // Verify the wire format we produced
    assert.equal(fake.stdinWrites.length, 1);
    const sent = JSON.parse(fake.stdinWrites[0].trim());
    assert.equal(sent.jsonrpc, '2.0');
    assert.equal(sent.method, 'test/method');
    assert.deepEqual(sent.params, { foo: 1 });
    assert.equal(typeof sent.id, 'number');

    // Send back a matching response
    fake.emitStdout(`${JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: { value: 42 } })}\n`);

    const result = await promise;
    assert.deepEqual(result, { value: 42 });
  });

  it('rejects on JSON-RPC error frame with the error message', async () => {
    const fake = makeFakeChild();
    const client = new StdioJsonRpcClient(fake.child);

    const promise = client.request('failing/method');
    const sent = JSON.parse(fake.stdinWrites[0].trim());

    fake.emitStdout(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: sent.id,
        error: { code: -32603, message: 'Internal error', data: { detail: 'kiro broke' } },
      })}\n`,
    );

    await assert.rejects(promise, (err: Error) => {
      assert.match(err.message, /Internal error/);
      assert.match(err.message, /failing\/method/);
      return true;
    });
  });

  it('handles a frame split across multiple stdout chunks', async () => {
    const fake = makeFakeChild();
    const client = new StdioJsonRpcClient(fake.child);

    const promise = client.request('split/test');
    const sent = JSON.parse(fake.stdinWrites[0].trim());
    const fullFrame = JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: 'ok' }) + '\n';

    // Split mid-string across 4 chunks
    fake.emitStdout(fullFrame.slice(0, 5));
    fake.emitStdout(fullFrame.slice(5, 20));
    fake.emitStdout(fullFrame.slice(20, 35));
    fake.emitStdout(fullFrame.slice(35));

    assert.equal(await promise, 'ok');
  });

  it('handles multiple frames in one chunk', async () => {
    const fake = makeFakeChild();
    const client = new StdioJsonRpcClient(fake.child);

    const p1 = client.request('a');
    const p2 = client.request('b');
    const id1 = JSON.parse(fake.stdinWrites[0]).id;
    const id2 = JSON.parse(fake.stdinWrites[1]).id;

    const combined =
      JSON.stringify({ jsonrpc: '2.0', id: id1, result: 'first' }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: id2, result: 'second' }) + '\n';
    fake.emitStdout(combined);

    assert.equal(await p1, 'first');
    assert.equal(await p2, 'second');
  });

  it('skips empty lines and CRLF without crashing', async () => {
    const fake = makeFakeChild();
    const client = new StdioJsonRpcClient(fake.child);

    const p = client.request('crlf/test');
    const sent = JSON.parse(fake.stdinWrites[0]);

    fake.emitStdout('\n\r\n   \n');
    fake.emitStdout(`${JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: 'ok' })}\r\n`);

    assert.equal(await p, 'ok');
  });

  it('routes notifications to exact-method handlers', async () => {
    const fake = makeFakeChild();
    const client = new StdioJsonRpcClient(fake.child);

    let received: unknown = null;
    client.onNotification('session/update', (params) => {
      received = params;
    });

    fake.emitStdout(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 'abc', update: { sessionUpdate: 'agent_message_chunk' } },
    })}\n`);

    // Allow microtask queue to flush
    await new Promise((r) => setImmediate(r));

    assert.deepEqual(received, { sessionId: 'abc', update: { sessionUpdate: 'agent_message_chunk' } });
  });

  it('routes prefixed notifications to wildcard handlers', async () => {
    const fake = makeFakeChild();
    const client = new StdioJsonRpcClient(fake.child);

    const seen: Array<{ method: string; params: unknown }> = [];
    client.onNotificationPrefix('_kiro.dev/', (params) => {
      seen.push({ method: 'prefix-match', params });
    });

    fake.emitStdout(`${JSON.stringify({ jsonrpc: '2.0', method: '_kiro.dev/metadata', params: { x: 1 } })}\n`);
    fake.emitStdout(`${JSON.stringify({ jsonrpc: '2.0', method: '_kiro.dev/mcp/server_initialized', params: { y: 2 } })}\n`);
    fake.emitStdout(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { z: 3 } })}\n`);

    await new Promise((r) => setImmediate(r));

    // Only the two _kiro.dev/* notifications hit the prefix handler
    assert.equal(seen.length, 2);
    assert.deepEqual(seen.map((s) => s.params), [{ x: 1 }, { y: 2 }]);
  });

  it('rejects all pending requests on child close', async () => {
    const fake = makeFakeChild();
    const client = new StdioJsonRpcClient(fake.child);

    const p1 = client.request('a').catch((e: Error) => e);
    const p2 = client.request('b').catch((e: Error) => e);

    fake.emitClose(1);

    const [e1, e2] = await Promise.all([p1, p2]);
    assert.match((e1 as Error).message, /closed/);
    assert.match((e2 as Error).message, /closed/);
  });

  it('rejects new requests after close synchronously', async () => {
    const fake = makeFakeChild();
    const client = new StdioJsonRpcClient(fake.child);
    fake.emitClose(0);

    await assert.rejects(client.request('after-close'), (err: Error) => {
      assert.match(err.message, /closed/);
      return true;
    });
  });

  it('survives non-JSON stdout lines without crashing', async () => {
    const fake = makeFakeChild();
    let parseErrors = 0;
    const client = new StdioJsonRpcClient(fake.child, {
      onParseError: () => { parseErrors += 1; },
    });

    const p = client.request('survive/test');
    const sent = JSON.parse(fake.stdinWrites[0]);

    // First a stderr leak that landed on stdout (not JSON), then a valid frame
    fake.emitStdout('warning: something is up on stderr but emitted on stdout\n');
    fake.emitStdout(`${JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: 'still works' })}\n`);

    assert.equal(await p, 'still works');
    assert.equal(parseErrors, 1);
  });

  it('forwards stderr lines to onStderr callback', async () => {
    const fake = makeFakeChild();
    const stderrLines: string[] = [];
    new StdioJsonRpcClient(fake.child, { onStderr: (l) => stderrLines.push(l) });

    fake.emitStderr('first error\nsecond error\n');
    await new Promise((r) => setImmediate(r));

    assert.deepEqual(stderrLines, ['first error', 'second error']);
  });

  it('rejects request that times out', async () => {
    const fake = makeFakeChild();
    const client = new StdioJsonRpcClient(fake.child, { requestTimeoutMs: 50 });

    await assert.rejects(client.request('slow/method'), (err: Error) => {
      assert.match(err.message, /timed out/);
      assert.match(err.message, /slow\/method/);
      return true;
    });
  });

  it('notify() does not expect a response and never resolves a promise', () => {
    const fake = makeFakeChild();
    const client = new StdioJsonRpcClient(fake.child);

    client.notify('session/cancel', { sessionId: 'abc' });

    assert.equal(fake.stdinWrites.length, 1);
    const sent = JSON.parse(fake.stdinWrites[0].trim());
    assert.equal(sent.jsonrpc, '2.0');
    assert.equal(sent.method, 'session/cancel');
    assert.equal('id' in sent, false, 'notification frames must have no id');
  });

  it('continues processing frames when a notification handler throws', async () => {
    const fake = makeFakeChild();
    const client = new StdioJsonRpcClient(fake.child);

    let goodCalls = 0;
    client.onNotification('throws', () => {
      throw new Error('handler boom');
    });
    client.onNotification('survives', () => {
      goodCalls += 1;
    });

    // Suppress the expected console.error so it doesn't pollute test output;
    // we still want to assert the stream itself kept flowing.
    const originalConsoleError = console.error;
    const errorCalls: unknown[][] = [];
    console.error = (...args) => {
      errorCalls.push(args);
    };

    try {
      // Three frames: throwing handler, recoverable handler, then a request
      // response that proves the dispatch loop wasn't broken.
      const promise = client.request('after-throw');
      const sent = JSON.parse(fake.stdinWrites[0].trim());

      fake.emitStdout(`${JSON.stringify({ jsonrpc: '2.0', method: 'throws', params: {} })}\n`);
      fake.emitStdout(`${JSON.stringify({ jsonrpc: '2.0', method: 'survives', params: {} })}\n`);
      fake.emitStdout(`${JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: 'still works' })}\n`);

      assert.equal(await promise, 'still works');
      // Allow the synchronous notification handlers to finish
      await new Promise((r) => setImmediate(r));
      assert.equal(goodCalls, 1);
      assert.ok(errorCalls.length >= 1, 'handler errors should be logged');
    } finally {
      console.error = originalConsoleError;
    }
  });
});

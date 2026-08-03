import assert from 'node:assert/strict';
import test from 'node:test';

import { PiRpcClient } from './pi-rpc-client.provider.js';

type Listener = (event: unknown) => void;

class FakeUnderlyingClient {
  startCalls = 0;
  stopCalls = 0;
  abortCalls = 0;
  stderr = '';
  stopResolves = true;
  state: unknown = { status: 'idle' };
  models: unknown[] = [{ id: 'm1' }];
  commands: unknown[] = [{ name: '/help' }];
  // When set, request-style methods reject with this error (simulates the
  // official client rejecting pending requests on unexpected process exit).
  requestError: Error | null = null;
  private listeners = new Set<Listener>();
  private closeListeners = new Set<() => void>();

  async start(): Promise<void> {
    this.startCalls += 1;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    if (!this.stopResolves) {
      await new Promise<void>(() => {});
    }
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStderr(): string {
    return this.stderr;
  }

  prompt(): Promise<void> {
    return Promise.resolve();
  }

  abort(): Promise<void> {
    this.abortCalls += 1;
    return Promise.resolve();
  }

  getState(): Promise<unknown> {
    if (this.requestError) return Promise.reject(this.requestError);
    return Promise.resolve(this.state);
  }

  getAvailableModels(): Promise<unknown[]> {
    if (this.requestError) return Promise.reject(this.requestError);
    return Promise.resolve(this.models);
  }

  getCommands(): Promise<unknown[]> {
    if (this.requestError) return Promise.reject(this.requestError);
    return Promise.resolve(this.commands);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  emit(event: unknown): void {
    for (const listener of this.listeners) listener(event);
  }

  emitClose(): void {
    for (const listener of this.closeListeners) listener();
  }
}

const makeClient = (fake: FakeUnderlyingClient, options: Record<string, unknown> = {}) => {
  const captured: { options?: Record<string, unknown> } = {};
  const client = new PiRpcClient(options, {
    createClient: (resolvedOptions) => {
      captured.options = resolvedOptions as Record<string, unknown>;
      return fake as unknown as never;
    },
  });
  return { client, captured };
};

test('start injects --mode rpc --no-extensions and merges caller options', async () => {
  const fake = new FakeUnderlyingClient();
  const { client, captured } = makeClient(fake, { cwd: '/tmp/work', env: { FOO: 'bar' } });

  await client.start();

  assert.equal(fake.startCalls, 1);
  const args = (captured.options?.args as string[]) ?? [];
  assert.deepEqual(args, ['--mode', 'rpc', '--no-extensions']);
  assert.equal(captured.options?.cwd, '/tmp/work');
  assert.deepEqual(captured.options?.env, { FOO: 'bar' });
});

test('start merges caller args after the fixed args', async () => {
  const fake = new FakeUnderlyingClient();
  const { client, captured } = makeClient(fake, { args: ['--extra'] });

  await client.start();

  assert.deepEqual(captured.options?.args, ['--mode', 'rpc', '--no-extensions', '--extra']);
});

test('onEvent forwards events in dispatch order', async () => {
  const fake = new FakeUnderlyingClient();
  const { client } = makeClient(fake);
  await client.start();

  const received: unknown[] = [];
  const unsubscribe = client.onEvent((event) => received.push(event));

  fake.emit({ type: 'a' });
  fake.emit({ type: 'b' });
  fake.emit({ type: 'c' });
  unsubscribe();
  fake.emit({ type: 'd' });

  assert.deepEqual(received, [{ type: 'a' }, { type: 'b' }, { type: 'c' }]);
});

test('getStderr passes through underlying stderr without polluting events', async () => {
  const fake = new FakeUnderlyingClient();
  const { client } = makeClient(fake);
  await client.start();

  const received: unknown[] = [];
  client.onEvent((event) => received.push(event));

  fake.stderr = 'boom on stderr\n';
  fake.emit({ type: 'agent_settled' });

  assert.equal(client.getStderr(), 'boom on stderr\n');
  assert.deepEqual(received, [{ type: 'agent_settled' }]);
});

test('prompt forwards to the underlying client and resolves immediately', async () => {
  const fake = new FakeUnderlyingClient();
  const { client } = makeClient(fake);
  await client.start();

  await client.prompt('hi');
});

test('abort forwards to the underlying client', async () => {
  const fake = new FakeUnderlyingClient();
  const { client } = makeClient(fake);
  await client.start();

  await client.abort();
  assert.equal(fake.abortCalls, 1);
});

test('getState/getAvailableModels/getCommands forward underlying results', async () => {
  const fake = new FakeUnderlyingClient();
  const { client } = makeClient(fake);
  await client.start();

  assert.deepEqual(await client.getState(), { status: 'idle' });
  assert.deepEqual(await client.getAvailableModels(), [{ id: 'm1' }]);
  assert.deepEqual(await client.getCommands(), [{ name: '/help' }]);
});

test('request methods transparently propagate underlying rejection on process exit', async () => {
  const fake = new FakeUnderlyingClient();
  const { client } = makeClient(fake);
  await client.start();

  const exitError = new Error('process exited unexpectedly');
  fake.requestError = exitError;

  await assert.rejects(client.getState(), (err: Error) => err === exitError);
  await assert.rejects(client.getAvailableModels(), (err: Error) => err === exitError);
  await assert.rejects(client.getCommands(), (err: Error) => err === exitError);
});

test('close forces resolution after graceful timeout when stop hangs', async () => {
  const fake = new FakeUnderlyingClient();
  fake.stopResolves = false;
  const { client } = makeClient(fake);
  await client.start();

  await client.close(20);
  assert.equal(fake.stopCalls, 1);
});

test('close resolves promptly when underlying stop resolves', async () => {
  const fake = new FakeUnderlyingClient();
  const { client } = makeClient(fake);
  await client.start();

  await client.close(1000);
  assert.equal(fake.stopCalls, 1);
});

test('onClose fires when the underlying process exits', async () => {
  const fake = new FakeUnderlyingClient();
  const { client } = makeClient(fake);
  await client.start();

  let closed = 0;
  const unsubscribe = client.onClose(() => {
    closed += 1;
  });

  fake.emitClose();
  assert.equal(closed, 1);

  unsubscribe();
  fake.emitClose();
  assert.equal(closed, 1);
});

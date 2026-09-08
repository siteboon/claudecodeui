import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  CODEX_RUNTIME_MODE_ENV,
  CodexAppServerProcessManager,
  readCodexRuntimeMode,
  resolveCodexRuntimeMode,
  type CodexAppServerDiagnostic,
  type CodexAppServerProcess,
} from '@/modules/providers/list/codex/index.js';

class FakeAppServerProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 1234;
  readonly killSignals: Array<NodeJS.Signals | number | undefined> = [];

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal);
    queueMicrotask(() => this.emit('exit', null, typeof signal === 'string' ? signal : null));
    return true;
  }
}

type ProcessHarness = {
  process: FakeAppServerProcess;
  manager: CodexAppServerProcessManager;
  diagnostics: CodexAppServerDiagnostic[];
  nextFrame: () => Promise<Record<string, unknown>>;
};

function createHarness(options: { shutdownGracePeriodMs?: number } = {}): ProcessHarness {
  const process = new FakeAppServerProcess();
  const frames: Record<string, unknown>[] = [];
  const frameWaiters: Array<(frame: Record<string, unknown>) => void> = [];
  let inputBuffer = '';

  process.stdin.on('data', (chunk: Buffer | string) => {
    inputBuffer += String(chunk);
    let newlineIndex = inputBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = inputBuffer.slice(0, newlineIndex).trim();
      inputBuffer = inputBuffer.slice(newlineIndex + 1);
      if (line) {
        const frame = JSON.parse(line) as Record<string, unknown>;
        const waiter = frameWaiters.shift();
        if (waiter) {
          waiter(frame);
        } else {
          frames.push(frame);
        }
      }
      newlineIndex = inputBuffer.indexOf('\n');
    }
  });

  const diagnostics: CodexAppServerDiagnostic[] = [];
  const manager = new CodexAppServerProcessManager({
    clientInfo: { name: 'cloudcli-test', version: 'test' },
    shutdownGracePeriodMs: options.shutdownGracePeriodMs ?? 10,
    spawn: () => process as unknown as CodexAppServerProcess,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  return {
    process,
    manager,
    diagnostics,
    nextFrame: () => {
      const queued = frames.shift();
      if (queued) {
        return Promise.resolve(queued);
      }
      return new Promise((resolve) => frameWaiters.push(resolve));
    },
  };
}

async function completeHandshake(harness: ProcessHarness): Promise<void> {
  const startPromise = harness.manager.start();
  const initialize = await harness.nextFrame();
  assert.equal(initialize.method, 'initialize');
  assert.equal(initialize.jsonrpc, undefined);
  harness.process.stdout.write(JSON.stringify({
    id: initialize.id,
    result: {
      userAgent: 'codex-test',
      codexHome: '/tmp/codex',
      platformFamily: 'unix',
      platformOs: 'linux',
    },
  }) + '\n');

  const initialized = await harness.nextFrame();
  assert.deepEqual(initialized, { method: 'initialized' });
  await startPromise;
}

function respondToHandshakes(process: FakeAppServerProcess): void {
  let buffer = '';
  process.stdin.on('data', (chunk: Buffer | string) => {
    buffer += String(chunk);
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        const frame = JSON.parse(line) as Record<string, unknown>;
        if (frame.method === 'initialize') {
          process.stdout.write(`${JSON.stringify({ id: frame.id, result: {} })}\n`);
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }
  });
}

test('defaults to app-server mode and accepts explicit runtime modes', () => {
  assert.equal(readCodexRuntimeMode({}), 'app-server');
  assert.equal(readCodexRuntimeMode({ [CODEX_RUNTIME_MODE_ENV]: 'app-server' }), 'app-server');
  assert.equal(readCodexRuntimeMode({ [CODEX_RUNTIME_MODE_ENV]: 'SDK' }), 'sdk');
  assert.equal(readCodexRuntimeMode({ [CODEX_RUNTIME_MODE_ENV]: 'unsupported' }), 'app-server');
  assert.equal(resolveCodexRuntimeMode('sdk', { [CODEX_RUNTIME_MODE_ENV]: 'app-server' }), 'sdk');
  assert.equal(resolveCodexRuntimeMode('unsupported', { [CODEX_RUNTIME_MODE_ENV]: 'sdk' }), 'sdk');
});

test('starts app-server with the required stdio command and completes the handshake', async () => {
  const harness = createHarness();

  await completeHandshake(harness);

  assert.equal(harness.manager.currentState, 'ready');
  assert.deepEqual(harness.manager.currentHandshake?.initialize, {
    userAgent: 'codex-test',
    codexHome: '/tmp/codex',
    platformFamily: 'unix',
    platformOs: 'linux',
  });
  assert.equal(harness.manager.getHealth().pid, 1234);
  assert.equal(harness.diagnostics.some((diagnostic) => diagnostic.type === 'process_started'), true);
});

test('rejects requests before the handshake and correlates requests after it', async () => {
  const harness = createHarness();
  await assert.rejects(harness.manager.request('thread/list'), /not ready/);
  await completeHandshake(harness);

  const responsePromise = harness.manager.request<{ threads: string[] }>('thread/list');
  const request = await harness.nextFrame();
  assert.equal(request.method, 'thread/list');
  assert.equal(request.jsonrpc, undefined);
  harness.process.stdout.write(JSON.stringify({ id: request.id, result: { threads: [] } }) + '\n');
  assert.deepEqual(await responsePromise, { threads: [] });
});

test('propagates an unexpected child exit to pending requests and health diagnostics', async () => {
  const harness = createHarness();
  await completeHandshake(harness);

  const requestPromise = harness.manager.request('thread/read', { threadId: 'thread-1' });
  await harness.nextFrame();
  harness.process.emit('exit', 17, null);

  await assert.rejects(requestPromise, /transport|exited/i);
  assert.equal(harness.manager.currentState, 'failed');
  assert.equal(harness.manager.getHealth().lastError, 'Codex app-server exited with code 17');
  assert.deepEqual(harness.diagnostics.find((diagnostic) => diagnostic.type === 'process_exit'), {
    type: 'process_exit',
    generation: 1,
    code: 17,
    signal: null,
    expected: false,
  });

  await harness.manager.stop();
  assert.equal(harness.manager.currentState, 'stopped');
});

test('stops the child with a bounded graceful shutdown fallback', async () => {
  const harness = createHarness({ shutdownGracePeriodMs: 1 });
  await completeHandshake(harness);

  await harness.manager.stop();

  assert.equal(harness.manager.currentState, 'stopped');
  assert.deepEqual(harness.process.killSignals, ['SIGTERM']);
  assert.equal(harness.diagnostics.some(
    (diagnostic) => diagnostic.type === 'process_exit' && diagnostic.expected,
  ), true);
});

test('restart replaces the child and completes a fresh handshake', async () => {
  const processes: FakeAppServerProcess[] = [];
  const manager = new CodexAppServerProcessManager({
    shutdownGracePeriodMs: 1,
    spawn: () => {
      const process = new FakeAppServerProcess();
      respondToHandshakes(process);
      processes.push(process);
      return process as unknown as CodexAppServerProcess;
    },
  });

  await manager.start();
  await manager.restart();

  assert.equal(processes.length, 2);
  assert.deepEqual(processes[0]?.killSignals, ['SIGTERM']);
  assert.equal(manager.getHealth().generation, 2);
  assert.equal(manager.currentState, 'ready');
});

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { AntigravitySessionsProvider } from '@/modules/providers/list/antigravity/antigravity-sessions.provider.js';
import {
  createAntigravityRuntime,
  resolveAntigravityPermissionArgs,
} from '@/modules/providers/list/antigravity/antigravity-runtime.provider.js';
import type {
  AnyRecord,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
} from '@/shared/types.js';

const sessionsProvider = new AntigravitySessionsProvider();

function createRuntimeContext(
  overrides: Partial<ProviderRuntimeContext> = {},
): ProviderRuntimeContext {
  return {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async (_sessionId, requestedModel) => requestedModel || undefined,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
    normalizeMessage: (raw, sessionId) => sessionsProvider.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    ...overrides,
  };
}

type FakeAntigravityProcess = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill(signal?: NodeJS.Signals): boolean;
};

function createFakeProcess(
  onKill?: (signal: NodeJS.Signals | undefined) => void,
): FakeAntigravityProcess {
  const child = new EventEmitter() as FakeAntigravityProcess;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal) => {
    onKill?.(signal);
    queueMicrotask(() => child.emit('close', null, signal));
    return true;
  };
  return child;
}

function createWriter(onMessage?: (message: AnyRecord) => void): {
  writer: ProviderRuntimeWriter;
  messages: AnyRecord[];
  getProviderSessionId(): string | null;
} {
  const messages: AnyRecord[] = [];
  let providerSessionId: string | null = null;
  return {
    messages,
    getProviderSessionId: () => providerSessionId,
    writer: {
      userId: null,
      send(data) {
        const message = data as AnyRecord;
        messages.push(message);
        onMessage?.(message);
      },
      setSessionId(sessionId) {
        providerSessionId = sessionId;
      },
    },
  };
}

test('Antigravity permission modes map to agy controls', () => {
  assert.deepEqual(resolveAntigravityPermissionArgs('plan'), ['--mode', 'plan']);
  assert.deepEqual(resolveAntigravityPermissionArgs('acceptEdits'), ['--mode', 'accept-edits']);
  assert.deepEqual(resolveAntigravityPermissionArgs('bypassPermissions'), ['--dangerously-skip-permissions']);
  assert.deepEqual(resolveAntigravityPermissionArgs('default'), []);
});

test('Antigravity streams stdout before exit and captures a new provider session id', async () => {
  const child = createFakeProcess();
  let capturedCommand = '';
  let capturedArgs: string[] = [];
  let capturedCwd = '';
  let historyReadCount = 0;
  const runtime = createAntigravityRuntime({
    spawnProcess: (command, args, options) => {
      capturedCommand = command;
      capturedArgs = args;
      capturedCwd = options.cwd;
      queueMicrotask(() => {
        child.stdout.write('assistant ');
        setTimeout(() => {
          child.stdout.end('response');
          child.emit('close', 0, null);
        }, 50);
      });
      return child as never;
    },
    readConversationDbFiles: async () => {
      historyReadCount += 1;
      return historyReadCount === 1
        ? []
        : [{ id: 'agy-native-session-1', mtimeMs: Date.now() }];
    },
  });

  let runCompleted = false;
  let resolveFirstDelta: (() => void) | null = null;
  const firstDelta = new Promise<void>((resolve) => {
    resolveFirstDelta = resolve;
  });
  const { writer, messages, getProviderSessionId } = createWriter((message) => {
    if (message.kind === 'stream_delta') {
      resolveFirstDelta?.();
    }
  });

  const run = runtime.run(
    'Hi',
    { cwd: '/workspace', sessionId: 'app-session-1', permissionMode: 'acceptEdits' },
    writer,
    createRuntimeContext(),
  ).then(() => {
    runCompleted = true;
  });

  await firstDelta;
  assert.equal(runCompleted, false);
  await run;

  const streamedText = messages
    .filter((message) => message.kind === 'stream_delta')
    .map((message) => String(message.content))
    .join('');
  assert.equal(streamedText, 'assistant response');
  assert.equal(getProviderSessionId(), 'agy-native-session-1');
  assert.equal(messages.some((message) => message.kind === 'session_created'), true);
  assert.equal(messages.filter((message) => message.kind === 'complete').length, 1);
  assert.deepEqual(capturedArgs.slice(-2), ['--print', 'Hi']);
  assert.equal(capturedCommand, 'agy');
  assert.equal(capturedArgs.includes('--conversation'), false);
  assert.equal(capturedCwd, '/workspace');
});

test('Antigravity hides wait markers split across stdout chunks', async () => {
  const child = createFakeProcess();
  const runtime = createAntigravityRuntime({
    spawnProcess: () => {
      queueMicrotask(() => {
        child.stdout.write('Before\n<WAITING_FOR_E');
        child.stdout.write('VENTS>\n</WAITING_');
        child.stdout.end('FOR_EVENTS>\nAfter');
        child.emit('close', 0, null);
      });
      return child as never;
    },
    readConversationDbFiles: async () => [],
  });
  const { writer, messages } = createWriter();
  await runtime.run('Hi', {}, writer, createRuntimeContext());

  const text = messages
    .filter((message) => message.kind === 'stream_delta')
    .map((message) => String(message.content))
    .join('');
  assert.match(text, /Before[\s\S]*After/);
  assert.equal(text.includes('WAITING_FOR_EVENTS'), false);
  assert.equal(messages.filter((message) => message.kind === 'complete').length, 1);
});

test('Antigravity decodes UTF-8 characters split across stdout and stderr chunks', async () => {
  const child = createFakeProcess();
  const runtime = createAntigravityRuntime({
    spawnProcess: () => {
      queueMicrotask(() => {
        for (const stream of [child.stdout, child.stderr]) {
          const bytes = Buffer.from('한🙂字');
          for (const byte of bytes) stream.write(Buffer.from([byte]));
          stream.end();
        }
        child.emit('close', 0, null);
      });
      return child as never;
    },
    readConversationDbFiles: async () => [],
  });
  const { writer, messages } = createWriter();
  await runtime.run('Hi', {}, writer, createRuntimeContext());
  assert.equal(messages.filter((message) => message.kind === 'stream_delta')
    .map((message) => String(message.content)).join(''), '한🙂字한🙂字');
});

test('concurrent fresh Antigravity runs bind each writer to its own conversation', async () => {
  const files: { id: string; mtimeMs: number }[] = [];
  let active = 0;
  let maximumActive = 0;
  const runtime = createAntigravityRuntime({
    spawnProcess: (_command, args) => {
      const child = createFakeProcess();
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      files.push({ id: args.at(-1)!, mtimeMs: Date.now() + files.length });
      setImmediate(() => {
        active -= 1;
        child.emit('close', 0, null);
      });
      return child as never;
    },
    readConversationDbFiles: async () => [...files],
  });
  const first = createWriter();
  const second = createWriter();
  await Promise.all([
    runtime.run('first', { sessionId: 'first-app' }, first.writer, createRuntimeContext()),
    runtime.run('second', { sessionId: 'second-app' }, second.writer, createRuntimeContext()),
  ]);
  assert.equal(first.getProviderSessionId(), 'first');
  assert.equal(second.getProviderSessionId(), 'second');
  assert.equal(maximumActive, 1);
});

test('Antigravity can cancel a queued fresh run while resumed sessions continue', async () => {
  const freshChild = createFakeProcess();
  const spawned: string[] = [];
  const runtime = createAntigravityRuntime({
    spawnProcess: (_command, args) => {
      const prompt = args.at(-1)!;
      spawned.push(prompt);
      if (prompt === 'fresh') return freshChild as never;
      const child = createFakeProcess();
      queueMicrotask(() => child.emit('close', 0, null));
      return child as never;
    },
    readConversationDbFiles: async () => [],
  });
  const freshRun = runtime.run('fresh', { sessionId: 'fresh-app' }, createWriter().writer, createRuntimeContext());
  await new Promise<void>((resolve) => setImmediate(resolve));
  const cancelledWriter = createWriter();
  const cancelledRun = runtime.run('cancelled', { sessionId: 'queued-app' }, cancelledWriter.writer, createRuntimeContext());
  assert.equal(await runtime.abort('queued-app'), true);
  await cancelledRun;
  const nextRun = runtime.run('next', { sessionId: 'next-app' }, createWriter().writer, createRuntimeContext());
  await runtime.run('resumed', { sessionId: 'resumed-app' }, createWriter().writer,
    createRuntimeContext({ resolveProviderSessionId: () => 'existing-conversation' }));
  assert.deepEqual(spawned, ['fresh', 'resumed']);
  assert.deepEqual(cancelledWriter.messages, []);
  assert.equal(await runtime.abort('fresh-app'), true);
  await Promise.all([freshRun, nextRun]);
  assert.deepEqual(spawned, ['fresh', 'resumed', 'next']);
});

for (const failure of ['snapshot', 'model', 'spawn', 'error', 'discovery', 'probe']) {
  test(`Antigravity releases the fresh-run queue after a ${failure} failure`, async () => {
    let fail = true;
    let reads = 0;
    const runtime = createAntigravityRuntime({
      readConversationDbFiles: async () => {
        reads += 1;
        if (fail && (failure === 'snapshot' || (failure === 'discovery' && reads === 2))) {
          throw new Error('history failed');
        }
        return [];
      },
      spawnProcess: () => {
        if (fail && failure === 'spawn') throw new Error('spawn failed');
        const child = createFakeProcess();
        queueMicrotask(() => {
          if (fail && (failure === 'error' || failure === 'probe')) {
            child.emit('error', new Error('spawn failed'));
          }
          child.emit('close', 0, null);
        });
        return child as never;
      },
    });
    const context = createRuntimeContext({
      resolveResumeModel: async () => {
        if (fail && failure === 'model') throw new Error('model failed');
        return undefined;
      },
      isProviderInstalled: async () => {
        if (fail && failure === 'probe') throw new Error('probe failed');
        return true;
      },
    });
    await assert.rejects(runtime.run('fail', { sessionId: 'failed-app' }, createWriter().writer, context));
    fail = false;
    await runtime.run('recover', { sessionId: 'recovered-app' }, createWriter().writer, context);
  });
}

test('Antigravity runtime uses the configured AGY executable', { concurrency: false }, async () => {
  const previousPath = process.env.AGY_CLI_PATH;
  const child = createFakeProcess();
  let capturedCommand = '';
  const runtime = createAntigravityRuntime({
    spawnProcess: (command) => {
      capturedCommand = command;
      queueMicrotask(() => child.emit('close', 0, null));
      return child as never;
    },
    readConversationDbFiles: async () => [],
  });

  try {
    process.env.AGY_CLI_PATH = '  "/opt/agent wrappers/agy"  ';
    await runtime.run('Hi', {}, createWriter().writer, createRuntimeContext());
    assert.equal(capturedCommand, '/opt/agent wrappers/agy');
  } finally {
    if (previousPath === undefined) {
      delete process.env.AGY_CLI_PATH;
    } else {
      process.env.AGY_CLI_PATH = previousPath;
    }
  }
});

test('Antigravity resumes with the provider-native conversation id', async () => {
  const child = createFakeProcess();
  let capturedArgs: string[] = [];
  const runtime = createAntigravityRuntime({
    spawnProcess: (_command, args) => {
      capturedArgs = args;
      queueMicrotask(() => child.emit('close', 0, null));
      return child as never;
    },
    readConversationDbFiles: async () => [],
  });
  const { writer, getProviderSessionId } = createWriter();

  await runtime.run(
    'Continue',
    { sessionId: 'app-session-2' },
    writer,
    createRuntimeContext({
      resolveProviderSessionId: (sessionId) => (
        sessionId === 'app-session-2' ? 'agy-existing-session' : null
      ),
    }),
  );

  const conversationIndex = capturedArgs.indexOf('--conversation');
  assert.notEqual(conversationIndex, -1);
  assert.equal(capturedArgs[conversationIndex + 1], 'agy-existing-session');
  assert.equal(getProviderSessionId(), 'agy-existing-session');
});

test('Antigravity abort sends SIGTERM and leaves the aborted complete to the gateway', async () => {
  let receivedSignal: NodeJS.Signals | undefined;
  const child = createFakeProcess((signal) => {
    receivedSignal = signal;
  });
  let resolveSpawned: (() => void) | null = null;
  const spawned = new Promise<void>((resolve) => {
    resolveSpawned = resolve;
  });
  const runtime = createAntigravityRuntime({
    spawnProcess: () => {
      resolveSpawned?.();
      return child as never;
    },
    readConversationDbFiles: async () => [],
  });
  const { writer, messages } = createWriter();
  const run = runtime.run(
    'Wait',
    { sessionId: 'app-session-abort' },
    writer,
    createRuntimeContext(),
  );

  await spawned;
  assert.equal(await runtime.abort('app-session-abort'), true);
  await run;

  assert.equal(receivedSignal, 'SIGTERM');
  assert.equal(messages.some((message) => message.kind === 'complete'), false);
});

test('Antigravity reports model-resolution failures as terminal errors', async () => {
  const runtime = createAntigravityRuntime({
    spawnProcess: () => {
      throw new Error('process must not start');
    },
    readConversationDbFiles: async () => [],
  });
  const { writer, messages } = createWriter();
  await assert.rejects(
    runtime.run(
      'Hi',
      { sessionId: 'app-session-model-error' },
      writer,
      createRuntimeContext({
        resolveResumeModel: async () => {
          throw new Error('model lookup failed');
        },
      }),
    ),
    /model lookup failed/,
  );

  assert.equal(messages.some((message) => message.kind === 'error'), true);
  assert.equal(messages.filter((message) => message.kind === 'complete').length, 1);
});

test('Antigravity emits one terminal lifecycle when the CLI cannot spawn', async () => {
  const child = createFakeProcess();
  const runtime = createAntigravityRuntime({
    spawnProcess: () => {
      queueMicrotask(() => {
        child.emit('error', new Error('spawn agy ENOENT'));
        child.emit('close', -2, null);
      });
      return child as never;
    },
    readConversationDbFiles: async () => [],
  });
  const { writer, messages } = createWriter();

  await assert.rejects(
    runtime.run('Hi', { sessionId: 'app-session-spawn-error' }, writer, createRuntimeContext({
      isProviderInstalled: async () => false,
    })),
    /spawn agy ENOENT/,
  );

  assert.equal(messages.filter((message) => message.kind === 'error').length, 1);
  assert.equal(messages.filter((message) => message.kind === 'complete').length, 1);
});

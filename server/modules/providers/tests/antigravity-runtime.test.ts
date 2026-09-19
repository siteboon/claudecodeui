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
  let capturedArgs: string[] = [];
  let capturedCwd = '';
  let historyReadCount = 0;
  const runtime = createAntigravityRuntime({
    spawnProcess: (_command, args, options) => {
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
  assert.equal(capturedArgs.includes('--conversation'), false);
  assert.equal(capturedCwd, '/workspace');
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

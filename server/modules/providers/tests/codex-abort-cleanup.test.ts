import assert from 'node:assert/strict';
import test from 'node:test';

import { Codex } from '@openai/codex-sdk';
import type { Thread } from '@openai/codex-sdk';

import type { ProviderRuntimeContext } from '@/shared/index.js';

test('periodic cleanup cannot forget an aborted writer that has not finished', async (t) => {
  let cleanup: (() => void) | undefined;
  const realSetInterval = setInterval;
  t.mock.method(globalThis, 'setInterval', (callback: () => void, delay?: number) => {
    if (delay === 5 * 60 * 1000) cleanup = callback;
    const timer = realSetInterval(callback, delay);
    t.after(() => clearInterval(timer));
    return timer;
  });
  // Capture the runtime's real cleanup callback before its first source import.
  const { codexRuntime } = await import('@/modules/providers/list/codex/codex-runtime.provider.js');
  assert.ok(cleanup);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-09T00:00:00Z') });

  let releaseWriter: (() => void) | undefined;
  let streamStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { streamStarted = resolve; });
  const writerReleased = new Promise<void>((resolve) => { releaseWriter = resolve; });
  const thread = {
    async runStreamed() {
      return { events: (async function* () {
        yield { type: 'thread.started', thread_id: 'cleanup-native-thread' };
        streamStarted?.();
        await writerReleased;
      })() };
    },
  } as unknown as Thread;
  t.mock.method(Codex.prototype, 'resumeThread', () => thread);
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => 'cleanup-native-thread',
    resolveResumeModel: async () => 'test-model',
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
  };
  const run = codexRuntime.run('test', { sessionId: 'cleanup-app-session' }, {
    isWebSocketWriter: true, send() {},
  }, context);
  await started;
  try {
    const first = assert.rejects(Promise.resolve(codexRuntime.abort('cleanup-app-session')), /still closing/);
    t.mock.timers.tick(10_000);
    await first;
    t.mock.timers.tick(31 * 60 * 1000);
    cleanup();
    const retry = assert.rejects(Promise.resolve(codexRuntime.abort('cleanup-app-session')), /still closing/);
    t.mock.timers.tick(10_000);
    await retry;
  } finally {
    releaseWriter?.();
    await run;
  }
  assert.equal(await codexRuntime.abort('cleanup-app-session'), true);
  cleanup();
  assert.equal(await codexRuntime.abort('cleanup-app-session'), false, 'finished sessions can be collected');
});

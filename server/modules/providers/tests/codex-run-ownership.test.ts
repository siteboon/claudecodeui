import assert from 'node:assert/strict';
import test from 'node:test';

import { Codex } from '@openai/codex-sdk';
import type { Thread } from '@openai/codex-sdk';

import type { ProviderRuntimeContext } from '@/shared/index.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('a finished Codex run cannot settle a newer writer for the same session', { timeout: 5000 }, async (t) => {
  let cleanup: (() => void) | undefined;
  const realSetInterval = setInterval;
  t.mock.method(globalThis, 'setInterval', (callback: () => void, delay?: number) => {
    if (delay === 5 * 60 * 1000) cleanup = callback;
    const timer = realSetInterval(callback, delay);
    t.after(() => clearInterval(timer));
    return timer;
  });
  const { codexRuntime } = await import('@/modules/providers/list/codex/codex-runtime.provider.js');
  const { CodexSessionsProvider } = await import('@/modules/providers/list/codex/codex-sessions.provider.js');
  const sessions = new CodexSessionsProvider();
  assert.ok(cleanup);
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-12T00:00:00Z') });

  for (const resumed of [false, true]) {
    await t.test(resumed ? 'resumed thread' : 'new thread registered by thread.started', async (st) => {
      const firstComplete = deferred();
      const secondStarted = deferred();
      const firstExit = deferred();
      const secondExit = deferred();
      let secondSignal: AbortSignal | undefined;
      let callCount = 0;
      st.mock.method(Codex.prototype, resumed ? 'resumeThread' : 'startThread', () => {
        const first = ++callCount === 1;
        return {
          id: 'ownership-native',
          async runStreamed(_prompt: unknown, options: { signal: AbortSignal }) {
            if (!first) secondSignal = options.signal;
            return { events: (async function* () {
              yield { type: 'thread.started', thread_id: 'ownership-native' };
              if (first) {
                yield { type: 'turn.completed' };
                await firstExit.promise;
              } else {
                secondStarted.resolve();
                await secondExit.promise;
              }
            })() };
          },
        } as unknown as Thread;
      });
      const context: ProviderRuntimeContext = {
        resolveProviderSessionId: () => resumed ? 'ownership-native' : null,
        resolveResumeModel: async () => 'test-model',
        getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
        normalizeMessage: (event) => sessions.normalizeMessage(event, 'ownership-native'),
        isProviderInstalled: async () => true,
      };
      const options = { sessionId: `ownership-app-${resumed}` };
      const firstRun = codexRuntime.run('first', options, {
        isWebSocketWriter: true,
        send: (message) => { if ((message as { kind?: string }).kind === 'complete') firstComplete.resolve(); },
      }, context);
      let secondRun: Promise<void> | undefined;
      let abort: Promise<boolean> | undefined;
      try {
        await firstComplete.promise;
        secondRun = codexRuntime.run('second', options, { isWebSocketWriter: true, send() {} }, context);
        await secondStarted.promise;
        firstExit.resolve();
        await firstRun;

        // A long-running replacement must survive cleanup after the old run exits.
        t.mock.timers.tick(31 * 60 * 1000);
        cleanup!();
        abort = codexRuntime.abort(options.sessionId);
        assert.equal(secondSignal?.aborted, true, 'cleanup must retain the replacement writer');
        let stopped = false;
        void abort.then(() => { stopped = true; });
        await new Promise(setImmediate);
        assert.equal(stopped, false, 'abort still waits for the replacement writer to exit');
        secondExit.resolve();
        assert.equal(await abort, true);
      } finally {
        firstExit.resolve();
        secondExit.resolve();
        await Promise.all([firstRun, secondRun, abort]);
      }
    });
  }
});

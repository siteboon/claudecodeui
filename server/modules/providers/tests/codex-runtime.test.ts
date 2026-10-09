import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { Codex } from '@openai/codex-sdk';
import type { Thread, ThreadOptions } from '@openai/codex-sdk';

import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import type { ProviderRuntimeContext } from '@/shared/index.js';

for (const timesOut of [false, true]) {
  test(`Codex abort ${timesOut ? 'reports a timeout without claiming success' : 'waits for the SDK writer to exit'}`, async (t) => {
    let releaseWriter: (() => void) | undefined;
    let streamStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { streamStarted = resolve; });
    const writerReleased = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const thread = {
      id: 'native-thread',
      async runStreamed() {
        return { events: (async function* () {
          yield { type: 'thread.started', thread_id: 'native-thread' };
          streamStarted?.();
          await writerReleased;
        })() };
      },
    } as unknown as Thread;
    t.mock.method(Codex.prototype, 'resumeThread', () => thread);

    const context: ProviderRuntimeContext = {
      resolveProviderSessionId: () => 'native-thread',
      resolveResumeModel: async () => 'test-model',
      getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
      normalizeMessage: () => [],
      isProviderInstalled: async () => true,
    };
    const run = codexRuntime.run(
      'test',
      { sessionId: 'app-session' },
      { isWebSocketWriter: true, send: () => undefined },
      context,
    );
    await started;
    t.mock.timers.enable({ apis: ['setTimeout'] });

    let abortFinished = false;
    let abortError: unknown;
    const abort = Promise.resolve(codexRuntime.abort('app-session')).catch((error) => {
      abortError = error;
      return false;
    }).then((result) => {
      abortFinished = true;
      return result;
    });
    try {
      await Promise.resolve();
      assert.equal(abortFinished, false);
      if (timesOut) {
        t.mock.timers.tick(10_000);
        await new Promise(setImmediate);
        assert.equal(abortFinished, true, 'abort must report the timeout instead of hanging');
        assert.match(String(abortError), /still closing/);
        assert.equal(await abort, false);
      }
    } finally {
      releaseWriter?.();
      await run;
      await abort;
    }
    if (!timesOut) assert.equal(await abort, true);
    assert.equal(await codexRuntime.abort('app-session'), true, 'retry succeeds after actual shutdown');
  });
}

for (const resumed of [false, true]) {
  for (const permissionMode of [undefined, 'default', 'unknown', 'acceptEdits', 'bypassPermissions']) {
    test(`Codex ${resumed ? 'resumes' : 'starts'} with supported permissions (${permissionMode ?? 'omitted'})`, async (t) => {
      let capturedOptions: ThreadOptions | undefined;
      let capturedPrompt: unknown;
      const messages: unknown[] = [];
      const thread = {
        id: 'native-thread',
        async runStreamed(prompt: unknown) {
          capturedPrompt = prompt;
          return { events: (async function* () {
            yield { type: 'thread.started', thread_id: 'native-thread' };
          })() };
        },
      } as unknown as Thread;

      const start = t.mock.method(Codex.prototype, 'startThread', (options?: ThreadOptions) => {
        capturedOptions = options;
        return thread;
      });
      const resume = t.mock.method(Codex.prototype, 'resumeThread', (id: string, options?: ThreadOptions) => {
        assert.equal(id, 'native-thread');
        capturedOptions = options;
        return thread;
      });
      const context: ProviderRuntimeContext = {
        resolveProviderSessionId: () => resumed ? 'native-thread' : null,
        resolveResumeModel: async () => 'test-model',
        getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
        normalizeMessage: () => [],
        isProviderInstalled: async () => true,
      };

      await codexRuntime.run('hey there', {
        sessionId: resumed ? 'app-session' : undefined,
        permissionMode,
        cwd: process.cwd(),
      }, { isWebSocketWriter: true, send: (message) => messages.push(message) }, context);

      assert.equal(start.mock.callCount(), resumed ? 0 : 1);
      assert.equal(resume.mock.callCount(), resumed ? 1 : 0);
      assert.equal(capturedPrompt, 'hey there');
      assert.equal(capturedOptions?.sandboxMode, permissionMode === 'bypassPermissions' ? 'danger-full-access' : 'workspace-write');
      assert.equal(capturedOptions?.approvalPolicy, permissionMode === 'acceptEdits' || permissionMode === 'bypassPermissions' ? 'never' : 'on-request');
      assert.ok(messages.some((message: any) => message.kind === 'complete' && message.exitCode === 0));
      assert.ok(!messages.some((message: any) => message.kind === 'error'));
    });
  }
}

for (const command of ['', '  \n\t']) {
  test(`Codex supplies a prompt for an image-only turn (${JSON.stringify(command)})`, async (t) => {
    let capturedPrompt: unknown;
    const imagePath = path.join(process.cwd(), 'public', 'favicon.png');
    const thread = {
      id: 'native-thread',
      async runStreamed(prompt: unknown) {
        capturedPrompt = prompt;
        return { events: (async function* () {
          yield { type: 'thread.started', thread_id: 'native-thread' };
        })() };
      },
    } as unknown as Thread;

    t.mock.method(Codex.prototype, 'startThread', () => thread);
    const context: ProviderRuntimeContext = {
      resolveProviderSessionId: () => null,
      resolveResumeModel: async () => 'test-model',
      getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
      normalizeMessage: () => [],
      isProviderInstalled: async () => true,
    };

    await codexRuntime.run(command, {
      cwd: process.cwd(),
      images: [{ path: imagePath, mimeType: 'image/png' }],
    }, { isWebSocketWriter: true, send: () => {} }, context);

    assert.deepEqual(capturedPrompt, [
      { type: 'text', text: 'Please analyze the attached image(s).' },
      { type: 'local_image', path: imagePath },
    ]);
  });
}

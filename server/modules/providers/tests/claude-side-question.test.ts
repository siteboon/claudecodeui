import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeSideQuestions } from '@/modules/providers/list/claude/claude-side-question.provider.js';

const input = { question: 'Why this choice?', history: [{ question: 'Earlier?', response: 'Yes.' }] };
const signal = () => new AbortController().signal;
const options = async () => ({ resume: 'native-session', cwd: '/workspace' });

function stubQuery() {
  let closed = false;
  let finish!: () => void;
  const held = new Promise<void>((resolve) => { finish = resolve; });
  return {
    initializationResult: async () => ({}),
    close: () => { closed = true; finish(); },
    isClosed: () => closed,
    askSideQuestion: async (_question: string, _options: unknown) => ({ response: 'Native answer', synthetic: false }),
    [Symbol.asyncIterator]: () => ({ next: async () => { await held; return { done: true as const, value: undefined }; } }),
  };
}

test('a live side request shares the actual Query and never creates or interrupts a run', async () => {
  const service = new ClaudeSideQuestions(() => { throw new Error('Must reuse live Query'); });
  const native = stubQuery();
  let received: unknown;
  native.askSideQuestion = async (question, options) => {
    received = { question, options };
    return { response: 'From main context', synthetic: false };
  };
  const registered = service.register('app', native, () => {});
  const abort = signal();
  assert.deepEqual(await service.ask('app', input, async () => { throw new Error('No resume'); }, abort),
    { response: 'From main context', synthetic: false });
  assert.deepEqual(received, { question: input.question, options: { history: input.history, signal: abort } });
  assert.equal(native.isClosed(), false);
  registered.dispose();
});

test('main-turn completion defers stdin EOF until its pending native side answer settles', async () => {
  const service = new ClaudeSideQuestions();
  const native = stubQuery();
  let answer!: (value: { response: string; synthetic: boolean }) => void;
  native.askSideQuestion = () => new Promise((resolve) => { answer = resolve; });
  let released = false;
  const registered = service.register('app', native, () => { released = true; });
  const pending = service.ask('app', input, options, signal());
  registered.release();
  assert.equal(released, false);
  answer({ response: 'Done', synthetic: false });
  await pending;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(released, true);
  registered.dispose();
});

test('idle questions resume with no input turn and disable transcript persistence', async () => {
  const native = stubQuery();
  let seen: unknown;
  let inputCount = 0;
  const service = new ClaudeSideQuestions((sdkOptions, prompt) => {
    seen = sdkOptions;
    void (async () => { for await (const _message of prompt) inputCount++; })();
    return native;
  });
  assert.equal((await service.ask('app', input, options, signal())).response, 'Native answer');
  assert.deepEqual(seen, { resume: 'native-session', cwd: '/workspace', persistSession: false });
  assert.equal(inputCount, 0);
  assert.equal(native.isClosed(), true);
});

test('cancelling a live question sends only its AbortSignal and preserves the main Query', async () => {
  const native = stubQuery();
  const controller = new AbortController();
  native.askSideQuestion = (_question, options) => new Promise((_resolve, reject) => {
    (options as { signal: AbortSignal }).signal.addEventListener('abort', () => reject(new Error('Side question cancelled')));
  });
  const service = new ClaudeSideQuestions();
  const registered = service.register('app', native, () => {});
  const pending = service.ask('app', input, options, controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(native.isClosed(), false);
  registered.dispose();
});

test('disposal of an older run cannot detach a newer Query for the same session', async () => {
  const service = new ClaudeSideQuestions(() => { throw new Error('Unexpected resume'); });
  const older = service.register('app', stubQuery(), () => {});
  const newer = stubQuery();
  newer.askSideQuestion = async () => ({ response: 'New context', synthetic: false });
  const handle = service.register('app', newer, () => {});
  older.dispose();
  assert.equal((await service.ask('app', input, options, signal())).response, 'New context');
  handle.dispose();
});

test('empty conversations and unsupported SDKs report an error instead of a model prompt', async () => {
  const service = new ClaudeSideQuestions();
  await assert.rejects(service.ask('app', input, async () => ({}), signal()), /Start a Claude conversation/);
  const native = { ...stubQuery(), askSideQuestion: undefined };
  const handle = service.register('app', native, () => {});
  await assert.rejects(service.ask('app', input, options, signal()), /does not support/);
  handle.dispose();
});

test('idle request failure closes the temporary native worker', async () => {
  const native = stubQuery();
  native.askSideQuestion = async () => { throw new Error('API unavailable'); };
  const service = new ClaudeSideQuestions(() => native);
  await assert.rejects(service.ask('app', input, options, signal()), /API unavailable/);
  assert.equal(native.isClosed(), true);
});

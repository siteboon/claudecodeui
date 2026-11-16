import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import type * as Api from '@/shared/api';

/**
 * Drafts moved out of the browser and into auth.db so a message half-typed on
 * one device can be finished on another — the case the composer could not serve
 * at all before, because a draft only existed on the machine it was typed on.
 *
 * Each test loads a fresh module copy, because the store reads its localStorage
 * mirror once at module scope.
 */

type SavedDraft = { scope: string; text: string; queuedMessage?: unknown };

const savedDrafts: SavedDraft[] = [];
const appendRequests: Array<{ scope: string; queuedMessage: unknown }> = [];
const clearedScopes: string[] = [];
let serverDrafts: unknown[] = [];
let draftsRequestFailed = false;
// Lets a test hold the drafts response, to land it after a later queue change.
let draftsResponseGate: Promise<void> | null = null;
// What the server answers to an append; by default it queues the message alone.
let appendResponse: ((queuedMessage: unknown) => Response) | null = null;
// Lets a test hold an append's answer, to make a queue change while it is in flight.
let appendResponseGate: Promise<void> | null = null;
// What the server answers to a clear.
let clearStatus = 200;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  api: {
    user: {
      drafts: async () => {
        if (draftsRequestFailed) {
          throw new Error('offline');
        }
        const snapshot = serverDrafts;
        await draftsResponseGate;
        return json({ success: true, drafts: snapshot });
      },
      saveDraft: async (scope: string, draft: { text: string; queuedMessage?: unknown }) => {
        savedDrafts.push({ scope, ...draft });
        return new Response('{}', { status: 200 });
      },
      appendQueuedMessage: async (scope: string, queuedMessage: unknown) => {
        appendRequests.push({ scope, queuedMessage });
        await appendResponseGate;
        return appendResponse
          ? appendResponse(queuedMessage)
          : json({ success: true, queuedMessage, appended: false });
      },
      clearQueuedMessage: async (scope: string) => {
        clearedScopes.push(scope);
        return new Response('{}', { status: clearStatus });
      },
    },
  },
}));

const loadStore = async () => {
  vi.resetModules();
  return import('@/shared/chatDrafts');
};

beforeEach(() => {
  localStorage.clear();
  savedDrafts.length = 0;
  appendRequests.length = 0;
  clearedScopes.length = 0;
  serverDrafts = [];
  draftsRequestFailed = false;
  draftsResponseGate = null;
  appendResponse = null;
  appendResponseGate = null;
  clearStatus = 200;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('a draft is readable synchronously and reaches the server after the debounce', async () => {
  const store = await loadStore();

  store.writeDraftText('session-a', 'half a thought');

  assert.equal(store.readDraftText('session-a'), 'half a thought');
  assert.deepEqual(savedDrafts, [], 'the request must not fire on every keystroke');

  await vi.advanceTimersByTimeAsync(1_500);
  assert.deepEqual(savedDrafts, [
    { scope: 'session-a', text: 'half a thought' },
  ]);
});

test('each session keeps its own draft', async () => {
  const store = await loadStore();

  store.writeDraftText('session-a', 'for A');
  store.writeDraftText('session-b', 'for B');

  assert.equal(store.readDraftText('session-a'), 'for A');
  assert.equal(store.readDraftText('session-b'), 'for B');
});

test('a chat with no session yet is scoped to its project', async () => {
  const store = await loadStore();

  store.writeDraftText('project:p1', 'unsent');

  assert.equal(store.readDraftText('project:p1'), 'unsent');
  assert.equal(store.readDraftText('session-a'), '');
});

test('clearing a draft saves the empty text and leaves dropping the row to the server', async () => {
  // Deleting the row from here would also delete a message queued for the
  // scope from another tab; the server drops the row only when nothing is left.
  const store = await loadStore();
  store.writeDraftText('session-a', 'typed');
  await vi.advanceTimersByTimeAsync(1_500);
  savedDrafts.length = 0;

  store.writeDraftText('session-a', '');
  await vi.advanceTimersByTimeAsync(1_500);

  assert.deepEqual(savedDrafts, [{ scope: 'session-a', text: '' }]);
});

test('a draft written in one page load is readable synchronously in the next', async () => {
  const first = await loadStore();
  first.writeDraftText('session-a', 'survives a reload');

  // No hydrate: this is the first paint of the next load, before any request
  // could have resolved.
  const second = await loadStore();
  assert.equal(second.readDraftText('session-a'), 'survives a reload');
});

test('hydrate brings in a draft typed on another device', async () => {
  serverDrafts = [{ scope: 'session-a', text: 'typed on the laptop', queuedMessage: null }];

  const store = await loadStore();
  await store.hydrateChatDrafts();

  assert.equal(store.readDraftText('session-a'), 'typed on the laptop');
});

test('hydrate removes a mirrored queue after the server claims it', async () => {
  const store = await loadStore();
  await store.appendQueuedMessage('session-a', { content: 'server-owned queue' });
  assert.equal(store.readQueuedMessage('session-a')?.content, 'server-owned queue');

  serverDrafts = [];
  await store.hydrateChatDrafts();

  assert.equal(store.readQueuedMessage('session-a'), null);
});

test('hydrate does not overwrite a scope the user is typing into right now', async () => {
  serverDrafts = [{ scope: 'session-a', text: 'stale server copy', queuedMessage: null }];

  const store = await loadStore();
  store.writeDraftText('session-a', 'what I am writing');
  await store.hydrateChatDrafts();

  assert.equal(store.readDraftText('session-a'), 'what I am writing');
});

test('a failed hydrate keeps the mirrored draft rather than blanking the composer', async () => {
  const store = await loadStore();
  store.writeDraftText('session-a', 'local work');
  await vi.advanceTimersByTimeAsync(1_500);

  draftsRequestFailed = true;
  await store.hydrateChatDrafts();

  assert.equal(store.readDraftText('session-a'), 'local work');
});

test('queueing goes to the server at once and keeps what it says is now queued', async () => {
  // The server appended this to a message another tab had queued.
  appendResponse = () => json({
    success: true,
    queuedMessage: { content: 'from the laptop\n\nsend this next', attachments: [] },
    appended: true,
  });
  const store = await loadStore();
  store.writeDraftText('session-a', 'still editing');

  const result = await store.appendQueuedMessage('session-a', { content: 'send this next', attachments: [] });

  assert.deepEqual(appendRequests, [{
    scope: 'session-a',
    queuedMessage: { content: 'send this next', attachments: [] },
  }], 'queue actions persist without waiting for the draft debounce');
  assert.deepEqual(result, {
    queuedMessage: { content: 'from the laptop\n\nsend this next', attachments: [] },
    appended: true,
  });
  assert.equal(store.readQueuedMessage('session-a')?.content, 'from the laptop\n\nsend this next');
  assert.equal(store.readDraftText('session-a'), 'still editing');
});

test('a text save never carries the queued message, so it cannot bring back one already sent', async () => {
  const store = await loadStore();
  await store.appendQueuedMessage('session-a', { content: 'queued A', attachments: [] });

  // The dispatcher sends "queued A" while the user types the next follow-up.
  store.writeDraftText('session-a', 'typing the next one');
  await vi.advanceTimersByTimeAsync(1_500);

  assert.deepEqual(savedDrafts, [{ scope: 'session-a', text: 'typing the next one' }]);
});

test('hydrate takes the server\'s queued message even for a scope being typed into', async () => {
  const store = await loadStore();
  await store.appendQueuedMessage('session-a', { content: 'queued A', attachments: [] });
  store.writeDraftText('session-a', 'typing');

  // Claimed and sent; the server still has the older text.
  serverDrafts = [{ scope: 'session-a', text: 'typ', queuedMessage: null }];
  await store.hydrateChatDrafts();

  assert.equal(store.readQueuedMessage('session-a'), null, 'the sent message leaves the card');
  assert.equal(store.readDraftText('session-a'), 'typing', 'the text being typed stays');
});

test('a hydrate already in flight when a message is queued does not put back the older queue', async () => {
  const store = await loadStore();
  await store.appendQueuedMessage('session-a', { content: 'A', attachments: [] });

  serverDrafts = [{ scope: 'session-a', text: '', queuedMessage: { content: 'A', attachments: [] } }];
  let releaseDrafts!: () => void;
  draftsResponseGate = new Promise((resolve) => { releaseDrafts = resolve; });
  const hydrating = store.hydrateChatDrafts();

  appendResponse = () => json({ success: true, queuedMessage: { content: 'A\n\nB', attachments: [] }, appended: true });
  await store.appendQueuedMessage('session-a', { content: 'B', attachments: [] });
  releaseDrafts();
  await hydrating;

  assert.equal(store.readQueuedMessage('session-a')?.content, 'A\n\nB');
});

test('a hydrate already in flight when the queued message is cleared does not bring it back', async () => {
  const store = await loadStore();
  await store.appendQueuedMessage('session-a', { content: 'A', attachments: [] });

  serverDrafts = [{ scope: 'session-a', text: '', queuedMessage: { content: 'A', attachments: [] } }];
  let releaseDrafts!: () => void;
  draftsResponseGate = new Promise((resolve) => { releaseDrafts = resolve; });
  const hydrating = store.hydrateChatDrafts();

  store.clearQueuedMessage('session-a');
  releaseDrafts();
  await hydrating;

  assert.equal(store.readQueuedMessage('session-a'), null);
});

test('a hydrate takes the server\'s text for a scope whose queue changed but which nobody typed into', async () => {
  const store = await loadStore();
  store.writeDraftText('session-a', 'older text');
  await vi.advanceTimersByTimeAsync(1_500);

  serverDrafts = [{ scope: 'session-a', text: 'typed on the phone', queuedMessage: null }];
  let releaseDrafts!: () => void;
  draftsResponseGate = new Promise((resolve) => { releaseDrafts = resolve; });
  const hydrating = store.hydrateChatDrafts();
  await store.appendQueuedMessage('session-a', { content: 'B', attachments: [] });
  releaseDrafts();
  await hydrating;

  assert.equal(store.readDraftText('session-a'), 'typed on the phone');
  assert.equal(store.readQueuedMessage('session-a')?.content, 'B');
});

test('a clear made while an append is being answered is sent after it, and the message queued again', async () => {
  appendResponse = (queuedMessage) => json({ success: true, queuedMessage, appended: false });
  const store = await loadStore();
  let releaseAppend!: () => void;
  appendResponseGate = new Promise((resolve) => { releaseAppend = resolve; });

  const appending = store.appendQueuedMessage('session-a', { content: 'B', attachments: [] });
  await vi.advanceTimersByTimeAsync(0);
  store.clearQueuedMessage('session-a');
  assert.deepEqual(clearedScopes, [], 'the clear waits for the append to be answered');
  releaseAppend();
  const result = await appending;

  assert.deepEqual(clearedScopes, ['session-a']);
  assert.equal(appendRequests.length, 2, 'the clear removed B on the server too, so B is queued again');
  assert.equal(result.queuedMessage.content, 'B');
  assert.equal(store.readQueuedMessage('session-a')?.content, 'B');
});

test('a clear that fails while an append is being answered does not queue the message twice', async () => {
  appendResponse = () => json({ success: true, queuedMessage: { content: 'A\n\nB', attachments: [] }, appended: true });
  clearStatus = 503;
  const store = await loadStore();
  let releaseAppend!: () => void;
  appendResponseGate = new Promise((resolve) => { releaseAppend = resolve; });

  const appending = store.appendQueuedMessage('session-a', { content: 'B', attachments: [] });
  await vi.advanceTimersByTimeAsync(0);
  store.clearQueuedMessage('session-a');
  releaseAppend();
  const result = await appending;

  assert.equal(appendRequests.length, 1);
  assert.equal(result.queuedMessage.content, 'A\n\nB', 'the server still holds both, so that is what is shown');
  assert.equal(store.readQueuedMessage('session-a')?.content, 'A\n\nB');
});

test('a queue the server refuses rejects and changes nothing here', async () => {
  appendResponse = () => json({ success: false, error: { message: 'A queued message needs text or attachments' } }, 400);
  const store = await loadStore();

  await assert.rejects(
    store.appendQueuedMessage('session-a', { content: 'B', attachments: [] }),
    /needs text or attachments/,
  );
  assert.equal(store.readQueuedMessage('session-a'), null);
});

test('a refused queue carries the server\'s error code, so the composer can say why in the user\'s language', async () => {
  appendResponse = () => json({
    success: false,
    error: { code: 'QUEUED_MESSAGE_NOT_COMBINABLE', message: 'A slash command runs as a turn of its own' },
  }, 409);
  const store = await loadStore();

  await assert.rejects(
    store.appendQueuedMessage('session-a', { content: '/compact', attachments: [] }),
    { code: 'QUEUED_MESSAGE_NOT_COMBINABLE', status: 409, message: 'A slash command runs as a turn of its own' },
  );
});

test('a queued message with neither text nor attachments reads as absent', async () => {
  localStorage.setItem('chat-drafts', JSON.stringify({
    'session-a': { text: '', queuedMessage: { content: '   ', attachments: [] } },
  }));
  const store = await loadStore();

  assert.equal(store.readQueuedMessage('session-a'), null);
});

test('legacy image-only descriptors are still readable as attachments', async () => {
  localStorage.setItem('chat-drafts', JSON.stringify({
    'session-a': { text: '', queuedMessage: { content: '', images: [{ name: 'shot.png' }] } },
  }));
  const store = await loadStore();

  assert.deepEqual(store.readQueuedMessage('session-a')?.attachments, [{ name: 'shot.png' }]);
});

test('clearing the queued message tells the server at once and leaves the draft text alone', async () => {
  const store = await loadStore();
  store.writeDraftText('session-a', 'keep me');
  await store.appendQueuedMessage('session-a', { content: 'queued' });

  store.clearQueuedMessage('session-a');

  assert.equal(store.readQueuedMessage('session-a'), null);
  assert.equal(store.readDraftText('session-a'), 'keep me');
  assert.deepEqual(clearedScopes, ['session-a']);
});

test('subscribers are notified on a write', async () => {
  const store = await loadStore();
  const listener = vi.fn();
  const unsubscribe = store.subscribeToChatDrafts(listener);

  store.writeDraftText('session-a', 'typed');
  assert.equal(listener.mock.calls.length, 1);

  // Writing the same text again changes nothing, so nobody is woken.
  store.writeDraftText('session-a', 'typed');
  assert.equal(listener.mock.calls.length, 1);

  unsubscribe();
  store.writeDraftText('session-a', 'more');
  assert.equal(listener.mock.calls.length, 1);
});

test('reset clears the drafts so the next user does not see them', async () => {
  const store = await loadStore();
  store.writeDraftText('session-a', 'private');

  store.resetChatDrafts();

  assert.equal(store.readDraftText('session-a'), '');
  assert.equal(localStorage.getItem('chat-drafts'), null);
});

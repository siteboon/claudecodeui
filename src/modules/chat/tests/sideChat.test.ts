import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useSideChat } from '@/modules/chat/hooks/useSideChat';

/**
 * The /btw side chat keeps its questions in the page, one list per chat, and
 * sends the earlier answered ones with each follow-up since nothing is saved.
 */

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const btwBodies = () => vi.mocked(fetch).mock.calls
  .filter(([url]) => String(url).includes('/api/providers/claude/btw'))
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

let answers: string[] = [];

beforeEach(() => {
  answers = ['On the right.', 'Yes, red.'];
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes('/api/providers/claude/btw')) {
      if (JSON.parse(String(init?.body)).question === 'slow') {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      return jsonResponse({ success: true, data: { answer: answers.shift() } });
    }
    return jsonResponse([]);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const render = (sessionId: string) => renderHook(
  ({ id }: { id: string }) => useSideChat({ sessionId: id, model: 'main-model', effort: 'high' }),
  { initialProps: { id: sessionId } },
);

test('a question opens the side chat, and a follow-up carries the earlier exchange', async () => {
  const view = render('chat-1');
  assert.equal(view.result.current.isOpen, false);

  await act(async () => { await view.result.current.ask('where is the box?'); });
  assert.equal(view.result.current.isOpen, true);
  assert.equal(view.result.current.entries[0].answer, 'On the right.');

  await act(async () => { await view.result.current.ask('is it red?'); });
  const [first, second] = btwBodies();
  assert.deepEqual(first.history, []);
  assert.equal(first.model, 'main-model');
  assert.equal(first.effort, 'high');
  assert.deepEqual(second.history, [{ question: 'where is the box?', answer: 'On the right.' }]);
  assert.equal(view.result.current.entries[1].answer, 'Yes, red.');
});

test('the side chat\'s own model is used once picked', async () => {
  const view = render('chat-1');
  act(() => { view.result.current.setModel('side-model'); });
  await act(async () => { await view.result.current.ask('q'); });
  assert.equal(btwBodies()[0].model, 'side-model');
});

test('Stop ends a running question', async () => {
  const view = render('chat-1');
  let pending!: Promise<void>;
  act(() => { pending = view.result.current.ask('slow'); });
  await waitFor(() => assert.equal(view.result.current.busy, true));
  await act(async () => {
    view.result.current.stop();
    await pending;
  });
  assert.equal(view.result.current.busy, false);
  assert.equal(view.result.current.entries[0].error, 'Stopped.');
});

test('each chat has its own side chat', async () => {
  const view = render('chat-1');
  await act(async () => { await view.result.current.ask('where is the box?'); });
  view.rerender({ id: 'chat-2' });
  assert.equal(view.result.current.entries.length, 0);
  view.rerender({ id: 'chat-1' });
  assert.equal(view.result.current.entries.length, 1);
});

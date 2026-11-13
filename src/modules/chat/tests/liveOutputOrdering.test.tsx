import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';
import type { NormalizedMessage } from '@/shared/types';
import { useSessionStore } from '@/modules/chat/hooks/useSessionStore';
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';

const { sessionMessages } = vi.hoisted(() => ({ sessionMessages: vi.fn() }));
vi.mock('@/shared/api', () => ({ api: { providers: { sessionMessages } } }));

const row = (id: string, content: string, second: number, extra: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  id, content, sessionId: 'session', provider: 'codex', kind: 'text', role: 'assistant',
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString(), ...extra,
});
const history = (messages: NormalizedMessage[]) => sessionMessages.mockResolvedValue({
  ok: true, json: async () => ({ data: { messages, total: messages.length, hasMore: false } }),
});
beforeEach(() => { sessionMessages.mockReset(); history([]); });

test('updates an item in its original position instead of appending duplicate revisions', () => {
  const { result } = renderHook(() => useSessionStore());
  act(() => {
    result.current.appendRealtime('session', row('progress', 'Checking', 1));
    result.current.appendRealtime('session', row('final', 'Done', 3));
    result.current.appendRealtime('session', row('progress', 'Checking complete', 4));
  });
  assert.deepEqual(result.current.getMessages('session').map(m => m.content), ['Checking complete', 'Done']);
  assert.equal(result.current.getMessages('session')[0].timestamp, row('', '', 1).timestamp);
});

test('a stale history snapshot cannot swallow a newer live item revision', async () => {
  const { result } = renderHook(() => useSessionStore());
  history([row('reply', 'First', 0)]);
  await act(async () => { await result.current.fetchFromServer('session'); });
  act(() => { result.current.appendRealtime('session', row('reply', 'First, then more detail', 5)); });
  assert.equal(result.current.getMessages('session')[0].content, 'First, then more detail');
  await act(async () => { await result.current.refreshLatestFromServer('session'); });
  assert.equal(result.current.getMessages('session')[0].content, 'First, then more detail');
  history([row('reply', 'First, then more detail', 0)]);
  await act(async () => { await result.current.refreshLatestFromServer('session'); });
  assert.equal(result.current.getMessages('session').length, 1);
  assert.equal(result.current.getSessionSlot('session')?.realtimeMessages.length, 0);
});

test('history timestamps cannot move an intermediate message behind the final answer', async () => {
  const { result } = renderHook(() => useSessionStore());
  act(() => {
    result.current.appendRealtime('session', row('middle', 'Checking the files', 4));
    result.current.appendRealtime('session', row('final', 'Finished', 8));
  });
  // Codex history stamps each item with the turn start. Its partial item view
  // can lag a live message even while a later completed item is already present.
  history([row('prompt', 'Please inspect', 0, { role: 'user' }), row('final', 'Finished', 0)]);
  await act(async () => { await result.current.refreshLatestFromServer('session'); });
  assert.deepEqual(result.current.getMessages('session').map(m => m.id), ['prompt', 'middle', 'final']);
  await act(async () => { await result.current.refreshLatestFromServer('session'); });
  assert.deepEqual(result.current.getMessages('session').map(m => m.id), ['prompt', 'middle', 'final']);
});

test('distinct provider items with identical text remain visible', () => {
  const { result } = renderHook(() => useSessionStore());
  act(() => {
    result.current.appendRealtime('session', row('first-check', 'Checking', 1));
    result.current.appendRealtime('session', row('second-check', 'Checking', 2));
  });
  assert.deepEqual(result.current.getMessages('session').map(m => m.id), ['first-check', 'second-check']);
});

test('a long run keeps the latest 500 items while revisions retain their position', () => {
  const { result } = renderHook(() => useSessionStore());
  act(() => {
    for (let i = 0; i < 510; i++) result.current.appendRealtime('session', row(`item-${i}`, `Step ${i}`, i));
  });
  assert.equal(result.current.getMessages('session').length, 500);
  assert.equal(result.current.getMessages('session')[0].id, 'item-10');
  act(() => { result.current.appendRealtime('session', row('item-10', 'Updated step', 511)); });
  assert.equal(result.current.getMessages('session').length, 500);
  assert.equal(result.current.getMessages('session')[0].content, 'Updated step');
  assert.equal(result.current.getMessages('session').at(-1)?.id, 'item-509');
});

test('live command output supersedes a stale result attached to history', async () => {
  const { result } = renderHook(() => useSessionStore());
  history([row('tool', '', 0, {
    kind: 'tool_use', toolId: 'tool', toolName: 'Bash',
    toolResult: { content: 'first line', isError: false },
  })]);
  await act(async () => { await result.current.fetchFromServer('session'); });
  act(() => {
    result.current.appendRealtime('session', row('tool_result', 'first line\nsecond line', 5, {
      kind: 'tool_result', toolId: 'tool',
    }));
  });
  const projected = normalizedToChatMessages(result.current.getMessages('session'));
  assert.equal(projected[0].toolResult?.content, 'first line\nsecond line');
});

test('replayed older snapshots cannot overwrite the latest item revision', () => {
  const { result } = renderHook(() => useSessionStore());
  act(() => {
    result.current.appendRealtime('session', row('item', 'Latest', 4, { seq: 9 }));
    result.current.appendRealtime('session', row('item', 'Older', 2, { seq: 7 }));
    result.current.appendRealtime('session', row('item', 'Latest', 4, { seq: 9 }));
  });
  assert.deepEqual(result.current.getMessages('session').map(m => m.content), ['Latest']);
});

test('streaming snapshots retain their position while content and completion change', () => {
  const { result } = renderHook(() => useSessionStore());
  act(() => { result.current.appendRealtime('session', row('reply', 'Working', 1, { status: 'in_progress' })); });
  assert.equal(normalizedToChatMessages(result.current.getMessages('session'))[0].isStreaming, true);
  act(() => { result.current.appendRealtime('session', row('reply', 'Finished', 4, { status: 'completed' })); });
  const projected = normalizedToChatMessages(result.current.getMessages('session'));
  assert.equal(projected.length, 1);
  assert.equal(projected[0].isStreaming, false);
});

test('projected rows keep distinct stable identities across streaming and history', () => {
  const first = row('progress', 'The same initial text', 0, { status: 'in_progress' });
  const final = row('final', 'The same initial text', 0);
  const projected = normalizedToChatMessages([first, final]);
  assert.deepEqual(projected.map(message => message.id), ['progress', 'final']);
  const revised = normalizedToChatMessages([{ ...first, content: 'A revised message', status: 'completed' }, final]);
  assert.deepEqual(revised.map(message => message.id), ['progress', 'final']);
});

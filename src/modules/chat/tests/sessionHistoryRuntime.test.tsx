import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { useSessionStore } from '@/modules/chat/hooks/useSessionStore';
import { readUserPreference } from '@/shared/userSettings';
import type { CodexRuntimeMode, NormalizedMessage } from '@/shared/types';

const sessionMessages = vi.hoisted(() => vi.fn());

vi.mock('@/shared/api', () => ({
  api: { providers: { sessionMessages } },
}));
vi.mock('@/shared/userSettings', () => ({ readUserPreference: vi.fn() }));

beforeEach(() => {
  sessionMessages.mockReset();
  vi.mocked(readUserPreference).mockReturnValue({ runtimeMode: 'sdk' });
});

function historyMessages(mode: CodexRuntimeMode, count: number): NormalizedMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${mode}-${index}`, sessionId: 'same-session', provider: 'codex', kind: 'text',
    role: 'assistant', content: `${mode} message ${index}`,
    timestamp: new Date(Date.UTC(2026, 8, 28, 0, 0, index)).toISOString(),
  }));
}

function historyResponse(messages: NormalizedMessage[], hasMore = false, tokenUsage?: unknown) {
  return { ok: true, json: async () => ({ data: { messages, total: messages.length, hasMore, tokenUsage } }) };
}

function serveHistory(histories: Record<CodexRuntimeMode, NormalizedMessage[]>) {
  sessionMessages.mockImplementation(async (_sessionId, options) => {
    const messages = histories[options.codexRuntimeMode as CodexRuntimeMode];
    const end = Math.max(0, messages.length - (options.offset ?? 0));
    const start = Math.max(0, end - (options.limit ?? messages.length));
    return { ok: true, json: async () => ({ data: {
      messages: messages.slice(start, end), total: messages.length, hasMore: start > 0,
    } }) };
  });
}

test('history requests use the current Codex preference on every page', async () => {
  sessionMessages.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { messages: [], total: 0, hasMore: false } }),
  });
  const { result } = renderHook(() => useSessionStore());

  for (const runtimeMode of ['sdk', 'app-server', undefined]) {
    vi.mocked(readUserPreference).mockReturnValue({ runtimeMode });
    await act(async () => {
      await result.current.fetchFromServer(`session-${runtimeMode}`, { limit: 20, offset: 0 });
    });
    assert.deepEqual(sessionMessages.mock.lastCall?.slice(0, 2), [
      `session-${runtimeMode}`,
      { limit: 20, offset: 0, codexRuntimeMode: runtimeMode ?? 'app-server' },
    ]);
    assert.equal(vi.mocked(readUserPreference).mock.lastCall?.[0], 'codexPermissions');
  }
});

for (const initialMode of ['sdk', 'app-server'] as const) {
  test(`switching from ${initialMode} rebuilds the same session cache before paging`, async () => {
    const nextMode = initialMode === 'sdk' ? 'app-server' : 'sdk';
    serveHistory({ sdk: historyMessages('sdk', 42), 'app-server': historyMessages('app-server', 40) });
    vi.mocked(readUserPreference).mockReturnValue({ runtimeMode: initialMode });
    const { result } = renderHook(() => useSessionStore());
    await act(async () => { await result.current.fetchFromServer('same-session', { limit: 20 }); });
    assert.equal(result.current.isStale('same-session'), false);
    vi.mocked(readUserPreference).mockReturnValue({ runtimeMode: nextMode });
    assert.equal(result.current.isStale('same-session'), true);

    await act(async () => { await result.current.fetchMore('same-session', { limit: 20 }); });
    assert.equal(sessionMessages.mock.lastCall?.[1].offset, 0);
    assert.ok(result.current.getSessionSlot('same-session')?.serverMessages.every((message) => message.id.startsWith(nextMode)));
    await act(async () => { await result.current.fetchMore('same-session', { limit: 20 }); });
    assert.equal(sessionMessages.mock.lastCall?.[1].offset, 20);
    assert.equal(result.current.getSessionSlot('same-session')?.serverMessages.length, 40);
  });
}

test('a completed old reader does not prevent a new reader from loading, and streaming text survives', async () => {
  serveHistory({ sdk: historyMessages('sdk', 1), 'app-server': historyMessages('app-server', 25) });
  const { result } = renderHook(() => useSessionStore());
  await act(async () => { await result.current.fetchFromServer('same-session', { limit: 20 }); });
  act(() => { result.current.updateStreaming('same-session', 'Still streaming', 'codex'); });
  vi.mocked(readUserPreference).mockReturnValue({ runtimeMode: 'app-server' });
  await act(async () => { await result.current.fetchMore('same-session', { limit: 20 }); });
  const slot = result.current.getSessionSlot('same-session');
  assert.equal(slot?.serverMessages.length, 20);
  assert.equal(slot?.hasMore, true);
  assert.equal(slot?.realtimeMessages[0]?.content, 'Still streaming');
});

test('late responses from the previous reader cannot overwrite a rebuilt slot', async () => {
  let releaseOldPage!: (response: ReturnType<typeof historyResponse>) => void;
  sessionMessages.mockImplementationOnce(() => new Promise((resolve) => { releaseOldPage = resolve; }));
  const { result } = renderHook(() => useSessionStore());
  let oldRead!: ReturnType<typeof result.current.fetchFromServer>;
  act(() => { oldRead = result.current.fetchFromServer('same-session', { limit: 20 }); });
  await waitFor(() => assert.equal(sessionMessages.mock.calls.length, 1));

  vi.mocked(readUserPreference).mockReturnValue({ runtimeMode: 'app-server' });
  sessionMessages.mockResolvedValue(historyResponse(historyMessages('app-server', 2), false, { used: 20 }));
  await act(async () => { await result.current.fetchFromServer('same-session', { limit: 20, offset: 20 }); });
  assert.equal(sessionMessages.mock.lastCall?.[1].offset, 0);
  await act(async () => {
    releaseOldPage(historyResponse(historyMessages('sdk', 1), false, { used: 999 }));
    assert.equal(await oldRead, null);
  });
  const slot = result.current.getSessionSlot('same-session');
  assert.deepEqual(slot?.serverMessages.map((message) => message.id), ['app-server-0', 'app-server-1']);
  assert.deepEqual(slot?.tokenUsage, { used: 20 });
});

test('a mode change during a latest-page request discards that response and resets on retry', async () => {
  serveHistory({ sdk: historyMessages('sdk', 30), 'app-server': historyMessages('app-server', 25) });
  const { result } = renderHook(() => useSessionStore());
  await act(async () => { await result.current.fetchFromServer('same-session', { limit: 20 }); });
  let releasePage!: (response: ReturnType<typeof historyResponse>) => void;
  sessionMessages.mockImplementationOnce(() => new Promise((resolve) => { releasePage = resolve; }));
  let refresh!: ReturnType<typeof result.current.refreshLatestFromServer>;
  act(() => { refresh = result.current.refreshLatestFromServer('same-session', { limit: 20 }); });
  await waitFor(() => assert.equal(sessionMessages.mock.calls.length, 2));
  vi.mocked(readUserPreference).mockReturnValue({ runtimeMode: 'app-server' });
  await act(async () => {
    releasePage(historyResponse(historyMessages('sdk', 3), false, { used: 999 }));
    assert.equal((await refresh).applied, false);
  });
  assert.equal(result.current.getSessionSlot('same-session')?.tokenUsage, undefined);
  await act(async () => { await result.current.refreshLatestFromServer('same-session', { limit: 20 }); });
  assert.ok(result.current.getSessionSlot('same-session')?.serverMessages.every((message) => message.id.startsWith('app-server')));
  assert.equal(sessionMessages.mock.lastCall?.[1].offset, 0);
});

test('switching readers while a bridge page is pending does not merge the old bridge', async () => {
  serveHistory({ sdk: historyMessages('sdk', 30), 'app-server': historyMessages('app-server', 25) });
  const { result } = renderHook(() => useSessionStore());
  await act(async () => { await result.current.fetchFromServer('same-session', { limit: 20 }); });
  const olderCache = result.current.getSessionSlot('same-session')?.serverMessages;
  const grownHistory = historyMessages('sdk', 60);
  sessionMessages.mockResolvedValueOnce({ ok: true, json: async () => ({ data: {
    messages: grownHistory.slice(40), total: 60, hasMore: true,
  } }) });
  let releaseBridge!: (response: unknown) => void;
  sessionMessages.mockImplementationOnce(() => new Promise((resolve) => { releaseBridge = resolve; }));
  let refresh!: ReturnType<typeof result.current.refreshLatestFromServer>;
  act(() => { refresh = result.current.refreshLatestFromServer('same-session', { limit: 20 }); });
  await waitFor(() => assert.equal(sessionMessages.mock.calls.length, 3));
  assert.equal(sessionMessages.mock.lastCall?.[1].codexRuntimeMode, 'sdk');
  vi.mocked(readUserPreference).mockReturnValue({ runtimeMode: 'app-server' });
  await act(async () => {
    releaseBridge({ ok: true, json: async () => ({ data: {
      messages: grownHistory.slice(29, 40), total: 60, hasMore: true,
    } }) });
    assert.equal((await refresh).applied, false);
  });
  assert.equal(result.current.getSessionSlot('same-session')?.serverMessages, olderCache);
});

test('a failed outdated read does not leave the slot stuck loading', async () => {
  let rejectPage!: (error: Error) => void;
  sessionMessages.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPage = reject; }));
  const { result } = renderHook(() => useSessionStore());
  let read!: ReturnType<typeof result.current.fetchFromServer>;
  act(() => { read = result.current.fetchFromServer('same-session', { limit: 20 }); });
  await waitFor(() => assert.equal(sessionMessages.mock.calls.length, 1));
  vi.mocked(readUserPreference).mockReturnValue({ runtimeMode: 'app-server' });
  await act(async () => {
    rejectPage(new Error('Old reader failed'));
    assert.equal(await read, null);
  });
  assert.equal(result.current.getSessionSlot('same-session')?.status, 'idle');
  assert.equal(result.current.isStale('same-session'), true);
});

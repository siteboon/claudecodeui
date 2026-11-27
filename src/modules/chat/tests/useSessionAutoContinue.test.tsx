import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import { api } from '@/shared/api';
import { useSessionAutoContinue } from '@/modules/chat/composer/useSessionAutoContinue';

function flagResponse(enabled: boolean, ok = true): Response {
  return { ok, json: async () => ({ data: { enabled } }) } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

test('each session shows its own auto-continue setting', async () => {
  vi.spyOn(api, 'sessionAutoContinue').mockImplementation(async (sessionId: string) =>
    flagResponse(sessionId === 'session-a'));

  const { result, rerender } = renderHook(({ sessionId }) => useSessionAutoContinue(sessionId), {
    initialProps: { sessionId: 'session-a' as string | null },
  });
  await waitFor(() => assert.equal(result.current.enabled, true));

  rerender({ sessionId: 'session-b' });
  // Never shows session A's setting on session B, not even while B's loads.
  assert.equal(result.current.enabled, false);
});

test('toggling saves the setting for the session', async () => {
  vi.spyOn(api, 'sessionAutoContinue').mockResolvedValue(flagResponse(false));
  const save = vi.spyOn(api, 'setSessionAutoContinue').mockResolvedValue(flagResponse(true));

  const { result } = renderHook(() => useSessionAutoContinue('session-a'));
  await waitFor(() => assert.equal(result.current.enabled, false));

  await act(async () => {
    await result.current.setEnabled(true);
  });

  assert.deepEqual(save.mock.calls, [['session-a', true]]);
  assert.equal(result.current.enabled, true);
});

test('a failed save puts the toggle back', async () => {
  vi.spyOn(api, 'sessionAutoContinue').mockResolvedValue(flagResponse(false));
  vi.spyOn(api, 'setSessionAutoContinue').mockResolvedValue(flagResponse(true, false));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  const { result } = renderHook(() => useSessionAutoContinue('session-a'));
  await waitFor(() => assert.equal(result.current.enabled, false));

  await act(async () => {
    await result.current.setEnabled(true);
  });

  assert.equal(result.current.enabled, false);
});

test('a slow read for the previous session cannot land on the next one', async () => {
  let releaseSessionA: (() => void) | undefined;
  vi.spyOn(api, 'sessionAutoContinue').mockImplementation((sessionId: string) => {
    if (sessionId === 'session-a') {
      return new Promise<Response>((resolve) => {
        releaseSessionA = () => resolve(flagResponse(true));
      });
    }
    return Promise.resolve(flagResponse(false));
  });

  const { result, rerender } = renderHook(({ sessionId }) => useSessionAutoContinue(sessionId), {
    initialProps: { sessionId: 'session-a' as string | null },
  });
  rerender({ sessionId: 'session-b' });
  await waitFor(() => assert.ok(releaseSessionA));

  await act(async () => {
    releaseSessionA?.();
  });

  assert.equal(result.current.enabled, false);
});

test('a slow first read does not undo a toggle made meanwhile', async () => {
  let releaseRead: (() => void) | undefined;
  vi.spyOn(api, 'sessionAutoContinue').mockImplementation(() => new Promise<Response>((resolve) => {
    releaseRead = () => resolve(flagResponse(false));
  }));
  vi.spyOn(api, 'setSessionAutoContinue').mockResolvedValue(flagResponse(true));

  const { result } = renderHook(() => useSessionAutoContinue('session-a'));
  await waitFor(() => assert.ok(releaseRead));
  await act(async () => {
    await result.current.setEnabled(true);
  });
  await act(async () => {
    releaseRead?.();
  });

  assert.equal(result.current.enabled, true);
});

test('a failed older save does not undo a newer choice', async () => {
  vi.spyOn(api, 'sessionAutoContinue').mockResolvedValue(flagResponse(false));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let failFirst: (() => void) | undefined;
  vi.spyOn(api, 'setSessionAutoContinue')
    .mockImplementationOnce(() => new Promise<Response>((resolve) => {
      failFirst = () => resolve(flagResponse(true, false));
    }))
    .mockResolvedValue(flagResponse(true));

  const { result } = renderHook(() => useSessionAutoContinue('session-a'));
  await waitFor(() => assert.equal(result.current.enabled, false));

  let saves: Promise<void>[] = [];
  act(() => {
    saves = [result.current.setEnabled(true), result.current.setEnabled(false), result.current.setEnabled(true)];
  });
  await waitFor(() => assert.ok(failFirst));
  await act(async () => {
    failFirst?.();
    await Promise.all(saves);
  });

  // Rolling the first click back would flip the newest choice off.
  assert.equal(result.current.enabled, true);
});

test('a failed save shows what the server actually has', async () => {
  // The first read is discarded by the click; the rollback must not guess.
  let releaseFirstRead: (() => void) | undefined;
  const read = vi.spyOn(api, 'sessionAutoContinue')
    .mockImplementationOnce(() => new Promise<Response>((resolve) => {
      releaseFirstRead = () => resolve(flagResponse(true));
    }))
    .mockResolvedValue(flagResponse(true));
  vi.spyOn(api, 'setSessionAutoContinue').mockResolvedValue(flagResponse(false, false));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  const { result } = renderHook(() => useSessionAutoContinue('session-a'));
  await waitFor(() => assert.ok(releaseFirstRead));
  await act(async () => {
    await result.current.setEnabled(true);
  });
  await act(async () => {
    releaseFirstRead?.();
  });

  // Guessing `!next` would show off; the server says on.
  await waitFor(() => assert.equal(result.current.enabled, true));
  assert.equal(read.mock.calls.length, 2);
});

test('a failed save rolls back when the server cannot be read either', async () => {
  const read = vi.spyOn(api, 'sessionAutoContinue')
    .mockResolvedValueOnce(flagResponse(false))
    .mockResolvedValue(flagResponse(true, false));
  vi.spyOn(api, 'setSessionAutoContinue').mockResolvedValue(flagResponse(true, false));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  const { result } = renderHook(() => useSessionAutoContinue('session-a'));
  await waitFor(() => assert.equal(result.current.enabled, false));
  await act(async () => {
    await result.current.setEnabled(true);
  });

  // An error reply is not the server's answer; nothing was saved.
  assert.equal(read.mock.calls.length, 2);
  assert.equal(result.current.enabled, false);
});

test('saves reach the server in click order', async () => {
  vi.spyOn(api, 'sessionAutoContinue').mockResolvedValue(flagResponse(false));
  let releaseFirst: (() => void) | undefined;
  const save = vi.spyOn(api, 'setSessionAutoContinue')
    .mockImplementationOnce(() => new Promise<Response>((resolve) => {
      releaseFirst = () => resolve(flagResponse(true));
    }))
    .mockResolvedValue(flagResponse(false));

  const { result } = renderHook(() => useSessionAutoContinue('session-a'));
  await waitFor(() => assert.equal(result.current.enabled, false));

  let saves: Promise<void>[] = [];
  act(() => {
    saves = [result.current.setEnabled(true), result.current.setEnabled(false)];
  });
  await waitFor(() => assert.ok(releaseFirst));
  // The second write waits for the first, so it cannot overtake it.
  assert.equal(save.mock.calls.length, 1);
  await act(async () => {
    releaseFirst?.();
    await Promise.all(saves);
  });

  assert.deepEqual(save.mock.calls, [['session-a', true], ['session-a', false]]);
  assert.equal(result.current.enabled, false);
});

test('overlapping failed saves fall back to the confirmed value', async () => {
  vi.spyOn(api, 'sessionAutoContinue')
    .mockResolvedValueOnce(flagResponse(false))
    .mockResolvedValue(flagResponse(true, false));
  vi.spyOn(api, 'setSessionAutoContinue').mockResolvedValue(flagResponse(true, false));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  const { result } = renderHook(() => useSessionAutoContinue('session-a'));
  await waitFor(() => assert.equal(result.current.enabled, false));

  let saves: Promise<void>[] = [];
  act(() => {
    saves = [result.current.setEnabled(true), result.current.setEnabled(false)];
  });
  await act(async () => {
    await Promise.all(saves);
  });

  // Neither click reached the server; `!next` of the last one would show on.
  assert.equal(result.current.enabled, false);
});

test('a click before the first read falls back to the opposite when nothing can be read', async () => {
  vi.spyOn(api, 'sessionAutoContinue').mockResolvedValue(flagResponse(true, false));
  vi.spyOn(api, 'setSessionAutoContinue').mockResolvedValue(flagResponse(false, false));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  const { result } = renderHook(() => useSessionAutoContinue('session-a'));
  await act(async () => {
    await result.current.setEnabled(false);
  });

  // Nothing was ever confirmed, so the server still has what the click tried to change.
  assert.equal(result.current.enabled, true);
});

test('a session opened again while its save is queued shows the saved value', async () => {
  let serverValue = false;
  vi.spyOn(api, 'sessionAutoContinue').mockImplementation(async () => flagResponse(serverValue));
  let releaseSave: (() => void) | undefined;
  vi.spyOn(api, 'setSessionAutoContinue').mockImplementation((_id: string, next: boolean) =>
    new Promise<Response>((resolve) => {
      releaseSave = () => { serverValue = next; resolve(flagResponse(next)); };
    }));

  const { result, rerender } = renderHook(({ sessionId }) => useSessionAutoContinue(sessionId), {
    initialProps: { sessionId: 'session-a' as string | null },
  });
  await waitFor(() => assert.equal(result.current.enabled, false));

  let saving: Promise<void> | undefined;
  act(() => {
    saving = result.current.setEnabled(true);
  });
  rerender({ sessionId: 'session-b' });
  rerender({ sessionId: 'session-a' });
  await waitFor(() => assert.ok(releaseSave));
  await act(async () => {
    releaseSave?.();
    await saving;
  });

  await waitFor(() => assert.equal(result.current.enabled, true));
});

test('two clicks before anything is confirmed fall back to what was shown before them', async () => {
  vi.spyOn(api, 'sessionAutoContinue').mockResolvedValue(flagResponse(false, false));
  vi.spyOn(api, 'setSessionAutoContinue').mockResolvedValue(flagResponse(false, false));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  const { result } = renderHook(() => useSessionAutoContinue('session-a'));
  let saves: Promise<void>[] = [];
  act(() => {
    saves = [result.current.setEnabled(true), result.current.setEnabled(false)];
  });
  await act(async () => {
    await Promise.all(saves);
  });

  // Neither click reached the server; `!next` of the last one would show on.
  assert.equal(result.current.enabled, false);
});

test('a pending recovery read does not hold back the next save', async () => {
  vi.spyOn(api, 'sessionAutoContinue')
    .mockResolvedValueOnce(flagResponse(false))
    .mockImplementation(() => new Promise<Response>(() => undefined));
  const save = vi.spyOn(api, 'setSessionAutoContinue')
    .mockResolvedValueOnce(flagResponse(true, false))
    .mockResolvedValue(flagResponse(false));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  const { result } = renderHook(() => useSessionAutoContinue('session-a'));
  await waitFor(() => assert.equal(result.current.enabled, false));

  act(() => {
    void result.current.setEnabled(true);
  });
  await waitFor(() => assert.equal(save.mock.calls.length, 1));
  await act(async () => {
    await result.current.setEnabled(false);
  });

  assert.deepEqual(save.mock.calls, [['session-a', true], ['session-a', false]]);
});

test('a session opened again falls back to a save confirmed meanwhile when its read fails', async () => {
  vi.spyOn(api, 'sessionAutoContinue')
    .mockResolvedValueOnce(flagResponse(false))
    .mockResolvedValueOnce(flagResponse(false))
    .mockResolvedValue(flagResponse(false, false));
  let releaseSave: (() => void) | undefined;
  vi.spyOn(api, 'setSessionAutoContinue').mockImplementation(() => new Promise<Response>((resolve) => {
    releaseSave = () => resolve(flagResponse(true));
  }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  const { result, rerender } = renderHook(({ sessionId }) => useSessionAutoContinue(sessionId), {
    initialProps: { sessionId: 'session-a' as string | null },
  });
  await waitFor(() => assert.equal(result.current.enabled, false));
  let saving: Promise<void> | undefined;
  act(() => {
    saving = result.current.setEnabled(true);
  });
  rerender({ sessionId: 'session-b' });
  rerender({ sessionId: 'session-a' });
  await waitFor(() => assert.ok(releaseSave));
  await act(async () => {
    releaseSave?.();
    await saving;
  });

  await waitFor(() => assert.equal(result.current.enabled, true));
});

test('a click while an earlier recovery read runs keeps the fallback from before both', async () => {
  let failRead: (() => void) | undefined;
  vi.spyOn(api, 'sessionAutoContinue')
    .mockResolvedValueOnce(flagResponse(false, false))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => {
      failRead = () => resolve(flagResponse(false, false));
    }))
    .mockResolvedValue(flagResponse(false, false));
  vi.spyOn(api, 'setSessionAutoContinue').mockResolvedValue(flagResponse(false, false));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  const { result } = renderHook(() => useSessionAutoContinue('session-a'));
  let first: Promise<void> | undefined;
  act(() => {
    first = result.current.setEnabled(true);
  });
  await waitFor(() => assert.ok(failRead));
  // The switch shows the refused `on` while the recovery read runs.
  await act(async () => {
    await result.current.setEnabled(false);
    failRead?.();
    await first;
  });

  assert.equal(result.current.enabled, false);
});

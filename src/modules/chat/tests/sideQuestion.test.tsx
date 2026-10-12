import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import '@/modules/i18n';
import { api } from '@/shared/api';
import { useSideQuestion } from '@/modules/chat/hooks/useSideQuestion';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { SideQuestionPanel } from '@/modules/chat/SideQuestionPanel';

const reply = (response: string) => new Response(JSON.stringify({ success: true, data: { response, synthetic: false } }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

test('side questions call the dedicated API with only their own earlier exchanges', async () => {
  const send = vi.spyOn(api, 'askSideQuestion').mockResolvedValueOnce(reply('First answer')).mockResolvedValueOnce(reply('Second answer'));
  const { result } = renderHook(() => useSideQuestion('session-a'));
  act(() => { result.current.ask('First question'); });
  await waitFor(() => expect(result.current.pending).toBe(false));
  act(() => { result.current.ask('Follow up'); });
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(send.mock.calls[0]?.slice(0, 2)).toEqual(['session-a', { question: 'First question', history: [] }]);
  expect(send.mock.calls[1]?.[1]).toEqual({ question: 'Follow up', history: [{ question: 'First question', response: 'First answer' }] });
  act(() => result.current.close());
  expect(result.current.exchanges).toHaveLength(2);
  act(() => result.current.ask());
  expect(send).toHaveBeenCalledTimes(2);
});

test('session changes cancel the old request and discard a late answer', async () => {
  let resolve!: (response: Response) => void;
  const send = vi.spyOn(api, 'askSideQuestion').mockImplementation(() => new Promise((r) => { resolve = r; }));
  const { result, rerender } = renderHook(({ sessionId }) => useSideQuestion(sessionId), { initialProps: { sessionId: 'a' } });
  act(() => { result.current.ask('Old question'); });
  const signal = send.mock.calls[0]![2];
  rerender({ sessionId: 'b' });
  expect(signal.aborted).toBe(true);
  await act(async () => { resolve(reply('Old answer')); });
  expect(result.current.exchanges).toEqual([]);
  expect(result.current.open).toBe(false);
});

test('panel submission, clearing and closing stay independent of the main composer', async () => {
  vi.spyOn(api, 'askSideQuestion').mockResolvedValue(reply('A native answer'));
  function Panel() { const side = useSideQuestion('a'); return <SideQuestionPanel side={side} />; }
  render(<Panel />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Explain this' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send side question' }));
  await screen.findByText('A native answer');
  fireEvent.click(screen.getByRole('button', { name: 'Clear side questions' }));
  expect(screen.queryByText('A native answer')).toBeNull();
});

test('/btw bypasses the busy main-turn queue and sends no ordinary chat message', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } })));
  const sendMessage = vi.fn();
  const onSideQuestion = vi.fn(() => true);
  const composerOptions: Parameters<typeof useChatComposerState>[0] = {
    selectedProject: { projectId: 'p', displayName: 'P', fullPath: '/tmp/project' },
    selectedSession: { id: 'a' }, currentSessionId: 'a', provider: 'claude', permissionMode: 'default',
    cyclePermissionMode() {}, resolvePermissionModeForProvider: () => 'default', currentProviderModel: 'opus',
    currentProviderEffort: 'high', isLoading: true, canAbortSession: true, tokenBudget: null, sendMessage,
    scrollToBottom() {}, addMessage() {}, setIsUserScrolledUp() {}, setPendingPermissionRequests() {}, onSideQuestion,
  };
  const { result } = renderHook(() => useChatComposerState(composerOptions));
  act(() => result.current.setInput('/btw Why that approach?'));
  await act(async () => { await result.current.handleSubmit({ preventDefault() {} } as never); });
  expect(onSideQuestion).toHaveBeenCalledWith('Why that approach?');
  expect(sendMessage).not.toHaveBeenCalled();
  expect(result.current.queuedDraft).toBeNull();
  expect(result.current.input).toBe('');
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import type { NormalizedMessage } from '@/shared/types';
import { useLatestUserPrompt } from '@/modules/chat/hooks/useLatestUserPrompt';
import { api } from '@/shared/api';

/**
 * A long agent turn can leave the loaded tail page with no user row at all,
 * even though the prompt that started the turn is only a page or two back.
 * These cases pin the walk that finds it: where it starts, when it moves on,
 * and the rows it must never mistake for something the person typed.
 */

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionMessages: vi.fn(),
    },
  },
}));

const sessionMessages = vi.mocked(api.providers.sessionMessages);

const row = (overrides: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  id: `row-${Math.random().toString(36).slice(2)}`,
  sessionId: 'session-1',
  timestamp: '2026-11-26T10:00:00.000Z',
  provider: 'claude',
  kind: 'text',
  role: 'user',
  content: '一条提问',
  ...overrides,
});

const assistantRow = (overrides: Partial<NormalizedMessage> = {}): NormalizedMessage =>
  row({ role: 'assistant', content: '回复', ...overrides });

const page = (messages: NormalizedMessage[], hasMore: boolean) => Promise.resolve({
  ok: true,
  json: async () => ({ success: true, data: { messages, hasMore } }),
} as Response);

const props = {
  sessionId: 'session-1',
  isActive: true,
  hasLoadedUserPrompt: false,
  totalMessages: 396,
};

afterEach(() => {
  sessionMessages.mockReset();
});

describe('the latest user prompt peek', () => {
  it('does not read the transcript when the loaded page already holds a prompt', () => {
    const { result } = renderHook(() => useLatestUserPrompt({
      ...props,
      hasLoadedUserPrompt: true,
    }));

    expect(result.current).toBeNull();
    expect(sessionMessages).not.toHaveBeenCalled();
  });

  it('reads the newest page from the server and returns its newest prompt', async () => {
    sessionMessages.mockReturnValueOnce(page([
      assistantRow(),
      row({ content: '这一轮开始时的提问' }),
      assistantRow(),
      row({ content: '中间又补了一句' }),
    ], true));

    const { result } = renderHook(() => useLatestUserPrompt(props));

    await waitFor(() => expect(result.current?.content).toBe('中间又补了一句'));
    // From the server's own tail, not from the client's row count: live rows
    // can leave gaps, and skipping by that count would step over the prompt.
    expect(sessionMessages).toHaveBeenCalledWith('session-1', { limit: 100, offset: 0 });
    const prompt = result.current;
    expect(prompt?.type).toBe('user');
    expect(sessionMessages).toHaveBeenCalledTimes(1);
  });

  it('walks further back while a page holds no prompt', async () => {
    sessionMessages
      .mockReturnValueOnce(page(Array.from({ length: 100 }, () => assistantRow()), true))
      .mockReturnValueOnce(page([row({ content: '更早之前说的话' })], false));

    const { result } = renderHook(() => useLatestUserPrompt(props));

    await waitFor(() => expect(result.current?.content).toBe('更早之前说的话'));
    expect(sessionMessages).toHaveBeenNthCalledWith(1, 'session-1', { limit: 100, offset: 0 });
    expect(sessionMessages).toHaveBeenNthCalledWith(2, 'session-1', { limit: 100, offset: 100 });
  });

  it('never mistakes tool output, a cleared-context marker, or a continued-session summary for a prompt', async () => {
    sessionMessages.mockReturnValueOnce(page([
      row({ kind: 'tool_result', role: 'user', content: '工具输出' }),
      row({ content: '清空标记', contextCleared: true }),
      row({ content: '压缩摘要', isCompactSummary: true }),
      row({ content: 'This session is being continued from a previous conversation that ran out of context.' }),
      row({ content: '/compact', isLocalCommand: true }),
      row({ content: '   ' }),
      assistantRow(),
    ], false));

    const { result } = renderHook(() => useLatestUserPrompt(props));

    await waitFor(() => expect(sessionMessages).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });

  it('names an attachment-only turn', async () => {
    sessionMessages.mockReturnValueOnce(page([
      row({ content: '', files: [{ name: 'spec.pdf' }] }),
    ], false));

    const { result } = renderHook(() => useLatestUserPrompt(props));

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.content).toBe('');
    expect(result.current?.files).toEqual([{ name: 'spec.pdf' }]);
  });

  it('stays quiet when the request fails or no prompt exists at all', async () => {
    sessionMessages.mockReturnValueOnce(Promise.resolve({ ok: false } as Response));
    const failed = renderHook(() => useLatestUserPrompt(props));
    await waitFor(() => expect(sessionMessages).toHaveBeenCalledTimes(1));
    expect(failed.result.current).toBeNull();
    failed.unmount();

    sessionMessages.mockReset();
    sessionMessages.mockReturnValueOnce(page([], false));
    const empty = renderHook(() => useLatestUserPrompt(props));
    await waitFor(() => expect(sessionMessages).toHaveBeenCalledTimes(1));
    expect(empty.result.current).toBeNull();
  });

  it('reads the transcript once per session, not once per streamed row', async () => {
    sessionMessages.mockReturnValueOnce(page([row({ content: '唯一一条提问' })], true));

    const { result, rerender } = renderHook(
      (nextProps) => useLatestUserPrompt(nextProps),
      { initialProps: props },
    );
    await waitFor(() => expect(result.current?.content).toBe('唯一一条提问'));

    rerender({ ...props, totalMessages: 397 });
    rerender({ ...props, totalMessages: 403 });
    expect(sessionMessages).toHaveBeenCalledTimes(1);
    expect(result.current?.content).toBe('唯一一条提问');
  });
});

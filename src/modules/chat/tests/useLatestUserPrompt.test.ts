import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

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

const page = (messages: NormalizedMessage[], hasMore: boolean, total?: number) => Promise.resolve({
  ok: true,
  json: async () => ({ success: true, data: { messages, hasMore, ...(total !== undefined ? { total } : {}) } }),
} as Response);

const props = {
  sessionId: 'session-1',
  isActive: true,
  hasLoadedUserPrompt: false,
  beforeTimestamp: '2026-11-26T11:00:00.000Z',
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
    expect(sessionMessages).toHaveBeenCalledWith('session-1', { limit: 100, offset: 0 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
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
    expect(sessionMessages).toHaveBeenNthCalledWith(1, 'session-1', { limit: 100, offset: 0 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(sessionMessages).toHaveBeenNthCalledWith(2, 'session-1', { limit: 100, offset: 100 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
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

  it('跳过当前阅读位置之后的提问，继续回读旧页', async () => {
    sessionMessages
      .mockReturnValueOnce(page([row({ timestamp: '2026-11-26T12:00:00.000Z', content: '下一轮提问' })], true))
      .mockReturnValueOnce(page([row({ content: '当前阅读轮次的提问' })], false));
    const { result } = renderHook(() => useLatestUserPrompt(props));
    await waitFor(() => expect(result.current?.content).toBe('当前阅读轮次的提问'));
    expect(sessionMessages).toHaveBeenCalledTimes(2);
  });

  it('阅读位置越过缓存提问向前滚动时，立即隐藏旧结果并重新查找', async () => {
    sessionMessages.mockReturnValueOnce(page([row({ content: '较新提问' })], true));
    const { result, rerender } = renderHook((next) => useLatestUserPrompt(next), { initialProps: props });
    await waitFor(() => expect(result.current?.content).toBe('较新提问'));
    sessionMessages.mockReturnValueOnce(page([row({ timestamp: '2026-11-26T08:00:00.000Z', content: '更早提问' })], false));
    rerender({ ...props, beforeTimestamp: '2026-11-26T09:00:00.000Z' });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.content).toBe('更早提问'));
  });

  it('标签隐藏取消请求后，重新激活仍会查找，且迟到结果不能覆盖', async () => {
    let finish: (response: Response) => void = () => {};
    sessionMessages.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook((next) => useLatestUserPrompt(next), { initialProps: props });
    rerender({ ...props, isActive: false });
    expect(sessionMessages.mock.calls[0][2]?.signal?.aborted).toBe(true);
    sessionMessages.mockReturnValueOnce(page([row({ content: '恢复后找到的提问' })], false));
    rerender(props);
    await waitFor(() => expect(result.current?.content).toBe('恢复后找到的提问'));
    await act(async () => finish(await page([row({ content: '过期请求' })], false)));
    expect(result.current?.content).toBe('恢复后找到的提问');
  });

  it('长回复超过五页时仍能找到原提问', async () => {
    for (let index = 0; index < 6; index += 1) sessionMessages.mockReturnValueOnce(page([assistantRow()], true));
    sessionMessages.mockReturnValueOnce(page([row({ content: '长回复之前的提问' })], false));
    const { result } = renderHook(() => useLatestUserPrompt(props));
    await waitFor(() => expect(result.current?.content).toBe('长回复之前的提问'));
    expect(sessionMessages).toHaveBeenCalledTimes(7);
  });

  it('同一轮向下阅读复用已查页，不隐藏提问或重复请求', async () => {
    sessionMessages.mockReturnValueOnce(page([row({ content: '本轮提问' }), assistantRow()], true));
    const { result, rerender } = renderHook((next) => useLatestUserPrompt(next), { initialProps: props });
    await waitFor(() => expect(result.current?.content).toBe('本轮提问'));
    rerender({ ...props, beforeTimestamp: '2026-11-26T11:30:00.000Z' });
    expect(result.current?.content).toBe('本轮提问');
    expect(sessionMessages).toHaveBeenCalledTimes(1);
  });

  it('跨页查询按消息标识划定同时间戳边界，不选后面的用户消息', async () => {
    sessionMessages.mockReturnValueOnce(page([
      row({ id: 'u1', content: '当前轮次' }),
      assistantRow({ id: 'a1' }),
      row({ id: 'u2', content: '后续轮次' }),
    ], false));
    const { result } = renderHook(() => useLatestUserPrompt({ ...props, beforeTimestamp: '2026-11-26T10:00:00.000Z', beforeMessageId: 'a1' }));
    await waitFor(() => expect(result.current?.content).toBe('当前轮次'));
    expect(result.current?.sourceMessageId).toBe('u1');
  });

  it('Codex 每次读取重新生成 id 时仍按原始字段找到同时间的阅读边界', async () => {
    const boundary = assistantRow({ id: 'old-a', provider: 'codex' });
    sessionMessages.mockReturnValueOnce(page([
      row({ id: 'new-u', provider: 'codex', content: '当前轮次' }),
      { ...boundary, id: 'new-a' },
      row({ id: 'next-u', provider: 'codex', content: '同时间的下一轮' }),
    ], false));
    const { result } = renderHook(() => useLatestUserPrompt({ ...props, beforeMessage: boundary,
      beforeMessageId: boundary.id, beforeTimestamp: boundary.timestamp }));
    await waitFor(() => expect(result.current?.content).toBe('当前轮次'));
    expect(result.current?.sourceMessage?.provider).toBe('codex');
  });

  it('离开后会话新增一轮，返回新阅读位置时先刷新旧缓存', async () => {
    sessionMessages.mockReturnValueOnce(page([row({ content: '上一轮缓存' })], false));
    const { result, rerender } = renderHook((next) => useLatestUserPrompt(next), { initialProps: props });
    await waitFor(() => expect(result.current?.content).toBe('上一轮缓存'));
    rerender({ ...props, sessionId: 'session-2', hasLoadedUserPrompt: true });
    sessionMessages.mockReturnValueOnce(page([row({ timestamp: '2026-11-26T12:00:00.000Z', content: '后台新一轮提问' })], false));
    rerender({ ...props, totalMessages: 700, beforeTimestamp: '2026-11-26T13:00:00.000Z' });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.content).toBe('后台新一轮提问'));
    expect(sessionMessages).toHaveBeenCalledTimes(2);
  });

  it('后台任务完成通知不当作提问显示', async () => {
    // 这类行由 harness 以 user 角色写入，转成聊天记录时会画成助手通知；
    // 固定条若照搬原始行，就会把整段 XML 当成用户提问。
    sessionMessages.mockReturnValueOnce(page([
      row({ id: 'u1', content: '真正的问题' }),
      assistantRow({ id: 'a1' }),
      row({ id: 'n1', content: '<task-notification>\n<status>completed</status>\n<summary>Background task finished</summary>\n</task-notification>' }),
    ], false));

    const { result } = renderHook(() => useLatestUserPrompt(props));

    await waitFor(() => expect(result.current?.content).toBe('真正的问题'));
    expect(result.current?.sourceMessageId).toBe('u1');
  });

  it('边界行在历史里时只从该行往回找，不被更早时间戳的后续行带偏', async () => {
    // Codex 回退会让后写入的行带更早的时间戳：按时间戳提前放行，
    // 会选中边界之后那一轮的提问。
    sessionMessages.mockReturnValueOnce(page([
      row({ id: 'u1', content: '当前轮次', timestamp: '2026-11-26T10:00:00.000Z' }),
      assistantRow({ id: 'a1', timestamp: '2026-11-26T11:00:00.000Z' }),
      row({ id: 'u2', content: '回退后的下一轮', timestamp: '2026-11-26T09:00:00.000Z' }),
    ], false));

    const { result } = renderHook(() => useLatestUserPrompt({
      ...props,
      beforeTimestamp: '2026-11-26T11:00:00.000Z',
      beforeMessageId: 'a1',
    }));

    await waitFor(() => expect(result.current?.content).toBe('当前轮次'));
    expect(result.current?.sourceMessageId).toBe('u1');
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

    rerender({ ...props });
    rerender({ ...props });
    expect(sessionMessages).toHaveBeenCalledTimes(1);
    expect(result.current?.content).toBe('唯一一条提问');
  });

  it('运行中尾部新增消息导致 total 增长且与已查页重叠时，直接拼接不重置偏移', async () => {
    const a1 = assistantRow({ id: 'a1', timestamp: '2026-11-26T10:00:01.000Z', content: '回复1' });
    const a2 = assistantRow({ id: 'a2', timestamp: '2026-11-26T10:00:02.000Z', content: '回复2' });
    const a3 = assistantRow({ id: 'a3', timestamp: '2026-11-26T10:00:03.000Z', content: '回复3' });
    const u0 = row({ id: 'u0', timestamp: '2026-11-26T09:59:59.000Z', content: '长轮次原提问' });
    const a0 = assistantRow({ id: 'a0', timestamp: '2026-11-26T10:00:00.000Z', content: '回复0' });

    sessionMessages
      .mockReturnValueOnce(page([a1, a2, a3], true, 50))
      .mockReturnValueOnce(page([u0, a0, a1], false, 51));

    const { result } = renderHook(() => useLatestUserPrompt({
      ...props,
      beforeMessageId: 'a3',
      totalMessages: 50,
    }));

    await waitFor(() => expect(result.current?.content).toBe('长轮次原提问'));
    expect(sessionMessages).toHaveBeenCalledTimes(2);
    expect(sessionMessages).toHaveBeenNthCalledWith(1, 'session-1', { limit: 100, offset: 0 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(sessionMessages).toHaveBeenNthCalledWith(2, 'session-1', { limit: 100, offset: 3 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('边界行仍在缓存内而 totalMessages 增长时，沿当前偏移续查并拼接', async () => {
    const a1 = assistantRow({ id: 'a1', timestamp: '2026-11-26T10:00:01.000Z', content: '回复1' });
    const boundary = assistantRow({ id: 'boundary', timestamp: '2026-11-26T10:00:02.000Z', content: '边界回复' });
    const u0 = row({ id: 'u0', timestamp: '2026-11-26T09:59:59.000Z', content: '边界外原提问' });

    sessionMessages
      .mockReturnValueOnce(page([a1, boundary], true, 50))
      .mockReturnValueOnce(page([u0, a1], false, 52));

    const { result, rerender } = renderHook(
      (nextProps) => useLatestUserPrompt(nextProps),
      {
        initialProps: {
          ...props,
          beforeMessageId: 'boundary',
          totalMessages: 50,
        },
      },
    );

    await waitFor(() => expect(sessionMessages).toHaveBeenCalledTimes(1));
    rerender({
      ...props,
      beforeMessageId: 'boundary',
      totalMessages: 52,
    });

    await waitFor(() => expect(result.current?.content).toBe('边界外原提问'));
    expect(sessionMessages).toHaveBeenCalledTimes(2);
    expect(sessionMessages).toHaveBeenNthCalledWith(2, 'session-1', { limit: 100, offset: 2 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('尾部一次性增长过多导致新旧页无重叠时，重置并从最新页重新对齐', async () => {
    const a1 = assistantRow({ id: 'a1', timestamp: '2026-11-26T10:00:01.000Z', content: '回复1' });
    const a2 = assistantRow({ id: 'a2', timestamp: '2026-11-26T10:00:02.000Z', content: '回复2' });
    const a10 = assistantRow({ id: 'a10', timestamp: '2026-11-26T10:00:10.000Z', content: '回复10' });
    const a11 = assistantRow({ id: 'a11', timestamp: '2026-11-26T10:00:11.000Z', content: '回复11' });
    const u0 = row({ id: 'u0', timestamp: '2026-11-26T09:59:59.000Z', content: '重对齐后的提问' });
    const a20 = assistantRow({ id: 'a20', timestamp: '2026-11-26T10:00:20.000Z', content: '回复20' });

    sessionMessages
      .mockReturnValueOnce(page([a1, a2], true, 50))
      .mockReturnValueOnce(page([a10, a11], true, 200))
      .mockReturnValueOnce(page([u0, a20], false, 200));

    const { result } = renderHook(() => useLatestUserPrompt({
      ...props,
      beforeMessageId: 'a2',
      totalMessages: 50,
    }));

    await waitFor(() => expect(result.current?.content).toBe('重对齐后的提问'));
    expect(sessionMessages).toHaveBeenCalledTimes(3);
    expect(sessionMessages).toHaveBeenNthCalledWith(3, 'session-1', { limit: 100, offset: 0 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('历史回退导致 total 变小时，重置并从最新页重新对齐', async () => {
    const a1 = assistantRow({ id: 'a1', timestamp: '2026-11-26T10:00:01.000Z', content: '回复1' });
    const a2 = assistantRow({ id: 'a2', timestamp: '2026-11-26T10:00:02.000Z', content: '回复2' });
    const a0 = assistantRow({ id: 'a0', timestamp: '2026-11-26T10:00:00.000Z', content: '回复0' });
    const uRewound = row({ id: 'u-rewound', timestamp: '2026-11-26T09:59:50.000Z', content: '回退后的提问' });
    const aRewound = assistantRow({ id: 'a-rewound', timestamp: '2026-11-26T09:59:55.000Z', content: '回退后的回复' });

    sessionMessages
      .mockReturnValueOnce(page([a1, a2], true, 50))
      .mockReturnValueOnce(page([a0, a1], true, 45))
      .mockReturnValueOnce(page([uRewound, aRewound], false, 45));

    const { result } = renderHook(() => useLatestUserPrompt({
      ...props,
      beforeMessageId: 'a2',
      totalMessages: 50,
    }));

    await waitFor(() => expect(result.current?.content).toBe('回退后的提问'));
    expect(sessionMessages).toHaveBeenCalledTimes(3);
    expect(sessionMessages).toHaveBeenNthCalledWith(3, 'session-1', { limit: 100, offset: 0 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('连续多页回读期间尾部持续增长时，保持偏移递进并逐页重叠拼接', async () => {
    const a4 = assistantRow({ id: 'a4', timestamp: '2026-11-26T10:00:04.000Z', content: '回复4' });
    const a5 = assistantRow({ id: 'a5', timestamp: '2026-11-26T10:00:05.000Z', content: '回复5' });
    const a6 = assistantRow({ id: 'a6', timestamp: '2026-11-26T10:00:06.000Z', content: '回复6' });
    const a2 = assistantRow({ id: 'a2', timestamp: '2026-11-26T10:00:02.000Z', content: '回复2' });
    const a3 = assistantRow({ id: 'a3', timestamp: '2026-11-26T10:00:03.000Z', content: '回复3' });
    const u0 = row({ id: 'u0', timestamp: '2026-11-26T09:59:59.000Z', content: '三页外的原提问' });
    const a1 = assistantRow({ id: 'a1', timestamp: '2026-11-26T10:00:01.000Z', content: '回复1' });

    sessionMessages
      .mockReturnValueOnce(page([a4, a5, a6], true, 50))
      .mockReturnValueOnce(page([a2, a3, a4], true, 51))
      .mockReturnValueOnce(page([u0, a1, a2], false, 53));

    const { result } = renderHook(() => useLatestUserPrompt({
      ...props,
      beforeMessageId: 'a6',
      totalMessages: 50,
    }));

    await waitFor(() => expect(result.current?.content).toBe('三页外的原提问'));
    expect(sessionMessages).toHaveBeenCalledTimes(3);
    expect(sessionMessages).toHaveBeenNthCalledWith(1, 'session-1', { limit: 100, offset: 0 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(sessionMessages).toHaveBeenNthCalledWith(2, 'session-1', { limit: 100, offset: 3 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(sessionMessages).toHaveBeenNthCalledWith(3, 'session-1', { limit: 100, offset: 6 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
});

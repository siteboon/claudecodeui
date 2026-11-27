import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { ChatMessage, NormalizedMessage } from '@/shared/types';
import { isUserPromptMessage } from '@/shared/utils';
import { messagesRepresentSamePersistedRow } from '@/modules/chat/utils/sessionMessagePagination';

/** 回读保留分页，读取结果只用于固定条，不扩大会话的渲染窗口。 */
const PEEK_PAGE_SIZE = 100;

function toChatMessage(message: NormalizedMessage): ChatMessage {
  return {
    type: 'user',
    content: message.content ?? '',
    sourceMessageId: message.id,
    sourceMessage: message,
    transcriptAnchorId: message.transcriptAnchorId,
    timestamp: message.timestamp,
    images: message.images,
    files: message.files,
    isCompactSummary: message.isCompactSummary,
    isLocalCommand: message.isLocalCommand,
  };
}

/** 按原始记录的顺序定位边界；同时间戳的后续用户提问不属于当前轮次。 */
function findPrompt(rows: NormalizedMessage[], beforeTime: number, beforeMessageId?: string, beforeMessage?: NormalizedMessage): ChatMessage | null {
  // 尚未写入历史的实时行只能采用严格更早的历史，不能把同时间的后续行算进去。
  let reached = !beforeMessageId || (rows.length > 0 && new Date(rows[rows.length - 1].timestamp).getTime() < beforeTime);
  const hasExactId = Boolean(beforeMessageId && rows.some((row) => row.id === beforeMessageId));
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.id === beforeMessageId || (!hasExactId && beforeMessage?.provider === 'codex' && messagesRepresentSamePersistedRow(row, beforeMessage))) reached = true;
    if (!reached || row.kind !== 'text' || row.role !== 'user' || row.contextCleared) continue;
    if (!beforeMessageId && !(new Date(row.timestamp).getTime() <= beforeTime)) continue;
    const prompt = toChatMessage(row);
    const hasPayload = Boolean(prompt.content?.trim() || prompt.images?.length || prompt.files?.length);
    if (hasPayload && isUserPromptMessage(prompt)) return prompt;
  }
  return null;
}

type UseLatestUserPromptArgs = {
  sessionId: string | null;
  isActive: boolean;
  hasLoadedUserPrompt: boolean;
  beforeTimestamp: string | null;
  beforeMessageId?: string;
  beforeMessage?: NormalizedMessage;
  totalMessages: number;
};

type PromptPages = {
  sessionId: string;
  rows: NormalizedMessage[];
  offset: number;
  total: number;
  hasMore: boolean;
};

/** 供会话 Hook 查询当前阅读位置之前尚未加载的提问，同一轮内上下滚动复用已查页。 */
export function useLatestUserPrompt({
  sessionId,
  isActive,
  hasLoadedUserPrompt,
  beforeTimestamp,
  beforeMessageId,
  beforeMessage,
  totalMessages,
}: UseLatestUserPromptArgs): ChatMessage | null {
  // 保存已查过的连续历史页及其会话归属，滚动时只重新选择提问，不重复请求同一段。
  const [pages, setPages] = useState<PromptPages | null>(null);
  const beforeTime = beforeTimestamp ? new Date(beforeTimestamp).getTime() : NaN;
  const sameSession = pages?.sessionId === sessionId ? pages : null;
  const coversBoundary = sameSession?.rows.some((row) => row.id === beforeMessageId
    || (beforeMessage?.provider === 'codex' && messagesRepresentSamePersistedRow(row, beforeMessage)));
  const current = sameSession && (sameSession.total === totalMessages || coversBoundary) ? sameSession : null;
  const prompt = current && Number.isFinite(beforeTime) ? findPrompt(current.rows, beforeTime, beforeMessageId, beforeMessage) : null;
  const needsPage = !prompt && (!current || current.hasMore);

  useEffect(() => {
    if (!isActive || !sessionId || hasLoadedUserPrompt || totalMessages <= 0 || !Number.isFinite(beforeTime) || !needsPage) return undefined;
    const controller = new AbortController();
    // 继续向前查页时若总数变化，原来的尾部偏移已失效，从最新页重新对齐。
    const previous = current?.total === totalMessages ? current : null;
    const offset = previous?.offset ?? 0;
    const readPage = async () => {
      try {
        const response = await api.providers.sessionMessages(sessionId, { limit: PEEK_PAGE_SIZE, offset }, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json() as { data?: { messages?: NormalizedMessage[]; hasMore?: boolean; total?: number } };
        if (controller.signal.aborted) return;
        const rows = Array.isArray(payload.data?.messages) ? payload.data.messages : [];
        setPages({
          sessionId,
          rows: [...rows, ...(previous?.rows ?? [])],
          offset: offset + rows.length,
          total: totalMessages,
          hasMore: rows.length > 0 && Boolean(payload.data?.hasMore),
        });
      } catch {
        // 失败或取消不锁死查询，重新激活或改变阅读位置后可重试。
      }
    };
    void readPage();
    return () => controller.abort();
  }, [beforeMessage, beforeMessageId, beforeTime, current, hasLoadedUserPrompt, isActive, needsPage, sessionId, totalMessages]);

  return isActive && !hasLoadedUserPrompt ? prompt : null;
}

import { memo, useCallback, useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { History } from 'lucide-react';

import type { ChatMessage } from '@/shared/types';
import { isUserPromptMessage } from '@/shared/utils';

/** A row counts as scrolled past once its bottom clears the viewport top by this much, which keeps the bar from flickering at the boundary. */
const PAST_TOP_EDGE_TOLERANCE_PX = 4;

/** Preview text only ever needs a glance at its start; the row truncates whatever is left. */
const MAX_PREVIEW_CHARS = 400;

type PreviousUserMessageBarProps = {
  /** The transcript's scrolling container, whose viewport top decides which message counts as "above". */
  scrollContainerRef: RefObject<HTMLDivElement>;
  /** 已加载的会话消息；较早的用户提问可能不在当前渲染窗口。 */
  messages: ChatMessage[];
  /** 回读结果和查找时使用的边界，供阅读位置变化时核对。 */
  latestUserPrompt: ChatMessage | null;
  latestUserPromptBoundary?: { timestamp: string | null; messageId?: string };
  /** 把阅读边界交给会话 Hook，让跨页回读使用相同的位置。 */
  onViewportChange?: (timestamp: string | null, messageId?: string) => void;
  /**
   * Brings a row into view. Owned by the session state because the row may sit
   * outside the render window, so it takes more than an element lookup.
   */
  onReveal: (message: ChatMessage) => void;
};

type ViewportPrompt = {
  prompt: ChatMessage | null;
  timestamp: string | null;
  messageId?: string;
};

/** The bar's one line of plain text; an attachment-only turn is named instead. */
function readPreview(message: ChatMessage, attachmentsLabel: string): string {
  const text = String(message.content ?? '').replace(/\s+/g, ' ').trim();
  if (text) {
    return text.slice(0, MAX_PREVIEW_CHARS);
  }
  const attachments = (message.images?.length ?? 0) + (message.files?.length ?? 0);
  return attachments > 0 ? attachmentsLabel : '';
}

/** 先定位顶部首条可读消息，再按会话顺序往前找；提问自己的 DOM 可以已被裁掉。 */
function findPreviousUserPrompt(
  container: HTMLDivElement,
  messages: ChatMessage[],
): ViewportPrompt {
  const containerTop = container.getBoundingClientRect().top;
  const indicesById = new Map<string, number>();
  const indicesByTimestamp = new Map<string, number>();
  messages.forEach((message, index) => {
    const timestamp = String(message.timestamp);
    if (message.sourceMessageId && !indicesById.has(message.sourceMessageId)) indicesById.set(message.sourceMessageId, index);
    if (!indicesByTimestamp.has(timestamp)) indicesByTimestamp.set(timestamp, index);
  });

  let anchorIndex = -1;
  for (const row of container.querySelectorAll<HTMLElement>('[data-message-timestamp]')) {
    // 只跳过同一行的内层包装，不合并时间戳相同的不同消息。
    if (row.parentElement?.closest('[data-message-timestamp]')) continue;
    const timestamp = row.getAttribute('data-message-timestamp');
    if (!timestamp) continue;
    const messageId = row.getAttribute('data-message-id');
    const index = messageId ? indicesById.get(messageId) : indicesByTimestamp.get(timestamp);
    if (index === undefined) continue;
    anchorIndex = index;
    // 用户气泡只露出一部分也属于当前轮次，不能跳到后面的提问。
    if (row.getBoundingClientRect().bottom > containerTop + PAST_TOP_EDGE_TOLERANCE_PX) break;
  }

  const timestamp = anchorIndex < 0 ? null : String(messages[anchorIndex].timestamp);
  const messageId = anchorIndex < 0 ? undefined : messages[anchorIndex].sourceMessageId;
  for (let index = anchorIndex; index >= 0; index -= 1) {
    if (isUserPromptMessage(messages[index])) return { prompt: messages[index], timestamp, messageId };
  }
  return { prompt: null, timestamp, messageId };
}

/** 供 ChatInterface 固定显示当前阅读轮次的用户提问，点击可回到原消息。 */
export const PreviousUserMessageBar = memo(({
  scrollContainerRef,
  messages,
  latestUserPrompt,
  latestUserPromptBoundary,
  onViewportChange,
  onReveal,
}: PreviousUserMessageBarProps) => {
  const { t } = useTranslation('chat');
  // 滚动和懒渲染都会改变阅读边界，保留测量结果以更新固定条和跨页查询。
  const [viewport, setViewport] = useState<ViewportPrompt>({ prompt: null, timestamp: null });

  const measure = useCallback(() => {
    const container = scrollContainerRef.current;
    const next = container ? findPreviousUserPrompt(container, messages) : { prompt: null, timestamp: null };
    setViewport((previous) => previous.prompt === next.prompt && previous.timestamp === next.timestamp && previous.messageId === next.messageId ? previous : next);
    onViewportChange?.(next.timestamp, next.messageId);
  }, [messages, onViewportChange, scrollContainerRef]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    measure();
    if (!container) return undefined;

    let frame: number | null = null;
    const scheduleMeasure = () => {
      if (frame !== null) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };

    container.addEventListener('scroll', scheduleMeasure, { passive: true });
    // A sidebar or window resize moves rows past the top edge with no scroll
    // event, and so does a lazy row settling into its measured height (that
    // scroll adjustment is the browser's, not the user's). The pane's last
    // child is the transcript list itself, whose height changes with both.
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(container);
    const list = container.lastElementChild;
    if (list) {
      resizeObserver?.observe(list);
    }

    return () => {
      container.removeEventListener('scroll', scheduleMeasure);
      resizeObserver?.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [measure, scrollContainerRef]);

  // 消息顺序可能与时间戳不同。只接受为当前阅读边界查到的结果。
  const fallback = viewport.timestamp && latestUserPromptBoundary?.timestamp === viewport.timestamp
    && latestUserPromptBoundary.messageId === viewport.messageId ? latestUserPrompt : null;
  const prompt = viewport.prompt ?? fallback;
  if (!prompt) {
    return null;
  }

  const preview = readPreview(prompt, t('previousMessage.attachmentsOnly'));
  const jumpLabel = t('previousMessage.jump');

  return (
    <div className="flex flex-shrink-0 justify-center px-4 pt-2">
      <button
        type="button"
        onClick={() => onReveal(prompt)}
        title={jumpLabel}
        className="chat-content-width flex w-full min-w-0 items-center gap-2 rounded-r-md border-l-2 border-blue-500/60 bg-muted/25 px-3 py-1.5 text-left transition-colors hover:bg-muted/40 dark:bg-muted/10 dark:hover:bg-muted/20"
      >
        <History className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-blue-600 text-[10px] font-medium text-white">
          U
        </span>
        <span className="flex-shrink-0 text-xs font-medium text-foreground">
          {t('previousMessage.label')}
        </span>
        <span className="flex-shrink-0 text-[10px] text-muted-foreground/40">/</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground" dir="auto">
          {preview}
        </span>
      </button>
    </div>
  );
});
PreviousUserMessageBar.displayName = 'PreviousUserMessageBar';

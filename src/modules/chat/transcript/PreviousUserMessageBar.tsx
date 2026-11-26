import { memo, useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp } from 'lucide-react';

import type { ChatMessage } from '@/shared/types';

/** A row counts as scrolled past once its bottom clears the viewport top by this much, which keeps the bar from flickering at the boundary. */
const PAST_TOP_EDGE_TOLERANCE_PX = 4;

/** Preview text only ever needs a glance at its start; the row truncates whatever is left. */
const MAX_PREVIEW_CHARS = 400;

type PreviousUserMessageBarProps = {
  /** The transcript's scrolling container, whose viewport top decides which message counts as "above". */
  scrollContainerRef: RefObject<HTMLDivElement>;
  /** Every loaded row of the session, in transcript order; only rows currently in the DOM can be scrolled past. */
  messages: ChatMessage[];
  /**
   * Brings a row into view. Owned by the session state because the row may sit
   * outside the render window, so it takes more than an element lookup.
   */
  onReveal: (message: ChatMessage) => void;
};

/** A turn the user actually sent — not a tool call echo or a side-question aside. */
function isUserPrompt(message: ChatMessage): boolean {
  return message.type === 'user' && !message.sideQuestion;
}

/** The bar's one line of plain text; an attachment-only turn is named instead. */
function readPreview(message: ChatMessage, attachmentsLabel: string): string {
  const text = String(message.content ?? '').replace(/\s+/g, ' ').trim();
  if (text) {
    return text.slice(0, MAX_PREVIEW_CHARS);
  }
  const attachments = (message.images?.length ?? 0) + (message.files?.length ?? 0);
  return attachments > 0 ? attachmentsLabel : '';
}

/**
 * The newest user turn whose row has scrolled completely above the container's
 * top edge — the prompt the reader is currently inside. Returns null while that
 * prompt is still on screen, which is what keeps the bar out of the way when
 * there is nothing to jump back to.
 */
function findPreviousUserPrompt(
  container: HTMLDivElement,
  messages: ChatMessage[],
): ChatMessage | null {
  const containerTop = container.getBoundingClientRect().top;
  const rowsByTimestamp = new Map<string, HTMLElement>();
  for (const row of container.querySelectorAll<HTMLElement>('[data-message-timestamp]')) {
    const timestamp = row.getAttribute('data-message-timestamp');
    // A row that shares its timestamp with an earlier one (a user turn and the
    // tool row stamped with it) keeps the first occurrence, which is the turn.
    if (timestamp && !rowsByTimestamp.has(timestamp)) {
      rowsByTimestamp.set(timestamp, row);
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isUserPrompt(message)) {
      continue;
    }
    const row = rowsByTimestamp.get(String(message.timestamp));
    if (!row) {
      continue;
    }
    if (row.getBoundingClientRect().bottom <= containerTop + PAST_TOP_EDGE_TOLERANCE_PX) {
      return message;
    }
  }

  return null;
}

/**
 * Rendered by chat's ChatInterface above ChatMessagesPane: one pinned line
 * naming the user message whose turn is above the viewport, which clicking
 * scrolls back to. Repeated clicks walk up the conversation one prompt at a
 * time instead of scrolling and hunting for where a turn started.
 */
export const PreviousUserMessageBar = memo(({
  scrollContainerRef,
  messages,
  onReveal,
}: PreviousUserMessageBarProps) => {
  const { t } = useTranslation('chat');
  // The prompt currently scrolled past; kept as state because the bar renders from it and must follow the viewport.
  const [previousPrompt, setPreviousPrompt] = useState<ChatMessage | null>(null);

  const measure = useCallback(() => {
    const container = scrollContainerRef.current;
    setPreviousPrompt(container ? findPreviousUserPrompt(container, messages) : null);
  }, [messages, scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      setPreviousPrompt(null);
      return undefined;
    }

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

    // Compute once for the rows already on screen, then follow scroll frames.
    measure();
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

  if (!previousPrompt) {
    return null;
  }

  const preview = readPreview(previousPrompt, t('previousMessage.attachmentsOnly'));
  const jumpLabel = t('previousMessage.jump');

  return (
    <div className="flex flex-shrink-0 justify-center px-4 pt-2">
      <button
        type="button"
        onClick={() => onReveal(previousPrompt)}
        title={jumpLabel}
        className="chat-content-width flex w-full min-w-0 items-center gap-2 rounded-r-md border-l-2 border-blue-500/60 bg-muted/25 px-3 py-1.5 text-left transition-colors hover:bg-muted/40 dark:bg-muted/10 dark:hover:bg-muted/20"
      >
        <ArrowUp className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden />
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

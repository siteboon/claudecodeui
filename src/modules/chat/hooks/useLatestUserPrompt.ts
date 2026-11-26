import { useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { ChatMessage, NormalizedMessage } from '@/shared/types';
import { isUserPromptMessage } from '@/shared/utils';

/** How many transcript rows one peek asks for; a long turn is usually crossed in one or two. */
const PEEK_PAGE_SIZE = 100;

/** Walking further back than this is not worth a request: the bar shows nothing instead of a wrong turn. */
const MAX_PEEK_PAGES = 5;

/** A turn has to carry something the bar can name, or an attachment-only turn to name instead. */
function hasPromptPayload(message: NormalizedMessage): boolean {
  return Boolean(String(message.content ?? '').trim())
    || (message.images?.length ?? 0) > 0
    || (message.files?.length ?? 0) > 0;
}

/** The bar only renders text and attachment counts, so the raw row is reduced to just those. */
function toChatMessage(message: NormalizedMessage): ChatMessage {
  return {
    type: 'user',
    content: message.content ?? '',
    timestamp: message.timestamp,
    images: message.images,
    files: message.files,
    isCompactSummary: message.isCompactSummary,
    isLocalCommand: message.isLocalCommand,
  };
}

/** The newest prompt on one page of transcript rows, or null when the page holds none. */
function findNewestPromptRow(messages: NormalizedMessage[]): NormalizedMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.kind !== 'text'
      || message.role !== 'user'
      || message.contextCleared
      || !hasPromptPayload(message)
    ) {
      continue;
    }
    // One rule for both sources: a row the loaded transcript would not name is
    // not named here either — tool output labelled as a user turn and the
    // summary that opens a continued session both fail it.
    if (isUserPromptMessage(toChatMessage(message))) {
      return message;
    }
  }

  return null;
}

type UseLatestUserPromptArgs = {
  /** Session whose transcript is read; null when no session is open. */
  sessionId: string | null;
  /** A hidden chat tab does not spend a request on something nobody can see. */
  isActive: boolean;
  /** True once the loaded page holds a prompt, which makes the peek unnecessary. */
  hasLoadedUserPrompt: boolean;
  /** The server's row count for the tail-paged transcript, which bounds the walk. */
  totalMessages: number;
};

/**
 * Reads the newest user prompt straight from the transcript when the loaded
 * page does not contain one. A long agent turn — hundreds of tool rows after
 * the prompt that started it — pushes that prompt past the first page, leaving
 * the bar with nothing to name even though the turn is right there on screen.
 *
 * Pagination counts from the end, so this walks backwards one page at a time
 * until a prompt turns up. Attachment-only turns come back through the same
 * shape the transcript uses, so the bar can name them without special casing.
 */
export function useLatestUserPrompt({
  sessionId,
  isActive,
  hasLoadedUserPrompt,
  totalMessages,
}: UseLatestUserPromptArgs): ChatMessage | null {
  // The prompt found in the transcript away from the loaded page, held with the
  // session it belongs to so a session switch can never show the previous
  // conversation's prompt while the new page is still loading.
  const [peeked, setPeeked] = useState<{ sessionId: string; prompt: ChatMessage } | null>(null);
  // The session already peeked for. Streamed rows re-render this hook on every
  // chunk, and the transcript behind them has not changed.
  const peekedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isActive || !sessionId || hasLoadedUserPrompt || totalMessages <= 0) {
      return undefined;
    }
    if (peekedSessionRef.current === sessionId) {
      return undefined;
    }
    peekedSessionRef.current = sessionId;

    let cancelled = false;
    const peek = async () => {
      // Always from the newest page, even though the client already holds one:
      // live rows can leave gaps in that page, so only the server's own paging
      // tells the walk where the transcript really ends.
      let offset = 0;

      for (let page = 0; page < MAX_PEEK_PAGES && offset < totalMessages; page += 1) {
        try {
          const response = await api.providers.sessionMessages(sessionId, {
            limit: PEEK_PAGE_SIZE,
            offset,
          });
          if (!response.ok) {
            return;
          }
          const payload = await response.json() as {
            data?: { messages?: NormalizedMessage[]; hasMore?: boolean };
          };
          if (cancelled) {
            return;
          }

          const rows = Array.isArray(payload.data?.messages) ? payload.data.messages : [];
          const found = findNewestPromptRow(rows);
          if (found) {
            setPeeked({ sessionId, prompt: toChatMessage(found) });
            return;
          }
          if (!payload.data?.hasMore || rows.length === 0) {
            return;
          }
          offset += rows.length;
        } catch {
          // A failed peek leaves the bar hidden; it must not disturb the chat itself.
          return;
        }
      }
    };

    void peek();
    return () => {
      cancelled = true;
    };
  }, [hasLoadedUserPrompt, isActive, sessionId, totalMessages]);

  // Derived rather than cleared: a session switch, a hidden tab, or a prompt
  // arriving on the loaded page must hide the stale answer in the same render.
  return !hasLoadedUserPrompt && peeked && peeked.sessionId === sessionId ? peeked.prompt : null;
}

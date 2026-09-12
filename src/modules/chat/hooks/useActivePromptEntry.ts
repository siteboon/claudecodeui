import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import type { PromptEntry } from '@/modules/chat/utils/promptNavigator';

/** Portion of the viewport height above which a row counts as "being read". */
const ACTIVE_ROW_VIEWPORT_FRACTION = 0.35;

/**
 * Tracks which prompt the scroll position is currently reading: the newest
 * transcript row whose top has passed the upper third of the viewport, mapped
 * back to its navigator entry. The rail centers its tape on this entry and
 * renders its tick darker.
 */
export function useActivePromptEntry(
  scrollContainerRef: RefObject<HTMLDivElement>,
  entries: PromptEntry[],
): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || entries.length === 0) {
      setActiveId(null);
      return undefined;
    }

    let frame = 0;
    const compute = () => {
      frame = 0;
      const rows = container.querySelectorAll<HTMLElement>('[data-message-timestamp]');
      const threshold =
        container.getBoundingClientRect().top + container.clientHeight * ACTIVE_ROW_VIEWPORT_FRACTION;

      let timestamp: string | null = null;
      for (let index = 0; index < rows.length; index += 1) {
        if (rows[index].getBoundingClientRect().top <= threshold) {
          timestamp = rows[index].getAttribute('data-message-timestamp');
        } else {
          break;
        }
      }
      if (timestamp === null && rows.length > 0) {
        timestamp = rows[0].getAttribute('data-message-timestamp');
      }

      // The row being read is usually an assistant reply or tool group below
      // its prompt, so the active entry is the newest prompt at or before that
      // row's timestamp — not an exact-timestamp match.
      const passedTime = timestamp === null ? -Infinity : new Date(timestamp).getTime();
      let matchId: string | null = null;
      for (const entry of entriesRef.current) {
        const entryTime = new Date(String(entry.timestamp)).getTime();
        if (Number.isFinite(entryTime) && entryTime <= passedTime) {
          matchId = entry.id;
        } else {
          break;
        }
      }
      // Nothing passed yet (scrolled to the very top): the first prompt.
      setActiveId(matchId ?? entriesRef.current[0]?.id ?? null);
    };

    const requestCompute = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(compute);
      }
    };

    compute();
    container.addEventListener('scroll', requestCompute, { passive: true });
    return () => {
      container.removeEventListener('scroll', requestCompute);
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
    };
  }, [entries, scrollContainerRef]);

  return activeId;
}

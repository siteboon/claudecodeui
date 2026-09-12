import type { ChatMessage } from '@/shared/types';
import { isToolGroupItem } from '@/modules/chat/utils/toolGrouping';
import type { MessageListItem } from '@/modules/chat/utils/toolGrouping';

/** Rows at or below this count render without virtualization (no spacers). */
export const TRANSCRIPT_FULL_RENDER_ROWS = 60;

/** Render band beyond the viewport on each side, so fast scrolls stay covered. */
export const TRANSCRIPT_OVERSCAN_PX = 900;

/** Per-row vertical gap (the list's space-y margin) charged onto every row. */
export const TRANSCRIPT_ROW_GAP_PX = 14;

/**
 * Estimated rendered height of a single transcript row, gap included.
 *
 * Same per-kind numbers as the old placeholder scheme, with collapsed tool
 * runs priced as one summary line. Measured heights replace these as soon
 * as a row has been near the screen; the estimate only has to keep the
 * scrollbar and the two spacers sane.
 */
export function estimateItemHeightPx(item: MessageListItem): number {
  let base: number;
  if (isToolGroupItem(item)) {
    base = 240;
  } else {
    const message = item as ChatMessage;
    if (message.isThinking) {
      base = 70;
    } else if (message.type === 'error') {
      base = 120;
    } else if (message.type === 'user') {
      base = 110;
    } else if ((message as { isTaskNotification?: boolean }).isTaskNotification) {
      base = 90;
    } else {
      base = 200;
    }
  }
  return base + TRANSCRIPT_ROW_GAP_PX;
}

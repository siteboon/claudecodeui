import type { ChatMessage } from '@/shared/types';

const readTime = (value: ChatMessage['timestamp']): number => {
  const ms = new Date(value as string).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * A duration at the precision a reader can use: tenths under ten seconds,
 * whole seconds under a minute, then minutes and hours.
 */
export function formatTurnDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '';
  }

  const seconds = ms / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${Math.round(seconds % 60)}s`;
  }

  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m`;
}

/**
 * How long each turn took, keyed by the row that opens it.
 *
 * Two sources, in that order of trust:
 *
 * 1. `durationMs`, recorded by the run itself from the provider's `result`.
 *    Exact, and the only one that counts the stretch between the last message
 *    and the run actually finishing — which on a tool-heavy turn is most of it.
 * 2. The gap between the prompt and the last row of its turn. Available for
 *    every turn, including ones that ran before durations were recorded and
 *    ones whose run ended somewhere this client never saw, but it stops at the
 *    last message rather than at the end of the turn.
 *
 * A turn still in flight is left out entirely: its last row is wherever it has
 * got to, so a number there would only count how long it has been running, and
 * would keep growing while it does.
 */
export function computeTurnDurations(
  messages: ChatMessage[],
  isTurnInFlight = false,
): Map<ChatMessage, number> {
  const durations = new Map<ChatMessage, number>();
  let promptAt: number | null = null;
  let anchor: ChatMessage | null = null;
  let recorded: number | null = null;
  let lastAt = 0;

  const closeTurn = () => {
    if (anchor && promptAt !== null) {
      const measured = recorded ?? (lastAt > promptAt ? lastAt - promptAt : null);
      if (measured !== null && measured > 0) {
        durations.set(anchor, measured);
      }
    }
    anchor = null;
    recorded = null;
    lastAt = 0;
  };

  for (const message of messages) {
    const at = readTime(message.timestamp);

    if (message.type === 'user') {
      closeTurn();
      promptAt = at;
      continue;
    }

    // A page of history can start in the middle of a turn, with no prompt above
    // it to measure from.
    if (promptAt === null) {
      continue;
    }

    if (
      !anchor
      && message.type === 'assistant'
      && !message.isToolUse
      && !message.isThinking
      && !message.isStreaming
    ) {
      anchor = message;
    }
    if (typeof message.durationMs === 'number') {
      recorded = message.durationMs;
    }
    if (at > lastAt) {
      lastAt = at;
    }
  }

  if (!isTurnInFlight) {
    closeTurn();
  }

  return durations;
}

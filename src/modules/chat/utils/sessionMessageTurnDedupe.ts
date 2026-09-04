/**
 * Turn-level echo dedupe for the session message store.
 *
 * Pure functions only — this module must stay free of Vite/environment
 * dependencies so it is importable from node:test, mirroring
 * sessionMessagePagination.ts / sessionMessageReconciliation.ts.
 */

import type { NormalizedMessage } from '@/modules/chat/hooks/useSessionStore';

export function readMessageTime(m: NormalizedMessage): number | null {
  const time = Date.parse(m.timestamp);
  return Number.isFinite(time) ? time : null;
}

export function compareMessagesChronologically(a: NormalizedMessage, b: NormalizedMessage): number {
  const timeA = readMessageTime(a) ?? 0;
  const timeB = readMessageTime(b) ?? 0;
  if (timeA !== timeB) {
    return timeA - timeB;
  }
  return 0;
}

/**
 * Match assistant texts with tolerance for streaming whitespace differences,
 * token concatenation boundary anomalies, and minor formatting discrepancies.
 */
export function isAssistantTextMatch(candidate: string, target: string): boolean {
  const a = (candidate || '').trim();
  const b = (target || '').trim();
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }

  // 1. Match with all whitespace stripped (handles lost spaces from token boundary or line breaks)
  const compactA = a.replace(/\s+/g, '');
  const compactB = b.replace(/\s+/g, '');
  if (compactA === compactB) {
    return true;
  }

  // 2. Match streaming progressive prefix (where one is an in-progress prefix of the other)
  const minLen = Math.min(compactA.length, compactB.length);
  const maxLen = Math.max(compactA.length, compactB.length);
  if (minLen >= 20 && (compactA.startsWith(compactB) || compactB.startsWith(compactA))) {
    if (minLen / maxLen >= 0.75 || minLen >= 100) {
      return true;
    }
  }

  return false;
}

/**
 * Count how many user turns precede `message` in a chronologically merged view
 * of server + realtime rows. Used to match a realtime row to the correct turn
 * on disk when several turns share identical assistant text.
 */
function getUserTurnOrdinalBefore(
  message: NormalizedMessage,
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): number {
  const messageTime = readMessageTime(message);
  let userCount = 0;

  for (const candidate of [...serverMessages, ...realtimeMessages].sort(compareMessagesChronologically)) {
    if (candidate.id === message.id) {
      break;
    }

    const candidateTime = readMessageTime(candidate);
    if (
      messageTime !== null
      && candidateTime !== null
      && candidateTime > messageTime
    ) {
      break;
    }

    if (candidate.kind === 'text' && candidate.role === 'user') {
      userCount++;
    }
  }

  return Math.max(0, userCount - 1);
}

function findServerTurnRangeByOrdinal(
  serverMessages: NormalizedMessage[],
  turnOrdinal: number,
): { start: number; end: number } | null {
  let userCount = -1;
  let start = -1;

  for (let index = 0; index < serverMessages.length; index++) {
    const message = serverMessages[index];
    if (message.kind === 'text' && message.role === 'user') {
      userCount++;
      if (userCount === turnOrdinal) {
        start = index;
        break;
      }
    }
  }

  if (start < 0) {
    return null;
  }

  let end = serverMessages.length;
  for (let index = start + 1; index < serverMessages.length; index++) {
    if (serverMessages[index].kind === 'text' && serverMessages[index].role === 'user') {
      end = index;
      break;
    }
  }

  return { start, end };
}

/**
 * Tests whether a realtime assistant text row (a finalized streaming bubble)
 * is already persisted in the same conversation turn on the server.
 *
 * Two shapes match:
 * 1. The row equals one persisted text segment verbatim (the common case —
 *    providers that segment their live stream with `stream_end` produce one
 *    finalized row per persisted segment).
 * 2. The row equals the concatenation of the turn's persisted text segments.
 *    Providers without live segment markers stream a whole turn as one
 *    concatenated bubble, while the transcript stores each text segment as
 *    its own row; no single row can match, and without the joined comparison
 *    the turn would render twice.
 */
export function isAssistantTextEchoedInSameTurnOnServer(
  message: NormalizedMessage,
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): boolean {
  const assistantText = (message.content || '').trim();
  if (!assistantText) {
    return false;
  }

  // 0. Precise turn anchor match when transcriptAnchorId is available
  if (message.transcriptAnchorId) {
    const anchorIndex = serverMessages.findIndex(
      (sm) => sm.kind === 'text' && sm.role === 'user' && sm.transcriptAnchorId === message.transcriptAnchorId,
    );
    if (anchorIndex >= 0) {
      let turnEnd = serverMessages.length;
      for (let j = anchorIndex + 1; j < serverMessages.length; j++) {
        if (serverMessages[j].kind === 'text' && serverMessages[j].role === 'user') {
          turnEnd = j;
          break;
        }
      }
      const turnSegments = serverMessages
        .slice(anchorIndex + 1, turnEnd)
        .filter((sm) => sm.kind === 'text' && sm.role === 'assistant' && (sm.content || '').length > 0);

      if (turnSegments.some((sm) => isAssistantTextMatch(sm.content || '', assistantText))) {
        return true;
      }
      const joinedText = turnSegments.map((sm) => sm.content || '').join('');
      return isAssistantTextMatch(joinedText, assistantText);
    }
  }

  // 1. Precise preceding-user matching (robust against pagination slices and duplicate counts)
  const targetTime = readMessageTime(message);
  const allChronological = [...serverMessages, ...realtimeMessages].sort(compareMessagesChronologically);
  let precedingUserContent: string | null = null;
  let precedingUserTime: number | null = null;

  for (const candidate of allChronological) {
    if (candidate.id === message.id) {
      break;
    }
    const candidateTime = readMessageTime(candidate);
    if (targetTime !== null && candidateTime !== null && candidateTime > targetTime) {
      break;
    }
    if (candidate.kind === 'text' && candidate.role === 'user') {
      precedingUserContent = (candidate.content || '').trim();
      precedingUserTime = candidateTime;
    }
  }

  if (precedingUserContent) {
    // Find the latest matching user message on server
    for (let i = serverMessages.length - 1; i >= 0; i--) {
      const sm = serverMessages[i];
      if (sm.kind === 'text' && sm.role === 'user' && (sm.content || '').trim() === precedingUserContent) {
        let turnEnd = serverMessages.length;
        for (let j = i + 1; j < serverMessages.length; j++) {
          if (serverMessages[j].kind === 'text' && serverMessages[j].role === 'user') {
            turnEnd = j;
            break;
          }
        }
        const turnSegments = serverMessages
          .slice(i + 1, turnEnd)
          .filter((serverMessage) =>
            serverMessage.kind === 'text'
            && serverMessage.role === 'assistant'
            && (serverMessage.content || '').length > 0,
          );

        if (turnSegments.some((serverMessage) => isAssistantTextMatch(serverMessage.content || '', assistantText))) {
          return true;
        }
        const joinedText = turnSegments.map((serverMessage) => serverMessage.content || '').join('');
        if (isAssistantTextMatch(joinedText, assistantText)) {
          return true;
        }
        // The server user turn exists, but this assistant text has not landed yet.
        return false;
      }
    }
  }

  // 2. Fallback to turn-ordinal lookup for historical or legacy layouts
  const turnOrdinal = getUserTurnOrdinalBefore(message, serverMessages, realtimeMessages);
  const turnRange = findServerTurnRangeByOrdinal(serverMessages, turnOrdinal);
  if (!turnRange) {
    // 3. Robust fallback: If user turn could not be found (e.g. paginated away by tool calls),
    // and serverMessages already has this exact assistant text after the user prompt, it is an echo.
    for (const sm of serverMessages) {
      if (sm.kind === 'text' && sm.role === 'assistant' && isAssistantTextMatch(sm.content || '', assistantText)) {
        const smTime = readMessageTime(sm);
        if (precedingUserTime === null || smTime === null || smTime >= precedingUserTime) {
          return true;
        }
      }
    }
    return false;
  }

  const turnSegments = serverMessages
    .slice(turnRange.start + 1, turnRange.end)
    .filter((serverMessage) =>
      serverMessage.kind === 'text'
      && serverMessage.role === 'assistant'
      && (serverMessage.content || '').length > 0,
    );

  if (turnSegments.some((serverMessage) => isAssistantTextMatch(serverMessage.content || '', assistantText))) {
    return true;
  }

  // Segments are joined on their raw content so inter-segment whitespace
  // survives, matching how the live deltas concatenated; only the outer
  // edges are trimmed, same as `assistantText` above.
  const joinedText = turnSegments.map((serverMessage) => serverMessage.content || '').join('');
  return isAssistantTextMatch(joinedText, assistantText);
}

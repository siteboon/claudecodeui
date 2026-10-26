/**
 * Draws BTW side questions where they were asked, by splicing each one into a
 * session's own transcript as a question/answer pair placed by time — never
 * by reordering the session's own rows.
 */

import type { ChatMessage, SideQuestion } from '@/shared/types';

export type MergeSideQuestionsOptions = {
  /**
   * True while older history pages have not been loaded yet. A pair older
   * than the oldest loaded timestamped row is left out so it does not jump
   * to the top of the window and move again once older pages arrive.
   */
  hasOlder?: boolean;
  /** Shown in italics for an `error` item with no `error` text; English default. */
  failedText?: string;
};

const DEFAULT_FAILED_TEXT = 'The side question failed.';

/** The epoch millisecond a row's timestamp reads as, or null when it cannot be parsed. */
function readableTime(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) {
    return null;
  }
  const time = new Date(value as string | number | Date).getTime();
  return Number.isNaN(time) ? null : time;
}

function buildAnswerContent(item: SideQuestion, failedText: string): string {
  if (item.status !== 'error') return item.answer;
  const message = item.error ?? failedText;
  const prefix = item.answer ? `${item.answer}\n\n` : '';
  return `${prefix}_${message}_`;
}

function buildPair(item: SideQuestion, failedText: string): [ChatMessage, ChatMessage] {
  const btw = { sideQuestionId: item.id, sessionId: item.sessionId, status: item.status };
  const question: ChatMessage = {
    id: `btw-q-${item.id}`,
    type: 'user',
    content: item.question,
    timestamp: item.createdAt,
    btw,
  };
  const answer: ChatMessage = {
    id: `btw-a-${item.id}`,
    type: 'assistant',
    content: buildAnswerContent(item, failedText),
    timestamp: item.createdAt,
    isStreaming: item.status === 'running',
    btw,
  };
  return [question, answer];
}

/**
 * Inserts one pair right after the last row, walking back from the end, whose
 * readable timestamp is at or before `targetTime` — skipping rows whose
 * timestamp cannot be read rather than stopping in front of them. No such row
 * means the pair goes at the very start.
 */
function insertPair(messages: ChatMessage[], pair: [ChatMessage, ChatMessage], targetTime: number): ChatMessage[] {
  let insertIndex = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const time = readableTime(messages[i].timestamp);
    if (time === null) continue;
    if (time <= targetTime) {
      insertIndex = i + 1;
      break;
    }
  }
  const next = messages.slice();
  next.splice(insertIndex, 0, ...pair);
  return next;
}

export function mergeSideQuestions(
  messages: ChatMessage[],
  items: SideQuestion[],
  options: MergeSideQuestionsOptions = {},
): ChatMessage[] {
  if (items.length === 0) return messages;

  const { hasOlder = false, failedText = DEFAULT_FAILED_TEXT } = options;

  const sortedItems = [...items].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  let filteredItems = sortedItems;
  if (hasOlder) {
    let oldestLoadedTime: number | null = null;
    for (const message of messages) {
      const time = readableTime(message.timestamp);
      if (time !== null) {
        oldestLoadedTime = time;
        break;
      }
    }
    // No readable row to compare against: the window's start is unknown, so
    // nothing is cut rather than risking a question dropped for good.
    if (oldestLoadedTime !== null) {
      filteredItems = sortedItems.filter(
        (item) => new Date(item.createdAt).getTime() >= (oldestLoadedTime as number),
      );
    }
  }

  if (filteredItems.length === 0) return messages;

  let result = messages;
  for (const item of filteredItems) {
    const pair = buildPair(item, failedText);
    result = insertPair(result, pair, new Date(item.createdAt).getTime());
  }
  return result;
}

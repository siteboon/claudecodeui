import type { ChatMessage } from '@/shared/types';

const PREVIEW_MAX_CHARS = 160;

export type PromptEntry = {
  /** Identity used as the React key and for active-tick matching. */
  id: string;
  /** The message's own timestamp, used to find the rendered DOM row to jump to. */
  timestamp: ChatMessage['timestamp'];
  preview: string;
  /** The source message, for callers that need to match rows back to entries. */
  message: ChatMessage;
};

/** Collapse a message's text into a single-line snippet for the preview list. */
export const buildPromptPreview = (content: string | undefined): string => {
  const collapsed = (content ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return collapsed.length > PREVIEW_MAX_CHARS
    ? `${collapsed.slice(0, PREVIEW_MAX_CHARS - 1)}…`
    : collapsed;
};

/**
 * Collect the user prompts of a transcript into navigator entries, in order.
 * The prompt navigator rail shows one tick per entry; the jump handler matches
 * the same processed preview when disambiguating repeated timestamps.
 */
export const buildPromptEntries = (messages: ChatMessage[]): PromptEntry[] => {
  const entries: PromptEntry[] = [];
  messages.forEach((message, index) => {
    if (message.type !== 'user' || message.isThinking) {
      return;
    }
    if (message.isLocalCommand && !message.content) {
      return;
    }
    entries.push({
      id: `${String(message.timestamp)}-${index}`,
      timestamp: message.timestamp,
      preview: buildPromptPreview(message.displayText ?? message.content),
      message,
    });
  });
  return entries;
};

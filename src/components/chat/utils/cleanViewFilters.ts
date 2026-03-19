import type { ChatMessage } from '../types/types';

/**
 * Strip noise tags from user message text that the terminal hides.
 * Only applied in clean view mode — raw mode preserves original content.
 */
export const stripNoiseTags = (text: string): string => {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .trim();
};

/**
 * Apply clean view filters to a list of messages.
 * - Strips noise tags from user messages
 * - Removes messages that become empty after stripping
 * Returns a new array (does not mutate input).
 */
export const applyCleanViewFilters = (messages: ChatMessage[]): ChatMessage[] => {
  const result: ChatMessage[] = [];

  for (const msg of messages) {
    // Only strip noise from user messages (assistant/tool messages don't have these tags)
    if (msg.type === 'user' && !msg.isSkillLoad && msg.content) {
      const cleaned = stripNoiseTags(msg.content);
      if (!cleaned) {
        // Message was entirely noise tags — skip it
        continue;
      }
      if (cleaned !== msg.content) {
        // Content changed — create a new message object with cleaned content
        result.push({ ...msg, content: cleaned });
        continue;
      }
    }
    result.push(msg);
  }

  return result;
};

import type { NormalizedMessage } from '@/shared/index.js';

/**
 * Used by the Agent route to collect assistant replies for a JSON response.
 * Preserve complete text events from existing providers; Kiro emits only
 * deltas, so join each contiguous text segment without exposing tool output.
 */
export function collectAssistantMessages(messages: readonly NormalizedMessage[]): NormalizedMessage[] {
  const replies: NormalizedMessage[] = [];
  let pending: NormalizedMessage | null = null;

  const flush = () => {
    if (pending) replies.push(pending);
    pending = null;
  };

  for (const message of messages) {
    if (message?.provider === 'kiro' && message.kind === 'stream_delta' && message.role === 'assistant') {
      if (typeof message.content !== 'string' || !message.content) continue;
      if (pending) {
        pending.content = `${pending.content}${message.content}`;
      } else {
        pending = { ...message, kind: 'text' };
      }
    } else {
      // stream_end, tool events and completion all delimit a text segment.
      flush();
      if (message?.kind === 'text' && message.role === 'assistant') replies.push(message);
    }
  }
  flush();
  return replies;
}

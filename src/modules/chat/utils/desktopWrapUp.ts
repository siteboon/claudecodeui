import type { ChatMessage } from '@/shared/types';
import { parseToolPayload } from '@/modules/chat/utils/messageTransforms';

const WRAP_UP_TOOL = 'mcp__ccd_turn__wrap_up';

/** Gives ChatMessagesPane the most recent Desktop wrap-up in the current turn. */
export function findDesktopWrapUp(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.sideQuestion) continue;
    if (message.contextCleared || (message.type === 'user' && !message.isToolUse)) break;
    if (!message.isToolUse || message.toolName !== WRAP_UP_TOOL || message.toolResult?.isError) continue;
    const payload = parseToolPayload(message.toolInput);
    if (!payload || typeof payload !== 'object') continue;
    const { recap, ask, actions } = payload as Record<string, unknown>;
    const labels = Array.isArray(actions) ? actions.flatMap((action: unknown) => {
      if (!action || typeof action !== 'object' || !('label' in action) || typeof action.label !== 'string') return [];
      const label = action.label.trim();
      return label ? [label] : [];
    }) : [];
    const summary = typeof recap === 'string' ? recap.trim() : '';
    const question = typeof ask === 'string' ? ask.trim() : '';
    if (summary || question || labels.length) {
      return { message, recap: summary, question, actions: [...new Set(labels)] };
    }
  }
  return null;
}

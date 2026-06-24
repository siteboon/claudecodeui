import type { ChatMessage } from '../types/types';

export const TOOL_GROUP_THRESHOLD = 3;

export interface ToolGroupItem {
  _isGroup: true;
  toolName: string;
  messages: ChatMessage[];
  timestamp: ChatMessage['timestamp'];
}

export type MessageListItem = ChatMessage | ToolGroupItem;

export function isToolGroupItem(item: MessageListItem): item is ToolGroupItem {
  return '_isGroup' in item && (item as ToolGroupItem)._isGroup === true;
}

function isGroupableToolMessage(message: ChatMessage): message is ChatMessage & { toolName: string } {
  return Boolean(message.isToolUse && message.toolName && !message.isSubagentContainer);
}

export function groupConsecutiveTools(messages: ChatMessage[]): MessageListItem[] {
  const items: MessageListItem[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];

    if (!isGroupableToolMessage(message)) {
      items.push(message);
      index += 1;
      continue;
    }

    const run: ChatMessage[] = [message];
    let nextIndex = index + 1;

    while (
      nextIndex < messages.length &&
      isGroupableToolMessage(messages[nextIndex]) &&
      messages[nextIndex].toolName === message.toolName
    ) {
      run.push(messages[nextIndex]);
      nextIndex += 1;
    }

    if (run.length >= TOOL_GROUP_THRESHOLD) {
      items.push({
        _isGroup: true,
        toolName: message.toolName,
        messages: run,
        timestamp: message.timestamp,
      });
    } else {
      items.push(...run);
    }

    index = nextIndex;
  }

  return items;
}

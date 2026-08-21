import type { ChatMessage, ToolGroupItem } from '@/shared/types';
import { getToolConfig } from '@/modules/chat/tools/configs/toolConfigs';

export const TOOL_GROUP_THRESHOLD = 2;

/** How many of a group's tool inputs the collapsed summary line spells out. */
const PREVIEWED_TOOL_COUNT = 2;


export type MessageListItem = ChatMessage | ToolGroupItem;

export function isToolGroupItem(item: MessageListItem): item is ToolGroupItem {
  return '_isGroup' in item && (item as ToolGroupItem)._isGroup === true;
}

function isGroupableToolMessage(message: ChatMessage): message is ChatMessage & { toolName: string } {
  return Boolean(message.isToolUse && message.toolName && !message.isSubagentContainer);
}

// Messages that render nothing (e.g. reasoning hidden when showThinking is off)
// shouldn't split an otherwise-continuous run of the same tool — providers like
// Codex interleave hidden reasoning between consecutive tool calls.
function rendersNothing(message: ChatMessage, showThinking: boolean): boolean {
  return Boolean(message.isThinking && !showThinking);
}

function parseToolInput(toolInput: unknown): unknown {
  if (typeof toolInput !== 'string') {
    return toolInput;
  }

  try {
    return JSON.parse(toolInput);
  } catch {
    return toolInput;
  }
}

function getToolInputPreview(message: ChatMessage): string {
  const config = getToolConfig(message.toolName || 'UnknownTool').input;
  const parsedInput = parseToolInput(message.toolInput);
  const title = typeof config.title === 'function' ? config.title(parsedInput) : config.title;
  const value = config.getValue?.(parsedInput);

  return String(value || title || message.displayText || message.content || '').trim();
}

/**
 * Builds the collapsed group's summary line.
 *
 * Computed here rather than in the component so it happens once per grouping
 * pass instead of once per group render. It is not cached beyond that: grouping
 * re-runs on every 100ms stream tick because visibleMessages is a fresh array,
 * and a run's preview changes as the run grows, so a cache would have to be
 * keyed on the whole run. Measured at 0.18ms per tick over a 100-message window,
 * which is a seventh of what the store's own per-tick merge costs — not worth
 * the staleness risk.
 */
function buildGroupPreview(messages: ChatMessage[]): string {
  const shown = messages.slice(0, PREVIEWED_TOOL_COUNT);
  const previewText = shown.map(getToolInputPreview).filter(Boolean).join(', ');
  // Counts the messages the line leaves out, not the ones that produced no
  // text. Subtracting the filtered previews instead made a run of two where one
  // input has no preview — a Read with no file_path — claim "+1 more" while
  // showing everything it had.
  const extraCount = messages.length - shown.length;

  if (!previewText) {
    return extraCount > 0 ? `+${extraCount} more` : '';
  }

  return extraCount > 0 ? `${previewText}, +${extraCount} more` : previewText;
}

export function groupConsecutiveTools(
  messages: ChatMessage[],
  showThinking: boolean = true,
): MessageListItem[] {
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

    while (nextIndex < messages.length) {
      const candidate = messages[nextIndex];

      // Skip invisible interleaved messages so they don't break the run.
      if (rendersNothing(candidate, showThinking)) {
        nextIndex += 1;
        continue;
      }

      if (isGroupableToolMessage(candidate) && candidate.toolName === message.toolName) {
        run.push(candidate);
        nextIndex += 1;
        continue;
      }

      break;
    }

    if (run.length >= TOOL_GROUP_THRESHOLD) {
      items.push({
        _isGroup: true,
        toolName: message.toolName,
        messages: run,
        timestamp: message.timestamp,
        preview: buildGroupPreview(run),
      });
    } else {
      items.push(...run);
    }

    index = nextIndex;
  }

  return items;
}

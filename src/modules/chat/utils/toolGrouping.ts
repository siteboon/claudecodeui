import type { ChatMessage } from '@/shared/types';

export const TOOL_GROUP_THRESHOLD = 2;

export type ToolGroupItem = {
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

// Messages that render nothing (e.g. reasoning hidden when showThinking is off)
// shouldn't split an otherwise-continuous run of the same tool — providers like
// Codex interleave hidden reasoning between consecutive tool calls.
function rendersNothing(message: ChatMessage, showThinking: boolean): boolean {
  return Boolean(message.isThinking && (!showThinking || !message.content?.trim()));
}

export function getNormalizedToolGroupKey(toolName: string): string {
  if (toolName === 'run_command' || toolName === 'Bash' || toolName === 'exec' || toolName === 'command_execution') return 'Bash';
  if (toolName === 'view_file' || toolName === 'Read') return 'Read';
  if (toolName === 'replace_file_content' || toolName === 'Edit' || toolName === 'ApplyPatch' || toolName === 'apply_patch') return 'Edit';
  if (toolName === 'write_to_file' || toolName === 'Write') return 'Write';
  if (toolName === 'find_by_name' || toolName === 'Glob') return 'Glob';
  if (toolName === 'grep_search' || toolName === 'Grep') return 'Grep';
  if (toolName === 'list_dir' || toolName === 'LS') return 'LS';
  if (toolName === 'search_web' || toolName === 'WebSearch') return 'WebSearch';
  if (toolName === 'read_url_content' || toolName === 'WebFetch') return 'WebFetch';
  if (toolName === 'manage_task' || toolName === 'Task') return 'Task';
  if (toolName === 'manage_subagents' || toolName === 'invoke_subagent') return 'Subagent';
  if (toolName === 'ExitPlanMode' || toolName === 'exit_plan_mode' || toolName === 'Plan' || toolName === 'update_plan') return 'Plan';
  return toolName;
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
    const baseGroupKey = getNormalizedToolGroupKey(message.toolName);

    while (nextIndex < messages.length) {
      const candidate = messages[nextIndex];

      // Skip invisible interleaved messages so they don't break the run.
      if (rendersNothing(candidate, showThinking)) {
        nextIndex += 1;
        continue;
      }

      if (
        isGroupableToolMessage(candidate) &&
        getNormalizedToolGroupKey(candidate.toolName) === baseGroupKey
      ) {
        run.push(candidate);
        nextIndex += 1;
        continue;
      }

      break;
    }

    if (run.length >= TOOL_GROUP_THRESHOLD) {
      items.push({
        _isGroup: true,
        toolName: baseGroupKey,
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

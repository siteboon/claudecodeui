import type { ChatMessage } from '../types/types';

/**
 * Tools classified as "read-only" — collapsed in clean view.
 * Code-change tools (Edit, Write, Bash, NotebookEdit, ApplyPatch) stay visible.
 */
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'WebSearch',
  'WebFetch',
  'Skill',
  'TaskCreate',
  'TaskUpdate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'ToolSearch',
  'Agent',
  'LSP',
  'TodoRead',
]);

export const isReadOnlyTool = (toolName: string): boolean =>
  READ_ONLY_TOOLS.has(toolName);

export type CleanViewItem =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'group'; tools: ChatMessage[] };

/**
 * Groups consecutive read-only tool-use messages into collapsed groups.
 * Non-tool messages and code-change tools break the group.
 *
 * Only active when cleanView is true; otherwise returns all messages as-is.
 */
export const groupMessagesForCleanView = (
  messages: ChatMessage[],
  cleanView: boolean,
): CleanViewItem[] => {
  if (!cleanView) {
    return messages.map((message) => ({ kind: 'message', message }));
  }

  const items: CleanViewItem[] = [];
  let currentGroup: ChatMessage[] = [];

  const flushGroup = () => {
    if (currentGroup.length > 0) {
      items.push({ kind: 'group', tools: currentGroup });
      currentGroup = [];
    }
  };

  for (const message of messages) {
    // Skill loads pass through as individual messages (rendered as chips)
    if (message.isSkillLoad) {
      flushGroup();
      items.push({ kind: 'message', message });
      continue;
    }

    // Read-only tool-use messages get grouped
    if (message.isToolUse && message.toolName && isReadOnlyTool(message.toolName)) {
      currentGroup.push(message);
      continue;
    }

    // Everything else (text, code-change tools, user messages) breaks the group
    flushGroup();
    items.push({ kind: 'message', message });
  }

  flushGroup();
  return items;
};

/**
 * Build a human-readable summary of grouped tools.
 * e.g. "Read 3 files, Grep 2 patterns, Glob 1 search"
 */
export const summarizeToolGroup = (tools: ChatMessage[]): string => {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    const name = tool.toolName || 'Unknown';
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  const labels: Record<string, [string, string]> = {
    Read: ['file read', 'file reads'],
    Grep: ['search', 'searches'],
    Glob: ['file search', 'file searches'],
    WebSearch: ['web search', 'web searches'],
    WebFetch: ['web fetch', 'web fetches'],
    Agent: ['subagent', 'subagents'],
    LSP: ['LSP query', 'LSP queries'],
    TodoRead: ['todo read', 'todo reads'],
  };

  const parts: string[] = [];
  for (const [name, count] of counts) {
    const [singular, plural] = labels[name] || [name.toLowerCase(), `${name.toLowerCase()}s`];
    parts.push(`${count} ${count > 1 ? plural : singular}`);
  }

  return parts.join(', ');
};

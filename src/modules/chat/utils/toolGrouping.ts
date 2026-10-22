import type { ChatMessage, ToolGroupItem } from '@/shared/types';
import { getToolConfig } from '@/modules/chat/tools/configs/toolConfigs';

export const TOOL_GROUP_THRESHOLD = 2;

/** How many of a group's tool inputs the collapsed summary line spells out. */
const PREVIEWED_TOOL_COUNT = 2;


export type MessageListItem = ChatMessage | ToolGroupItem;

/** A run of consecutive tool rows, already narrowed to the ones that can group. */
type GroupableToolRun = (ChatMessage & { toolName: string })[];

type CachedToolGroup = {
  /** The exact run the group was built from; reused only while every row keeps its identity. */
  run: GroupableToolRun;
  /** Hidden reasoning both joins runs and changes what the preview names, so it is part of the key. */
  showThinking: boolean;
  group: ToolGroupItem;
};

// Chat rows keep their identity across a stream tick (useChatMessages' own
// projection cache), but grouping re-runs on every tick over a fresh array.
// Without this cache each collapsed run gets a brand-new group object, so
// `memo(ToolGroupContainer)` cannot bail and every group on screen re-renders
// ~10 times a second while only the streaming row actually changed. Keyed
// weakly on the run's first row so entries disappear with the rows themselves.
const toolGroupCache = new WeakMap<ChatMessage, CachedToolGroup>();

function isSameRun(cachedRun: GroupableToolRun, run: GroupableToolRun): boolean {
  return cachedRun.length === run.length
    && cachedRun.every((message, index) => message === run[index]);
}

/** The group object for a run, reused unchanged while the run's rows are unchanged. */
function getToolGroup(run: GroupableToolRun, showThinking: boolean): ToolGroupItem {
  const first = run[0];
  const cached = toolGroupCache.get(first);
  if (cached && cached.showThinking === showThinking && isSameRun(cached.run, run)) {
    return cached.group;
  }

  const group: ToolGroupItem = {
    _isGroup: true,
    toolName: first.toolName,
    messages: run,
    timestamp: first.timestamp,
    preview: buildGroupPreview(run),
  };
  toolGroupCache.set(first, { run, showThinking, group });
  return group;
}

export function isToolGroupItem(item: MessageListItem): item is ToolGroupItem {
  return '_isGroup' in item && (item as ToolGroupItem)._isGroup === true;
}

// An agent's or a workflow's row is its whole card — status, timeline, result —
// so it never folds into a collapsed run with its neighbours.
function isGroupableToolMessage(message: ChatMessage): message is ChatMessage & { toolName: string } {
  return Boolean(message.isToolUse && message.toolName && !message.isSubagentContainer && message.toolName !== 'Workflow');
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
 * pass instead of once per group render, and skipped entirely for runs the tool
 * group cache above can reuse — a run's preview depends on the whole run, which
 * is exactly what that cache compares.
 */
function buildGroupPreview(messages: ChatMessage[]): string {
  const named = messages
    .slice(0, PREVIEWED_TOOL_COUNT)
    .map(getToolInputPreview)
    .filter(Boolean);

  const previewText = named.join(', ');
  // Subtracted from the previews actually printed, not from the two slots the
  // line reserves, so that named + extraCount === messages.length for every
  // input. A tool whose input yields no text — a Read with no file_path, an
  // input still arriving as partial JSON — is genuinely not named, so it
  // belongs in the remainder. Counting slots instead makes a group of three
  // whose first preview is empty render "/b.ts, +1 more" beside an x3 badge.
  const extraCount = messages.length - named.length;

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

    const run: GroupableToolRun = [message];
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
      items.push(getToolGroup(run, showThinking));
    } else {
      items.push(...run);
    }

    index = nextIndex;
  }

  return items;
}

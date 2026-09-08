/**
 * Message normalization utilities.
 * Converts NormalizedMessage[] from the session store into ChatMessage[] for the UI.
 */

import type { ChatMessage,NormalizedMessage,SubagentActivity } from '@/shared/types';
import { formatUsageLimitText } from '@/modules/chat/utils/chatFormatting';

function formatToolResultContent(content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  const toolUseErrorMatch = /^<tool_use_error>([\s\S]*)<\/tool_use_error>$/.exec(text.trim());
  return toolUseErrorMatch ? toolUseErrorMatch[1] : text;
}

type ParsedTaskNotification = {
  status: string;
  summary: string;
  result: string;
};

type ToolResultSource = NormalizedMessage['toolResult'] | NormalizedMessage | null;

type CachedMessageProjection = {
  /** A tool-use row also depends on a separately received tool-result row. */
  toolResultSource: ToolResultSource;
  /** A live subagent container also depends on the newest row folded into its timeline. */
  subagentActivitySource: NormalizedMessage | null;
  messages: ChatMessage[];
};

// Normalized messages are immutable store records. Reuse the UI objects made
// from records that survived a store update so memoized message rows can skip
// work while only the active streaming record changes. Weak keys let entries
// disappear automatically after their source records are no longer retained.
const projectionCache = new WeakMap<NormalizedMessage, CachedMessageProjection>();

/**
 * Parses a background-agent `<task-notification>` block.
 *
 * The harness injects these as user-role messages when a background task stops.
 * Newer notifications carry extra fields (`<tool-use-id>`, `<note>`, `<usage>`,
 * and a `<result>` markdown payload) that the previous single-shot regex could
 * not match, so the whole raw XML block leaked through as plain user text.
 * Fields are extracted independently so the block renders as an assistant
 * notification plus, when present, the agent's markdown result.
 */
function parseTaskNotification(content: string): ParsedTaskNotification | null {
  if (!content.trimStart().startsWith('<task-notification>')) {
    return null;
  }

  const statusMatch = /<status>([\s\S]*?)<\/status>/.exec(content);
  const summaryMatch = /<summary>([\s\S]*?)<\/summary>/.exec(content);

  let result = '';
  const resultOpen = content.indexOf('<result>');
  if (resultOpen !== -1) {
    const afterOpen = content.slice(resultOpen + '<result>'.length);
    const closeIndex = afterOpen.indexOf('</result>');
    result =
      closeIndex === -1
        ? afterOpen.replace(/<\/task-notification>\s*$/, '').trim()
        : afterOpen.slice(0, closeIndex).trim();
  }

  return {
    status: statusMatch?.[1]?.trim() || 'completed',
    summary: summaryMatch?.[1]?.trim() || 'Background task finished',
    result,
  };
}

/**
 * Convert NormalizedMessage[] from the session store into ChatMessage[]
 * that the existing UI components expect.
 *
 * Truly internal/system content is already filtered server-side. Some Claude
 * transcript artifacts such as local slash commands and compact summaries are
 * intentionally preserved and annotated so they can render like normal chat.
 */
export function normalizedToChatMessages(messages: NormalizedMessage[]): ChatMessage[] {
  const converted: ChatMessage[] = [];

  // First pass: collect tool results for attachment, and fold live subagent
  // rows into their spawning tool call's timeline. A running subagent's rows
  // stream in stamped with `parentToolUseId`; rendered top-level they read as
  // the session's own tool calls, only to jump inside the container on the
  // next history load, which ships the same timeline as `subagentTools`.
  const toolResultMap = new Map<string, NormalizedMessage>();
  const toolUseIds = new Set<string>();
  const liveSubagentActivity = new Map<string, SubagentActivity[]>();
  const liveSubagentToolsById = new Map<string, SubagentActivity>();
  /** Newest folded row per container, so its cached projection knows to rebuild. */
  const lastSubagentSourceByParent = new Map<string, NormalizedMessage>();
  for (const msg of messages) {
    if (msg.parentToolUseId) {
      const parentId = msg.parentToolUseId;
      let activity = liveSubagentActivity.get(parentId);
      if (!activity) {
        activity = [];
        liveSubagentActivity.set(parentId, activity);
      }

      switch (msg.kind) {
        case 'tool_use': {
          const tool: SubagentActivity = {
            kind: 'tool',
            toolId: msg.toolId,
            toolName: msg.toolName || 'Tool',
            toolInput: msg.toolInput,
            timestamp: msg.timestamp,
          };
          activity.push(tool);
          if (msg.toolId) {
            liveSubagentToolsById.set(msg.toolId, tool);
          }
          lastSubagentSourceByParent.set(parentId, msg);
          break;
        }
        case 'tool_result': {
          const tool = msg.toolId ? liveSubagentToolsById.get(msg.toolId) : undefined;
          if (tool) {
            tool.toolResult = {
              content: formatToolResultContent(msg.content ?? ''),
              isError: Boolean(msg.isError),
            };
            lastSubagentSourceByParent.set(parentId, msg);
          }
          break;
        }
        case 'text':
        case 'thinking': {
          // Assistant prose and reasoning only, matching the timeline the
          // server builds from the subagent's transcript — user-role rows
          // there are tool results and the echoed task prompt.
          if ((msg.kind === 'thinking' || msg.role === 'assistant') && msg.content?.trim()) {
            activity.push({
              kind: msg.kind === 'thinking' ? 'thinking' : 'text',
              content: msg.content,
              timestamp: msg.timestamp,
            });
            lastSubagentSourceByParent.set(parentId, msg);
          }
          break;
        }
        default:
          break;
      }
      continue;
    }

    if (msg.kind === 'tool_use' && msg.toolId) {
      toolUseIds.add(msg.toolId);
    }

    if (msg.kind === 'tool_result' && msg.toolId) {
      toolResultMap.set(msg.toolId, msg);
    }
  }

  for (const msg of messages) {
    // Subagent rows were folded into their container's timeline above.
    if (msg.parentToolUseId) {
      continue;
    }

    const toolResultSource: ToolResultSource = msg.kind === 'tool_use'
      ? msg.toolResult || (msg.toolId ? toolResultMap.get(msg.toolId) : null) || null
      : null;
    const subagentActivitySource = msg.kind === 'tool_use' && msg.toolId
      ? lastSubagentSourceByParent.get(msg.toolId) ?? null
      : null;
    const cachedProjection = projectionCache.get(msg);

    // A tool-use projection must be rebuilt when a matching result arrives,
    // even though the original tool-use record itself is unchanged. The same
    // holds for a subagent container when its live timeline grows.
    if (
      cachedProjection?.toolResultSource === toolResultSource
      && cachedProjection.subagentActivitySource === subagentActivitySource
    ) {
      converted.push(...cachedProjection.messages);
      continue;
    }

    const convertedStart = converted.length;
    const sharedMetadata = {
      displayText: msg.displayText,
      commandName: msg.commandName,
      commandMessage: msg.commandMessage,
      commandArgs: msg.commandArgs,
      isLocalCommand: msg.isLocalCommand,
      isLocalCommandStdout: msg.isLocalCommandStdout,
      isCompactSummary: msg.isCompactSummary,
      // Carried through so a rendered user bubble can address its own
      // transcript row when the user edits or forks from it.
      transcriptAnchorId: msg.transcriptAnchorId,
    };

    switch (msg.kind) {
      case 'text': {
        const content = msg.content || '';
        const images = Array.isArray(msg.images) && msg.images.length > 0 ? msg.images : undefined;
        const files = Array.isArray(msg.files) && msg.files.length > 0 ? msg.files : undefined;
        if (!content.trim() && !images && !files) break;

        if (msg.role === 'user') {
          // Parse task notifications
          const taskNotif = parseTaskNotification(content);
          if (taskNotif) {
            converted.push({
              type: 'assistant',
              content: taskNotif.summary,
              timestamp: msg.timestamp,
              isTaskNotification: true,
              taskStatus: taskNotif.status,
              ...sharedMetadata,
            });
            // Render the agent's result as a normal assistant message so its
            // markdown displays correctly instead of leaking raw XML.
            if (taskNotif.result) {
              converted.push({
                type: 'assistant',
                content: formatUsageLimitText(taskNotif.result),
                timestamp: msg.timestamp,
                ...sharedMetadata,
              });
            }
          } else {
            converted.push({
              type: 'user',
              content,
              timestamp: msg.timestamp,
              images,
              files,
              ...sharedMetadata,
            });
          }
        } else {
          const text = formatUsageLimitText(content);
          converted.push({
            type: 'assistant',
            content: text,
            timestamp: msg.timestamp,
            memoryCitations: msg.memoryCitations,
            ...sharedMetadata,
          });
        }
        break;
      }

      case 'tool_use': {
        const tr = toolResultSource;
        // A row is a subagent container when the backend attached agent
        // metadata to it. Both providers normalize to that, so no provider or
        // tool-name special-casing is needed here; the name check only covers
        // a live spawn whose metadata has not been indexed yet.
        const isSubagentContainer = Boolean(msg.subagent)
          || msg.toolName === 'Task'
          || msg.toolName === 'Agent';

        const toolResult = tr
          ? {
              content: formatToolResultContent(tr.content),
              isError: Boolean(tr.isError),
              toolUseResult: (tr as any).toolUseResult,
            }
          : null;

        // The server-indexed timeline arrives on a history load; the live fold
        // covers the run in progress. A mid-run refresh can attach a partial
        // server timeline while newer live rows keep streaming, so the longer
        // list is the fresher one.
        const serverActivity = Array.isArray(msg.subagentTools) ? msg.subagentTools : undefined;
        const liveActivity = msg.toolId ? liveSubagentActivity.get(msg.toolId) : undefined;
        const subagentActivity = liveActivity && liveActivity.length > (serverActivity?.length ?? 0)
          ? liveActivity
          : serverActivity;

        converted.push({
          type: 'assistant',
          content: '',
          timestamp: msg.timestamp,
          isToolUse: true,
          toolName: msg.toolName,
          toolInput: typeof msg.toolInput === 'string' ? msg.toolInput : JSON.stringify(msg.toolInput ?? '', null, 2),
          toolId: msg.toolId,
          toolResult,
          toolStatus: typeof msg.status === 'string' ? msg.status : undefined,
          isSubagentContainer,
          subagent: msg.subagent,
          subagentActivity,
          memoryCitations: msg.memoryCitations,
          ...sharedMetadata,
        });
        break;
      }

      case 'thinking':
        if (msg.content?.trim()) {
          converted.push({
            type: 'assistant',
            content: msg.content,
            timestamp: msg.timestamp,
            isThinking: true,
            ...sharedMetadata,
          });
        }
        break;

      case 'error':
        converted.push({
          type: 'error',
          content: msg.content || 'Unknown error',
          timestamp: msg.timestamp,
          ...sharedMetadata,
        });
        break;

      case 'task_notification':
        converted.push({
          type: 'assistant',
          content: msg.summary || 'Background task update',
          timestamp: msg.timestamp,
          isTaskNotification: true,
          taskStatus: msg.status || 'completed',
          ...sharedMetadata,
        });
        break;

      case 'stream_delta':
        if (msg.content) {
          converted.push({
            type: 'assistant',
            content: msg.content,
            timestamp: msg.timestamp,
            isStreaming: true,
            ...sharedMetadata,
          });
        }
        break;

      // stream_end, complete, status, permission_*, session_created
      // are control events — not rendered as messages
      case 'stream_end':
      case 'complete':
      case 'status':
      case 'permission_request':
      case 'permission_resolved':
      case 'permission_cancelled':
      case 'session_created':
        // Skip — these are handled by useChatRealtimeHandlers
        break;

      // tool_result is handled via attachment to tool_use above
      case 'tool_result': {
        if (msg.toolId && toolUseIds.has(msg.toolId)) {
          break;
        }

        // A result with a toolId but no matching tool_use in the loaded set is
        // almost always a tool_use/tool_result pair split across a pagination
        // boundary (older page not loaded yet). Rendering its raw content here
        // produces an unstyled dump that "fixes itself" once the older page
        // loads; skip it and let it attach to its tool_use when that arrives.
        if (msg.toolId) {
          break;
        }

        const content = formatToolResultContent(msg.content || '');
        if (!content.trim()) {
          break;
        }

        converted.push({
          type: msg.isError ? 'error' : 'assistant',
          content,
          timestamp: msg.timestamp,
          toolId: msg.toolId,
          ...sharedMetadata,
        });
        break;
      }

      default:
        break;
    }

    projectionCache.set(msg, {
      toolResultSource,
      subagentActivitySource,
      // One source record can produce zero, one, or two UI messages (task
      // notifications with a result produce two), so cache the whole slice.
      messages: converted.slice(convertedStart),
    });
  }

  return converted;
}

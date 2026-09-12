import type { NormalizedMessage, SubagentSummary } from '@/shared/types';

/**
 * Pure helpers behind the info panel's subagent section and its chat modal.
 *
 * While an agent runs, its rows stream into the PARENT session's store
 * stamped with `parentToolUseId` (the spawning tool call). The main timeline
 * folds them into the Task card, but the panel's agent view must show them
 * top-level — so they are filtered by their parent stamp and the stamp is
 * stripped before conversion, otherwise `normalizedToChatMessages` folds them
 * away again. History and live rows are keyed apart by id.
 */

/** The agent's own rows from the parent's stream, with the parent stamp removed. */
export function extractLiveSubagentMessages(
  messages: NormalizedMessage[],
  toolUseId: string | undefined,
): NormalizedMessage[] {
  if (!toolUseId) return [];

  const live: NormalizedMessage[] = [];
  for (const message of messages) {
    if (message.parentToolUseId !== toolUseId) continue;
    // The echoed task prompt arrives as a user-role row under the same stamp;
    // it is the parent's question, not the agent's own voice.
    if (message.kind === 'text' && message.role === 'user') continue;
    if (message.kind === 'complete' || message.kind === 'status') continue;
    const copy = { ...message };
    delete copy.parentToolUseId;
    live.push(copy);
  }
  return live;
}

/**
 * Append live rows to the paged history without duplicating what the server
 * already shipped. Transcript ids are stable across REST and websocket
 * normalization, so id is the join key; tool rows additionally dedupe by
 * toolId because a tool_result can land from the live stream before the
 * REST page that carries its pair.
 */
export function mergeSubagentMessages(
  history: NormalizedMessage[],
  live: NormalizedMessage[],
): NormalizedMessage[] {
  if (live.length === 0) return history;

  const seenIds = new Set<string>();
  const seenToolIds = new Set<string>();
  for (const message of history) {
    seenIds.add(message.id);
    if ((message.kind === 'tool_use' || message.kind === 'tool_result') && message.toolId) {
      seenToolIds.add(`${message.kind}:${message.toolId}`);
    }
  }

  const merged = [...history];
  for (const message of live) {
    if (seenIds.has(message.id)) continue;
    const isToolRow = message.kind === 'tool_use' || message.kind === 'tool_result';
    const toolKey = isToolRow && message.toolId ? `${message.kind}:${message.toolId}` : null;
    if (toolKey && seenToolIds.has(toolKey)) continue;
    seenIds.add(message.id);
    if (toolKey) seenToolIds.add(toolKey);
    merged.push(message);
  }
  return merged;
}

/** Working log of one agent, compressed for the continuation prompt. */
function summarizeWorkLog(messages: NormalizedMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    switch (message.kind) {
      case 'text':
      case 'thinking':
        if (message.content?.trim()) {
          lines.push(message.kind === 'thinking' ? `[思考] ${message.content.trim()}` : message.content.trim());
        }
        break;
      case 'tool_use': {
        const input = typeof message.toolInput === 'string'
          ? message.toolInput
          : JSON.stringify(message.toolInput ?? {});
        lines.push(`[调用 ${message.toolName ?? 'Tool'}(${clip(input, 200)})]`);
        break;
      }
      case 'tool_result': {
        const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '');
        lines.push(`[结果${message.isError ? '（失败）' : ''}] ${clip(text, 200)}`);
        break;
      }
      default:
        break;
    }
  }
  return lines.join('\n');
}

function clip(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max)}…` : single;
}

/** Ceiling on how much of the agent's log rides along in the new session. */
const MAX_WORK_LOG_CHARS = 24_000;

/** Pre-translated sentences the prompt is assembled from (empty = built-in). */
export type ContinuationPromptCopy = {
  /** e.g. `你是「{{type}}」（{{description}}）。` */
  identity: string;
  /** Sentence before the log body, e.g. `以下是你…的工作记录：`. */
  logIntro: string;
  /** Sentence before the user's words, e.g. `用户现在要继续与你对话…：`. */
  askIntro: string;
};

const DEFAULT_COPY: ContinuationPromptCopy = {
  identity: '',
  logIntro: '以下是你作为该子智能体在先前会话中的工作记录',
  askIntro: '用户现在要继续与你对话，请基于上述上下文回应：',
};

/**
 * The "continue as this agent" first message for a brand-new session.
 *
 * A finished subagent has no external input channel — it ran inside the
 * parent's SDK process — so conversing means starting an independent session
 * seeded with the agent's identity (its type and task) and a compressed
 * record of what it already did. The user's own words come last. The three
 * prose seams are injected translated copy so the payload matches the UI
 * language; structure (identity line, fenced log, ask) stays here.
 */
export function buildSubagentContinuationPrompt(input: {
  summary: SubagentSummary;
  history: NormalizedMessage[];
  userText: string;
  copy?: Partial<ContinuationPromptCopy>;
}): string {
  const { summary, history, userText } = input;
  const copy = { ...DEFAULT_COPY, ...input.copy };

  const identity = copy.identity.trim()
    || (summary.agentType
      ? `你是「${summary.agentType}」${summary.description ? `（${summary.description}）` : ''}。`
      : summary.description
        ? `你是一名子智能体，此前的任务是：${summary.description}。`
        : '你是一名子智能体。');

  let log = summarizeWorkLog(history);
  let truncated = false;
  if (log.length > MAX_WORK_LOG_CHARS) {
    // Keep the END of the log — the most recent work is the most relevant
    // to a follow-up question.
    log = log.slice(log.length - MAX_WORK_LOG_CHARS);
    truncated = true;
  }

  const logSection = log
    ? `${copy.logIntro}${truncated ? '（超长，仅保留最近部分）' : ''}：\n---\n${log}\n---`
    : '（此前没有可携带的工作记录。）';

  return [identity, logSection, `${copy.askIntro}\n${userText}`].join('\n\n');
}

import fs from 'node:fs';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import { locateOmpSessionFile } from '@/modules/providers/list/omp/omp-session-files.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, generateMessageId, readObjectRecord, readOptionalString, sliceTailPage } from '@/shared/utils.js';

const PROVIDER = 'omp' as const;

/**
 * omp persists ACP sessions as JSONL under
 * `~/.omp/agent/sessions/<cwd-slug>/<ts>_<sessionId>.jsonl`.
 *
 * This provider covers both directions of one session: `normalizeMessage` maps
 * live ACP `session/update` notifications forwarded by the runtime, and
 * `fetchHistory` reads the same session back off disk.
 */

/**
 * Recursively reads text out of an ACP content value: a bare string, a content
 * block (`{type,text}`), an array of blocks, or a nested `{content:{...}}`
 * (ToolCallContent) wrapper. Returns null when no text is found so callers can
 * chain fallbacks with `??`.
 */
function readTextContent(value: unknown): string | null {
  // Return the RAW string — never trimmed. Streaming chunks arrive split
  // ("Hello" + " world"), so trimming here would drop the inter-chunk spaces
  // and produce "Helloworld". Empty strings collapse to null.
  if (typeof value === 'string') {
    return value.length > 0 ? value : null;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => readTextContent(entry))
      .filter((entry): entry is string => entry !== null);
    return parts.length > 0 ? parts.join('') : null;
  }
  const record = readObjectRecord(value);
  if (!record) {
    return null;
  }
  const raw = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  const nested = record.content === value ? null : readTextContent(record.content);
  return raw(record.text)
    ?? raw(record.content)
    ?? nested
    ?? raw(record.delta)
    ?? null;
}

/**
 * Maps one ACP `session/update` notification to NormalizedMessage chunks.
 * One update yields at most one message.
 */
function normalizeAcpUpdate(params: AnyRecord, sessionId: string | null): NormalizedMessage[] {
  const update = readObjectRecord(params.update);
  if (!update) {
    return [];
  }

  const kind = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : '';
  const base = { sessionId, timestamp: new Date().toISOString(), provider: PROVIDER } as const;

  if (kind === 'agent_message_chunk') {
    const text = readTextContent(update.content) ?? '';
    return text ? [createNormalizedMessage({ ...base, kind: 'stream_delta', content: text })] : [];
  }

  if (kind === 'agent_thought_chunk') {
    const text = readTextContent(update.content) ?? '';
    return text ? [createNormalizedMessage({ ...base, kind: 'thinking', content: text })] : [];
  }

  if (kind === 'tool_call') {
    // A missing toolCallId gets a unique generated id so id-less tool calls
    // don't all collapse onto '' and cross-correlate in the transcript.
    //
    // Defensive only: parsing every local transcript (350 files, 16,126
    // toolCall parts) found none without an id. If omp ever emits one, the live
    // row duplicates its history twin, because the client correlates the two by
    // tool id and history's own fallback is `${baseId}_u${i}`, not this one. Fix
    // that at the source — carry one id for both — rather than by guessing at a
    // match from position or content.
    const toolId = readOptionalString(update.toolCallId) || generateMessageId('omp_tool');
    const toolName = typeof update.title === 'string'
      ? update.title
      : (typeof update.kind === 'string' ? update.kind : 'tool');
    return [createNormalizedMessage({
      ...base,
      kind: 'tool_use',
      toolName,
      toolId,
      toolInput: update.rawInput,
    })];
  }

  if (kind === 'tool_call_update') {
    const status = typeof update.status === 'string' ? update.status : 'completed';
    // Intermediate (e.g. 'in_progress') updates are dropped so the live stream
    // matches the terminal tool_result the history reader will produce.
    if (status !== 'completed' && status !== 'failed') {
      return [];
    }
    const toolId = readOptionalString(update.toolCallId) || generateMessageId('omp_tool');
    // ACP carries the result under `content` (ToolCallContent[]); rawOutput/
    // output/result are alternate fields. Reading only `output` renders an empty
    // tool_result against real omp output.
    const content = readTextContent(update.content)
      ?? readTextContent(update.rawOutput)
      ?? readTextContent(update.raw_output)
      ?? readTextContent(update.output)
      ?? readTextContent(update.result)
      ?? '';
    return [createNormalizedMessage({
      ...base,
      kind: 'tool_result',
      toolId,
      content,
      isError: status === 'failed',
    })];
  }

  if (kind === 'plan') {
    return [createNormalizedMessage({ ...base, kind: 'status', text: 'plan' })];
  }

  // Live model/thinking/mode changes → status, so the UI can reflect them
  // (parity with how other providers surface mid-session model changes). Pass
  // configId through so the UI labels it correctly (Model vs Thinking vs Mode) —
  // current_mode_update is always the mode.
  if (kind === 'config_option_update' || kind === 'current_mode_update') {
    const value = readOptionalString(update.currentValue)
      ?? readOptionalString(update.value)
      ?? readOptionalString(update.currentModeId)
      ?? readOptionalString(update.mode);
    const configId = kind === 'current_mode_update'
      ? 'mode'
      : (readOptionalString(update.configId) ?? readOptionalString(update.id));
    return [createNormalizedMessage({ ...base, kind: 'status', text: kind, status: value, configId })];
  }

  // available_commands_update / session_info_update carry no user-facing state.
  return [];
}

/**
 * Maps one persisted jsonl entry to NormalizedMessages. A single entry can carry
 * several content parts, so it can expand into several messages.
 */
function normalizeJsonlMessage(entry: AnyRecord, sessionId: string | null): NormalizedMessage[] {
  if (entry.type !== 'message') {
    return [];
  }
  const message = readObjectRecord(entry.message);
  if (!message) {
    return [];
  }
  const baseId = readOptionalString(entry.id) ?? generateMessageId(PROVIDER);
  const ts = readOptionalString(entry.timestamp) ?? new Date().toISOString();
  const base = { sessionId, timestamp: ts, provider: PROVIDER } as const;

  // Tool result: its own message, linked to the tool_use by toolCallId.
  if (message.role === 'toolResult') {
    const toolId = readOptionalString(message.toolCallId) ?? baseId;
    return [createNormalizedMessage({
      ...base, id: `${baseId}_res`, kind: 'tool_result',
      toolId,
      content: readTextContent(message.content) ?? '',
      isError: message.isError === true,
    })];
  }

  // omp injects `role:'developer'` messages (<system-reminder> continuity nudges,
  // incomplete-todo reminders) as model-directed instructions — internal plumbing,
  // not conversation. Without this they render as assistant text with raw tags.
  if (message.role === 'developer') {
    return [];
  }

  const content = Array.isArray(message.content) ? message.content : [];
  if (content.length === 0) {
    return [];
  }
  const role = message.role === 'user' ? 'user' : 'assistant';
  const out: NormalizedMessage[] = [];

  content.forEach((rawPart: unknown, i: number) => {
    const part = readObjectRecord(rawPart);
    if (!part) {
      return;
    }
    if (part.type === 'text') {
      const text = readOptionalString(part.text);
      if (text) {
        out.push(createNormalizedMessage({ ...base, id: `${baseId}_t${i}`, kind: 'text', role, content: text }));
      }
    } else if (part.type === 'thinking') {
      const text = readOptionalString(part.thinking) ?? readOptionalString(part.text);
      if (text) {
        out.push(createNormalizedMessage({ ...base, id: `${baseId}_k${i}`, kind: 'thinking', content: text }));
      }
    } else if (part.type === 'toolCall') {
      const toolId = readOptionalString(part.id) || `${baseId}_u${i}`;
      out.push(createNormalizedMessage({
        ...base,
        id: toolId,
        kind: 'tool_use',
        toolName: readOptionalString(part.name) ?? 'tool',
        toolId,
        toolInput: part.arguments,
      }));
    }
  });

  return out;
}

async function readOmpJsonl(filePath: string): Promise<AnyRecord[]> {
  const entries: AnyRecord[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = readObjectRecord(JSON.parse(trimmed));
      if (parsed) {
        entries.push(parsed);
      }
    } catch {
      // A truncated final line is normal while omp is mid-write — skip it.
    }
  }
  return entries;
}

/**
 * Keeps only the entries on the session's ACTIVE branch.
 *
 * An omp jsonl is a tree, not a list: every entry carries `parentId`, and the
 * terminal can walk back up and continue from an earlier point — which appends a
 * second child under that parent instead of rewriting the file. Two omp processes
 * on one session do the same thing. Read in file order, the result reads as two
 * interleaved conversations.
 *
 * The newest CONVERSATION entry is on the branch that is live now, so its ancestor
 * chain is what the omp TUI shows. Everything off that chain is an abandoned branch
 * and is dropped. Entries with no parent (the `session`/`title` headers) always stay.
 *
 * This no-ops on the normal single-branch transcript — the walk only runs when the
 * file actually forks. Every ambiguous case fails soft back to file order: showing
 * an interleaved transcript is recoverable, hiding half of one is not.
 */
// The entry types this reader turns into visible messages. Everything else omp
// writes — `custom` tool-lifecycle markers, `thinking_level_change`, `title_change`
// — carries a parentId too, and that matters: an EXITING omp process writes
// `custom/session_exit` under the head IT held, which in the two-writer case is the
// ABANDONED branch. Taking the last parented entry as the head therefore selects the
// dead branch (measured on a real forked transcript: 269 entries from the exit
// marker's chain against 525 from the last message's).
const RENDERED_ENTRY_TYPES = new Set(['message', 'custom_message']);

// A tree parent, or null for the file headers (`session`, `title`) which carry no
// `parentId` at all and always stay. An explicit `parentId: null` is a real ROOT
// entry, so it gets a key of its own — two roots are a fork like any other.
const ROOT_PARENT = '\u0000root';

function branchParentOf(entry: AnyRecord): string | null {
  if (entry.parentId === undefined) {
    return null;
  }
  return typeof entry.parentId === 'string' ? entry.parentId : ROOT_PARENT;
}

function selectActiveBranch(entries: AnyRecord[]): AnyRecord[] {
  const childCount = new Map<string, number>();
  let forked = false;
  for (const entry of entries) {
    const parent = branchParentOf(entry);
    if (parent === null) {
      continue;
    }
    const next = (childCount.get(parent) ?? 0) + 1;
    childCount.set(parent, next);
    if (next > 1) {
      forked = true;
    }
  }
  if (!forked) {
    return entries;
  }

  const byId = new Map<string, AnyRecord>();
  for (const entry of entries) {
    if (typeof entry.id === 'string') {
      byId.set(entry.id, entry);
    }
  }
  // Walk up from the newest entry the reader actually renders — see the note above.
  let head: AnyRecord | null = null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (branchParentOf(entry) !== null
      && typeof entry.id === 'string'
      && typeof entry.type === 'string'
      && RENDERED_ENTRY_TYPES.has(entry.type)) {
      head = entry;
      break;
    }
  }

  const onBranch = new Set<string>();
  let cursor: AnyRecord | null = head;
  while (cursor && typeof cursor.id === 'string' && !onBranch.has(cursor.id)) {
    onBranch.add(cursor.id);
    if (typeof cursor.parentId !== 'string') {
      break; // reached the root
    }
    const parent = byId.get(cursor.parentId);
    if (!parent) {
      return entries; // a dropped malformed line broke the chain — fail soft
    }
    cursor = parent;
  }
  if (onBranch.size === 0) {
    return entries; // no renderable head — fail soft
  }

  return entries.filter((entry) => (
    branchParentOf(entry) === null // headers
    || typeof entry.id !== 'string' // cannot be placed in the tree — keep it
    || onBranch.has(entry.id)
  ));
}

const EMPTY_PAGE: FetchHistoryResult = { messages: [], total: 0, hasMore: false, offset: 0, limit: null };

// The IProviderSessions half of the omp provider, consumed by `omp.provider.ts`
// and by the providers module's history/session services through it.
export class OmpSessionsProvider implements IProviderSessions {
  /**
   * Normalizes a live ACP `session/update` notification (the `{sessionId, update}`
   * envelope forwarded by the omp runtime) into NormalizedMessages.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }
    if (raw.update && typeof raw.update === 'object') {
      return normalizeAcpUpdate(raw, sessionId);
    }
    return normalizeJsonlMessage(raw, sessionId);
  }

  async fetchHistory(sessionId: string, options: FetchHistoryOptions = {}): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    // The jsonl is named by the native id; app-created sessions pass the app id
    // as sessionId + the native id as providerSessionId (matches claude-sessions).
    const providerSessionId = options.providerSessionId ?? sessionId;
    let entries: AnyRecord[];
    try {
      const filePath = sessionsDb.getSessionByProviderSessionId(providerSessionId)?.jsonl_path
        ?? sessionsDb.getSessionById(sessionId)?.jsonl_path
        ?? await locateOmpSessionFile(providerSessionId);
      if (!filePath) {
        return EMPTY_PAGE;
      }
      entries = await readOmpJsonl(filePath);
    } catch (error) {
      console.warn(`[OmpProvider] Failed to load session ${sessionId}:`, error instanceof Error ? error.message : error);
      return EMPTY_PAGE;
    }

    const normalized: NormalizedMessage[] = [];
    for (const entry of selectActiveBranch(entries)) {
      normalized.push(...normalizeJsonlMessage(entry, sessionId));
    }

    // Backfill tool_result onto its tool_use so the UI renders one card (same
    // pass as the other providers' history readers).
    const resultById = new Map<string, NormalizedMessage>();
    for (const msg of normalized) {
      if (msg.kind === 'tool_result' && msg.toolId) {
        resultById.set(msg.toolId, msg);
      }
    }
    for (const msg of normalized) {
      if (msg.kind === 'tool_use' && msg.toolId) {
        const result = resultById.get(msg.toolId);
        if (result) {
          msg.toolResult = { content: result.content, isError: result.isError };
        }
      }
    }

    const total = normalized.filter((m) => m.kind !== 'tool_result').length;
    const { page, hasMore } = sliceTailPage(normalized, limit, offset);

    return { messages: page, total, hasMore, offset: Math.max(0, offset), limit };
  }
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

type OmpTodo = { content: string; status: string; phase?: string };
type OmpImageRef = { hash: string; mimeType: string };

const liveTodoTools = new Set<string>();
const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function liveToolKey(sessionId: string | null, toolId: string): string {
  return `${sessionId ?? ''}\u0000${toolId}`;
}

function flattenOmpPhases(details: AnyRecord | null): OmpTodo[] | null {
  const phases = details && Array.isArray(details.phases) ? details.phases : null;
  if (!phases) {
    return null;
  }

  const todos: OmpTodo[] = [];
  for (const rawPhase of phases) {
    const phase = readObjectRecord(rawPhase);
    const phaseName = phase && readOptionalString(phase.name);
    if (!phase || !Array.isArray(phase.tasks)) {
      continue;
    }
    for (const rawTask of phase.tasks) {
      const task = readObjectRecord(rawTask);
      const content = task && readOptionalString(task.content);
      if (content) {
        todos.push({
          content,
          status: readOptionalString(task.status) ?? 'pending',
          ...(phaseName ? { phase: phaseName } : {}),
        });
      }
    }
  }
  return todos.length > 0 ? todos : null;
}

function readOmpTodoInput(input: AnyRecord | null): OmpTodo[] {
  if (!input) {
    return [];
  }

  const operations = Array.isArray(input.ops) ? input.ops : [input];
  const todos: OmpTodo[] = [];
  for (const rawOperation of operations) {
    const operation = readObjectRecord(rawOperation);
    if (!operation) {
      continue;
    }
    const replacement = flattenOmpPhases(operation);
    if (replacement) {
      todos.push(...replacement);
      continue;
    }
    const lists = Array.isArray(operation.list)
      ? operation.list
      : (Array.isArray(operation.items) ? [{ items: operation.items, phase: operation.phase }] : []);
    for (const rawList of lists) {
      const list = readObjectRecord(rawList);
      if (!list || !Array.isArray(list.items)) {
        continue;
      }
      const phase = readOptionalString(list.phase);
      for (const rawItem of list.items) {
        const item = readObjectRecord(rawItem);
        const content = typeof rawItem === 'string'
          ? rawItem
          : (item && (readOptionalString(item.content) ?? readOptionalString(item.task)));
        if (content) {
          todos.push({
            content,
            status: item ? (readOptionalString(item.status) ?? 'pending') : 'pending',
            ...(phase ? { phase } : {}),
          });
        }
      }
    }
  }
  return todos;
}

function isOmpTodoInput(input: AnyRecord | null): boolean {
  if (!input) {
    return false;
  }
  if (Array.isArray(input.ops)) {
    return input.ops.some((operation) => typeof readObjectRecord(operation)?.op === 'string');
  }
  return typeof input.op === 'string'
    && (
      Array.isArray(input.list)
      || Array.isArray(input.items)
      || typeof input.task === 'string'
      || typeof input.phase === 'string'
    );
}

function readOmpAskInput(args: AnyRecord): AnyRecord | null {
  const questions = (Array.isArray(args.questions) ? args.questions : [])
    .map((rawQuestion: unknown) => {
      const question = readObjectRecord(rawQuestion);
      const options = question && Array.isArray(question.options) ? question.options : [];
      return {
        question: question ? (readOptionalString(question.question) ?? '') : '',
        header: question
          ? (readOptionalString(question.header) ?? readOptionalString(question.id)?.replace(/[_-]+/g, ' '))
          : undefined,
        multiSelect: question?.multi === true,
        options: options
          .map((rawOption: unknown) => {
            const option = readObjectRecord(rawOption);
            return {
              label: option ? (readOptionalString(option.label) ?? '') : '',
              description: option ? readOptionalString(option.description) : undefined,
            };
          })
          .filter((option) => option.label),
      };
    })
    .filter((question) => question.question);
  return questions.length > 0 ? { questions } : null;
}

function mapOmpTool(name: string, rawArgs: unknown): { toolName: string; toolInput: unknown } {
  const args = readObjectRecord(rawArgs);
  if (!args) {
    return { toolName: name, toolInput: rawArgs };
  }
  if (isOmpTodoInput(args)) {
    return { toolName: 'TodoWrite', toolInput: { todos: readOmpTodoInput(args) } };
  }

  const intent = readOptionalString(args.i)
    ?? readOptionalString(args._i)
    ?? readOptionalString(args.agent__intent);
  switch (name) {
    case 'bash':
      return {
        toolName: 'Bash',
        toolInput: {
          command: args.command,
          cwd: args.cwd,
          timeout: args.timeout,
          ...(intent ? { description: intent } : {}),
        },
      };
    case 'read': {
      const filePath = readOptionalString(args.path);
      return filePath && !filePath.includes('://')
        ? { toolName: 'Read', toolInput: { file_path: filePath } }
        : { toolName: name, toolInput: rawArgs };
    }
    case 'write': {
      const filePath = readOptionalString(args.path);
      return filePath && !filePath.includes('://')
        ? { toolName: 'Write', toolInput: { file_path: filePath, content: args.content } }
        : { toolName: name, toolInput: rawArgs };
    }
    case 'ask': {
      const toolInput = readOmpAskInput(args);
      return toolInput
        ? { toolName: 'AskUserQuestion', toolInput }
        : { toolName: name, toolInput: rawArgs };
    }
    case 'todo':
    case 'todo_write':
      return { toolName: 'TodoWrite', toolInput: { todos: readOmpTodoInput(args) } };
    default:
      return { toolName: name, toolInput: rawArgs };
  }
}

function ompLiveToolName(input: AnyRecord | null): string | null {
  if (!input) {
    return null;
  }
  if (isOmpTodoInput(input)) {
    return 'todo';
  }
  if (
    typeof input.code === 'string'
    && typeof input.language === 'string'
    && typeof input.title === 'string'
  ) {
    return 'eval';
  }
  return typeof input.command === 'string' ? 'bash' : null;
}

function parseOmpImageRef(part: AnyRecord): OmpImageRef | null {
  const ref = readOptionalString(part.data);
  const rawMimeType = readOptionalString(part.mimeType);
  if (!ref || (rawMimeType && !ALLOWED_IMAGE_MIME.has(rawMimeType))) {
    return null;
  }
  const hash = ref.startsWith('blob:') ? ref.split(':').pop() : ref;
  if (!hash || !/^[a-f0-9]{16,128}$/i.test(hash)) {
    return null;
  }
  return { hash, mimeType: rawMimeType ?? 'image/png' };
}

async function resolveOmpImage(ref: OmpImageRef): Promise<{ data: string; mimeType: string } | null> {
  const basePath = path.join(os.homedir(), '.omp', 'agent', 'blobs', ref.hash);
  for (const filePath of [basePath, `${basePath}.png`]) {
    try {
      if ((await fs.promises.stat(filePath)).size > MAX_INLINE_IMAGE_BYTES) {
        return null;
      }
      const data = (await fs.promises.readFile(filePath)).toString('base64');
      return { data: `data:${ref.mimeType};base64,${data}`, mimeType: ref.mimeType };
    } catch {
      // Try the alternate blob path.
    }
  }
  return null;
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
    const rawInput = readObjectRecord(update.rawInput);
    const knownToolName = ompLiveToolName(rawInput);
    if (knownToolName === 'todo') {
      liveTodoTools.add(liveToolKey(sessionId, toolId));
    }
    const mapped = knownToolName ? mapOmpTool(knownToolName, update.rawInput) : null;
    return [createNormalizedMessage({
      ...base,
      kind: 'tool_use',
      toolName: mapped?.toolName
        ?? readOptionalString(update.title)
        ?? readOptionalString(update.kind)
        ?? 'tool',
      toolId,
      toolInput: mapped?.toolInput ?? update.rawInput,
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
    const todoKey = liveToolKey(sessionId, toolId);
    const isTodo = liveTodoTools.delete(todoKey);
    const rawOutput = readObjectRecord(update.rawOutput);
    const todos = isTodo ? flattenOmpPhases(readObjectRecord(rawOutput?.details)) : null;
    // ACP carries the result under `content` (ToolCallContent[]); rawOutput/
    // output/result are alternate fields. Preserve structured details separately
    // so shared tool renderers can use them without parsing display text.
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
      toolUseResult: todos ? { todos } : rawOutput?.details,
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

type OmpAdvisorNote = { note: string; severity?: string; advisor?: string };

function readOmpAdvisorNotes(entry: AnyRecord): OmpAdvisorNote[] {
  if (entry.type !== 'custom_message' || entry.customType !== 'advisor') {
    return [];
  }
  const details = readObjectRecord(entry.details);
  if (!details) {
    return [];
  }
  const rawNotes = Array.isArray(details.notes) ? details.notes : [details];
  return rawNotes.flatMap((rawNote: unknown) => {
    const note = readObjectRecord(rawNote);
    const text = note && readOptionalString(note.note);
    return text
      ? [{
          note: text,
          severity: readOptionalString(note.severity) ?? undefined,
          advisor: readOptionalString(note.advisor) ?? undefined,
        }]
      : [];
  });
}

function advisorNotificationSummary(note: OmpAdvisorNote): string {
  const source = note.advisor ? `Advisor ${note.advisor}` : 'Advisor';
  return `${source}${note.severity ? ` (${note.severity})` : ''}: ${note.note}`;
}

function normalizeAdvisorEntry(entry: AnyRecord, sessionId: string | null): NormalizedMessage[] {
  const timestamp = readOptionalString(entry.timestamp) ?? new Date().toISOString();
  const baseId = readOptionalString(entry.id) ?? generateMessageId('omp_advisor');
  return readOmpAdvisorNotes(entry).map((note, index) => createNormalizedMessage({
    sessionId,
    timestamp,
    provider: PROVIDER,
    id: `${baseId}_advisor_${index}`,
    kind: 'task_notification',
    status: note.severity ?? 'advisor',
    summary: advisorNotificationSummary(note),
    advisor: note.advisor,
    advisorNote: note.note,
  }));
}

/**
 * Maps one persisted jsonl entry to NormalizedMessages. A single entry can carry
 * several content parts, so it can expand into several messages.
 */
function normalizeJsonlMessage(entry: AnyRecord, sessionId: string | null): NormalizedMessage[] {
  if (entry.type === 'custom_message' && entry.customType === 'collab-prompt') {
    const content = readOptionalString(entry.content);
    if (!content) {
      return [];
    }
    const from = readOptionalString(readObjectRecord(entry.details)?.from);
    return [createNormalizedMessage({
      sessionId,
      timestamp: readOptionalString(entry.timestamp) ?? new Date().toISOString(),
      provider: PROVIDER,
      id: readOptionalString(entry.id) ?? generateMessageId(PROVIDER),
      kind: 'text',
      role: 'user',
      content: from ? `${from}: ${content}` : content,
    })];
  }
  if (entry.type === 'custom_message' && entry.customType === 'advisor') {
    return normalizeAdvisorEntry(entry, sessionId);
  }
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

  if (message.role === 'toolResult') {
    const toolId = readOptionalString(message.toolCallId) ?? baseId;
    const todos = message.toolName === 'todo' || message.toolName === 'todo_write'
      ? flattenOmpPhases(readObjectRecord(message.details))
      : null;
    return [createNormalizedMessage({
      ...base,
      id: `${baseId}_res`,
      kind: 'tool_result',
      toolId,
      content: readTextContent(message.content) ?? '',
      isError: message.isError === true,
      toolUseResult: todos ? { todos } : message.details,
    })];
  }

  // Developer-role continuity and todo reminders are model instructions, not
  // conversation rows.
  if (message.role === 'developer') {
    return [];
  }

  const content = Array.isArray(message.content) ? message.content : [];
  if (content.length === 0) {
    return [];
  }
  const role = message.role === 'user' ? 'user' : 'assistant';
  const out: NormalizedMessage[] = [];
  const images: OmpImageRef[] = [];

  content.forEach((rawPart: unknown, index: number) => {
    const part = readObjectRecord(rawPart);
    if (!part) {
      return;
    }
    if (part.type === 'text') {
      const text = readOptionalString(part.text);
      if (text) {
        out.push(createNormalizedMessage({
          ...base,
          id: `${baseId}_t${index}`,
          kind: 'text',
          role,
          content: text,
        }));
      }
    } else if (part.type === 'thinking') {
      const text = readOptionalString(part.thinking) ?? readOptionalString(part.text);
      if (text) {
        out.push(createNormalizedMessage({
          ...base,
          id: `${baseId}_k${index}`,
          kind: 'thinking',
          content: text,
        }));
      }
    } else if (part.type === 'toolCall') {
      const toolId = readOptionalString(part.id) || `${baseId}_u${index}`;
      const mapped = mapOmpTool(readOptionalString(part.name) ?? 'tool', part.arguments);
      out.push(createNormalizedMessage({
        ...base,
        id: toolId,
        kind: 'tool_use',
        toolName: mapped.toolName,
        toolId,
        toolInput: mapped.toolInput,
      }));
    } else if (part.type === 'image') {
      const image = parseOmpImageRef(part);
      if (image) {
        images.push(image);
      }
    }
  });

  if (images.length > 0) {
    const textMessage = out.find((messageRow) => messageRow.kind === 'text');
    if (textMessage) {
      textMessage.images = images;
    } else {
      out.push(createNormalizedMessage({
        ...base,
        id: `${baseId}_img`,
        kind: 'text',
        role,
        content: '',
        images,
      }));
    }
  }
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
// Branch-head visibility must match normalization exactly. A developer reminder
// or empty message carries parentId but renders no row, so it cannot decide
// which fork is active.
function isRenderedEntry(entry: AnyRecord): boolean {
  return normalizeJsonlMessage(entry, null).length > 0;
}

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
      && isRenderedEntry(entry)) {
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

function attachAskAnswers(entries: AnyRecord[], normalized: NormalizedMessage[]): void {
  const answersByToolId = new Map<string, Record<string, string>>();
  for (const entry of entries) {
    const message = readObjectRecord(entry.message);
    if (!message || message.role !== 'toolResult' || message.toolName !== 'ask') {
      continue;
    }
    const toolId = readOptionalString(message.toolCallId);
    const details = readObjectRecord(message.details);
    if (!toolId || !details) {
      continue;
    }

    const answers: Record<string, string> = {};
    for (const rawAnswer of Array.isArray(details.results) ? details.results : [details]) {
      const answer = readObjectRecord(rawAnswer);
      const question = answer && readOptionalString(answer.question);
      if (!answer || !question) {
        continue;
      }
      const selectedOptions = Array.isArray(answer.selectedOptions)
        ? answer.selectedOptions.filter((option: unknown): option is string => typeof option === 'string')
        : [];
      const value = selectedOptions.length > 0
        ? selectedOptions.join(', ')
        : readOptionalString(answer.customInput);
      if (value) {
        answers[question] = value;
      }
    }
    if (Object.keys(answers).length > 0) {
      answersByToolId.set(toolId, answers);
    }
  }

  for (const message of normalized) {
    if (message.kind !== 'tool_use' || message.toolName !== 'AskUserQuestion' || !message.toolId) {
      continue;
    }
    const answers = answersByToolId.get(message.toolId);
    const input = readObjectRecord(message.toolInput);
    if (answers && input) {
      input.answers = answers;
    }
  }
}

async function readOmpAdvisorSidecars(
  mainFilePath: string,
  sessionId: string | null,
): Promise<NormalizedMessage[]> {
  const sidecarDirectory = mainFilePath.replace(/\.jsonl$/, '');
  let sidecarNames: string[];
  try {
    sidecarNames = (await fs.promises.readdir(sidecarDirectory))
      .filter((name) => /^__advisor(\..+)?\.jsonl$/.test(name))
      .sort();
  } catch {
    return [];
  }

  const notifications: NormalizedMessage[] = [];
  for (const sidecarName of sidecarNames) {
    const advisor = sidecarName
      .slice('__advisor'.length, -'.jsonl'.length)
      .replace(/^\./, '') || undefined;
    let entries: AnyRecord[];
    try {
      entries = selectActiveBranch(await readOmpJsonl(path.join(sidecarDirectory, sidecarName)));
    } catch {
      continue;
    }

    const seenNotes = new Set<string>();
    for (const entry of entries) {
      if (entry.type !== 'message') {
        continue;
      }
      const message = readObjectRecord(entry.message);
      const content = message && Array.isArray(message.content) ? message.content : [];
      content.forEach((rawPart: unknown, index: number) => {
        const part = readObjectRecord(rawPart);
        const argumentsRecord = part?.type === 'toolCall' && part.name === 'advise'
          ? readObjectRecord(part.arguments)
          : null;
        const noteText = argumentsRecord && readOptionalString(argumentsRecord.note);
        if (!noteText || seenNotes.has(noteText)) {
          return;
        }
        seenNotes.add(noteText);
        const note: OmpAdvisorNote = {
          note: noteText,
          advisor,
          severity: readOptionalString(argumentsRecord.severity) ?? undefined,
        };
        notifications.push(createNormalizedMessage({
          sessionId,
          timestamp: readOptionalString(entry.timestamp) ?? new Date().toISOString(),
          provider: PROVIDER,
          id: `advisor_${advisor ?? 'main'}_${readOptionalString(part?.id) ?? `${notifications.length}_${index}`}`,
          kind: 'task_notification',
          status: note.severity ?? 'advisor',
          summary: advisorNotificationSummary(note),
          advisor: note.advisor,
          advisorNote: note.note,
        }));
      });
    }
  }
  return notifications;
}

/**
 * Reads one OMP transcript into the same normalized rows used by chat history.
 *
 * OmpSessionsProvider uses it for paginated REST history. Conversation search
 * uses it without resolving image blobs, so search, export, and the live chat
 * all match against the same active branch and tool/advisor normalization.
 */
export async function readNormalizedOmpHistory(
  filePath: string,
  sessionId: string | null,
): Promise<NormalizedMessage[]> {
  const activeEntries = selectActiveBranch(await readOmpJsonl(filePath));
  const normalized: NormalizedMessage[] = [];
  for (const entry of activeEntries) {
    normalized.push(...normalizeJsonlMessage(entry, sessionId));
  }
  attachAskAnswers(activeEntries, normalized);

  const resultById = new Map<string, NormalizedMessage>();
  for (const message of normalized) {
    if (message.kind === 'tool_result' && message.toolId) {
      resultById.set(message.toolId, message);
    }
  }
  for (const message of normalized) {
    if (message.kind !== 'tool_use' || !message.toolId) {
      continue;
    }
    const result = resultById.get(message.toolId);
    if (!result) {
      continue;
    }
    message.toolResult = {
      content: result.content,
      isError: result.isError,
      ...(result.toolUseResult !== undefined ? { toolUseResult: result.toolUseResult } : {}),
    };
    const resultDetails = readObjectRecord(result.toolUseResult);
    if (message.toolName === 'TodoWrite' && Array.isArray(resultDetails?.todos)) {
      message.toolInput = { todos: resultDetails.todos };
    }
  }

  const advisorKeys = new Set(
    normalized
      .filter((message) => message.kind === 'task_notification' && typeof message.advisorNote === 'string')
      .map((message) => `${String(message.advisor ?? '')}\u0000${message.advisorNote}`),
  );
  for (const notification of await readOmpAdvisorSidecars(filePath, sessionId)) {
    const key = `${String(notification.advisor ?? '')}\u0000${String(notification.advisorNote ?? '')}`;
    if (!advisorKeys.has(key)) {
      normalized.push(notification);
      advisorKeys.add(key);
    }
  }
  normalized.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return normalized.filter((message) => message.kind !== 'tool_result');
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
    let filePath: string | null = null;
    let renderable: NormalizedMessage[];
    try {
      filePath = sessionsDb.getSessionByProviderSessionId(providerSessionId)?.jsonl_path
        ?? sessionsDb.getSessionById(sessionId)?.jsonl_path
        ?? await locateOmpSessionFile(providerSessionId);
      if (!filePath) {
        return EMPTY_PAGE;
      }
      renderable = await readNormalizedOmpHistory(filePath, sessionId);
    } catch (error) {
      console.warn(`[OmpProvider] Failed to load session ${sessionId}:`, error instanceof Error ? error.message : error);
      return EMPTY_PAGE;
    }

    const total = renderable.length;
    const { page, hasMore } = sliceTailPage(renderable, limit, offset);

    // Blob reads happen after pagination so a tail request never loads every
    // image in a long transcript.
    for (const message of page) {
      const imageRefs = message.images as OmpImageRef[] | undefined;
      if (!Array.isArray(imageRefs) || imageRefs.length === 0) {
        continue;
      }
      const images = (await Promise.all(imageRefs.map(resolveOmpImage)))
        .filter((image): image is { data: string; mimeType: string } => image !== null);
      message.images = images.length > 0 ? images : undefined;
    }

    return { messages: page, total, hasMore, offset: Math.max(0, offset), limit };
  }
}

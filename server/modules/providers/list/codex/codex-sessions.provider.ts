import fsSync from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import { codexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';
import { parseFilesInputTag, toImageAttachments } from '@/shared/image-attachments.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import { prepareTranscriptMessages } from '@/shared/message-unification.js';
import type {
  AnyRecord,
  FetchHistoryOptions,
  FetchHistoryResult,
  MemoryCitation,
  NormalizedMessage,
  SubagentActivity,
  SubagentInfo,
} from '@/shared/types.js';
import {
  AppError,
  createNormalizedMessage,
  generateMessageId,
  readObjectRecord,
  sliceTailPage,
  truncateSubagentActivity,
} from '@/shared/utils.js';

const PROVIDER = 'codex';

/**
 * How far up the `~/.codex/sessions/<year>/<month>/<day>` tree a subagent
 * rollout is searched for when it is not next to its parent. Spawned agents
 * are written seconds after the parent, so one directory level up (the month)
 * already covers a run that crosses midnight.
 */
const SUBAGENT_LOOKUP_PARENT_LEVELS = 2;

/**
 * Upper bound on how much of a subagent's timeline is sent to the client. A
 * long-running agent can record hundreds of tool calls, and the transcript only
 * ever shows them behind a collapsed header, so shipping the whole history on
 * every load costs far more than it shows.
 */
const MAX_TRANSMITTED_SUBAGENT_ACTIVITIES = 200;

type CodexHistoryResult = {
  messages: AnyRecord[];
  total?: number;
  hasMore?: boolean;
  offset?: number;
  limit?: number | null;
  tokenUsage?: unknown;
};

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isVisibleCodexUserMessage(payload: AnyRecord | null | undefined): boolean {
  if (!payload || payload.type !== 'user_message') {
    return false;
  }

  if (payload.kind && payload.kind !== 'plain') {
    return false;
  }

  return typeof payload.message === 'string' && payload.message.trim().length > 0;
}

/**
 * Follows which turn a Codex rollout is inside as its rows stream past.
 *
 * Codex writes no per-row id — every line is `{timestamp, type, payload}` and
 * the `user_message` event that carries a prompt has no identity of its own —
 * so a turn id is the only durable address a user message has. Turns are
 * bracketed by rows that do carry `turn_id`: `task_started` opens one,
 * `turn_context` restates it, `task_complete` closes it, and the prompt is
 * written between them. That id is also exactly what `thread/fork` cuts at,
 * which is what makes "edit this message" and "fork from here" addressable
 * for Codex at all.
 *
 * `thread_rolled_back` retires the last N turns in place: the rows stay in the
 * file, but the turns are no longer part of the thread and the fork endpoint
 * refuses to cut at one. They are tracked here so a retired turn is never
 * offered as an anchor, rather than discovered when the fork fails.
 */
function createCodexTurnTracker() {
  /** Turn ids still part of the conversation, oldest first. */
  const liveTurnIds: string[] = [];
  const seenTurnIds = new Set<string>();
  const rolledBackTurnIds = new Set<string>();
  let currentTurnId: string | undefined;

  return {
    /** Feeds one rollout row in. */
    observe(entryType: unknown, payload: AnyRecord): void {
      if (entryType === 'event_msg' && payload.type === 'thread_rolled_back') {
        const retiredTurns = Number(payload.num_turns);
        for (let retired = 0; retired < retiredTurns && liveTurnIds.length > 0; retired++) {
          rolledBackTurnIds.add(liveTurnIds.pop() as string);
        }
        currentTurnId = undefined;
        return;
      }

      const turnId = readNonEmptyString(payload.turn_id);
      if (!turnId) {
        return;
      }
      currentTurnId = turnId;
      if (!seenTurnIds.has(turnId)) {
        seenTurnIds.add(turnId);
        liveTurnIds.push(turnId);
      }
    },
    /** The turn the rows being read belong to, or undefined outside one. */
    getCurrentTurnId(): string | undefined {
      return currentTurnId;
    },
    getLiveTurnIds(): string[] {
      return liveTurnIds;
    },
    isRolledBack(turnId: string): boolean {
      return rolledBackTurnIds.has(turnId);
    },
  };
}

/**
 * Reads the turns a Codex rollout still contains, oldest first.
 *
 * A separate pass rather than a by-product of the transcript reader: this runs
 * once when a message is edited, while the reader runs on every history fetch,
 * and both share the one rule for what a live turn is.
 */
async function readCodexLiveTurnIds(filePath: string): Promise<string[]> {
  const turns = createCodexTurnTracker();
  const stream = fsSync.createReadStream(filePath);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    let entry: AnyRecord;
    try {
      entry = JSON.parse(line) as AnyRecord;
    } catch {
      continue;
    }
    const payload = readObjectRecord(entry.payload);
    if (payload) {
      turns.observe(entry.type, payload);
    }
  }

  return turns.getLiveTurnIds();
}

/**
 * Reads the image attachments Codex records on `user_message` events.
 * Turns sent with `local_image` input items land in `local_images` as file
 * paths (verified against real rollout JSONL); the `images` array can carry
 * base64 data URLs, which are passed through as inline `data` attachments so
 * the UI can preview them without a file lookup.
 *
 * Exported for tests.
 */
export function extractCodexUserImages(
  payload: AnyRecord | null | undefined,
): Array<{ path?: string; data?: string }> | undefined {
  if (!payload) {
    return undefined;
  }

  const candidates = [
    ...(Array.isArray(payload.local_images) ? payload.local_images : []),
    ...(Array.isArray(payload.images) ? payload.images : []),
  ];

  const attachments: Array<{ path?: string; data?: string }> = [];
  for (const entry of candidates) {
    if (typeof entry !== 'string' || !entry.trim()) {
      continue;
    }
    if (entry.startsWith('data:')) {
      attachments.push({ data: entry });
    } else {
      attachments.push(...toImageAttachments([entry]));
    }
  }

  return attachments.length > 0 ? attachments : undefined;
}

function extractCodexTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : '';
  }

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      const record = item as AnyRecord;
      if (
        (record.type === 'input_text' || record.type === 'output_text' || record.type === 'text')
        && typeof record.text === 'string'
      ) {
        return record.text;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Reads the markdown out of Codex's `<proposed_plan>` envelope.
 *
 * Codex delivers a plan as a wrapped assistant message while Claude delivers
 * one as an `ExitPlanMode` call. Recognizing the envelope here lets both end up
 * on the same plan card instead of one provider showing a card and the other
 * showing prose with a stray tag in it. The closing tag is optional because a
 * streamed plan exposes the opening tag first.
 *
 * Exported for tests.
 */
export function readCodexProposedPlan(text: string): string | null {
  const openingTag = /^\s*<proposed_plan>[ \t]*(?:\r?\n)?/i;
  if (!openingTag.test(text)) {
    return null;
  }

  const body = text
    .replace(openingTag, '')
    .replace(/(?:\r?\n)?[ \t]*<\/proposed_plan>\s*$/i, '')
    .trim();

  return body || null;
}

/**
 * The block Codex appends to a reply that leaned on its memory files. It is
 * always the last thing in the message and is meant for programmatic parsing,
 * so it reads as raw XML when left in the prose.
 */
const CODEX_MEMORY_CITATION_BLOCK = /<oai-mem-citation>([\s\S]*?)<\/oai-mem-citation>\s*$/i;

/**
 * Lifts Codex's memory citations out of an assistant reply.
 *
 * The block names the memory files and line ranges the answer drew on, which is
 * worth showing — but as a footnote under the reply, not as markup inside it.
 * The trailing `<rollout_ids>` list is dropped: those are handles to earlier
 * rollouts that the transcript view has no way to open.
 *
 * Exported for tests.
 */
export function readCodexMemoryCitations(text: string): { text: string; memoryCitations?: MemoryCitation[] } {
  const block = CODEX_MEMORY_CITATION_BLOCK.exec(text);
  if (!block) {
    return { text };
  }

  const entries = /<citation_entries>([\s\S]*?)<\/citation_entries>/i.exec(block[1])?.[1] ?? '';
  const memoryCitations: MemoryCitation[] = [];
  for (const line of entries.split('\n')) {
    const entry = line.trim();
    if (!entry) {
      continue;
    }

    const noteMarker = entry.indexOf('|note=');
    const source = (noteMarker === -1 ? entry : entry.slice(0, noteMarker)).trim();
    if (!source) {
      continue;
    }

    const note = noteMarker === -1
      ? ''
      : entry.slice(noteMarker + '|note='.length).trim().replace(/^\[/, '').replace(/\]$/, '').trim();
    memoryCitations.push(note ? { source, note } : { source });
  }

  const prose = text.slice(0, block.index).trimEnd();
  return memoryCitations.length > 0 ? { text: prose, memoryCitations } : { text: prose };
}

function extractCodexToolOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }

  if (!Array.isArray(output)) {
    return output == null ? '' : JSON.stringify(output);
  }

  return output
    .map((item) => {
      const record = readObjectRecord(item);
      return typeof record?.text === 'string' ? record.text : '';
    })
    .filter(Boolean)
    .join('');
}

// ─── Codex "code mode" exec scripts ─────────────────────────────────────────
// Newer Codex builds (and every Sol-family model) stop calling shell/patch
// tools directly. Instead they emit one `exec` custom tool call whose input is
// a small JavaScript program that awaits `tools.<name>({...})`. Persisting that
// program verbatim is what makes the transcript read as raw machinery, so it is
// parsed back into the operations it performs.

type CodexExecOperation =
  | { kind: 'shell'; command: string; justification?: string }
  | { kind: 'stdin'; chars: string }
  | { kind: 'patch'; patch: string }
  | { kind: 'search'; queries: string[] }
  | { kind: 'plan'; todos: CodexPlanTodo[] };

/** One step of a checklist, in the shape the shared todo renderer consumes. */
type CodexPlanTodo = { content: string; status: string };

/**
 * Decodes one JavaScript string literal (single, double or backtick quoted).
 *
 * Template literals with `${}` interpolation are returned with the expression
 * text intact — the transcript has no bindings to evaluate, and showing the
 * raw template is still far more readable than the surrounding program.
 */
function decodeJavaScriptStringLiteral(literal: string): string {
  if (literal.startsWith('"')) {
    try {
      return JSON.parse(literal) as string;
    } catch {
      return literal.slice(1, -1);
    }
  }

  return literal
    .slice(1, -1)
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([\\'`])/g, '$1');
}

/**
 * Returns the source of the argument list of the call that opens at
 * `openParenIndex`, skipping over parens that appear inside string literals.
 *
 * A plain regex cannot be used here: shell commands routinely embed `(`/`)`
 * and quotes, so the argument object has to be found by balancing.
 */
function readCallArguments(source: string, openParenIndex: number): string | null {
  let depth = 0;
  let quote: string | null = null;

  for (let index = openParenIndex; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (character === '\\') {
        index += 1;
        continue;
      }
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }

    if (character === '(') {
      depth += 1;
      continue;
    }

    if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openParenIndex + 1, index);
      }
    }
  }

  return null;
}

/** Reads `key: "value"` / `"key": "value"` out of an object-literal source. */
function readStringProperty(objectSource: string, key: string): string | undefined {
  const pattern = new RegExp(
    `(?:["']${key}["']|\\b${key})\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)`,
    's',
  );
  const match = pattern.exec(objectSource);
  return match ? decodeJavaScriptStringLiteral(match[1]) : undefined;
}

/** Reads every `q: "..."` entry out of a `web__run` search-query array. */
function readSearchQueries(objectSource: string): string[] {
  const pattern = /(?:["']q["']|\bq)\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/gs;
  return Array.from(objectSource.matchAll(pattern), (match) => decodeJavaScriptStringLiteral(match[1]));
}

/**
 * Finds the patch body an `apply_patch` call is given.
 *
 * The program almost always assigns it to a local first
 * (`const patch = "*** Begin Patch..."; tools.apply_patch(patch)`), so the
 * argument itself is usually an identifier. Scanning the whole script for the
 * literal that carries the patch header covers both forms.
 */
function readPatchLiteral(source: string): string | undefined {
  const pattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/gs;
  for (const match of source.matchAll(pattern)) {
    const decoded = decodeJavaScriptStringLiteral(match[1]);
    if (decoded.includes('*** Begin Patch')) {
      return decoded;
    }
  }
  return undefined;
}

/**
 * Reads the steps of an `update_plan` call made from an exec script.
 *
 * The script writes its argument as a JavaScript object literal with unquoted
 * keys, so it is not JSON — each `{step, status}` entry is matched directly.
 */
function readPlanSteps(objectSource: string): CodexPlanTodo[] {
  const todos: CodexPlanTodo[] = [];
  for (const entry of objectSource.matchAll(/\{([^{}]*)\}/g)) {
    const content = readStringProperty(entry[1], 'step') ?? readStringProperty(entry[1], 'content');
    if (content) {
      todos.push({ content, status: readStringProperty(entry[1], 'status') ?? 'pending' });
    }
  }

  return todos;
}

/**
 * Recovers commands a script keeps in a local array and maps over, which is how
 * Codex batches several shell calls:
 *   `const cmds = ["a", "b"]; await Promise.all(cmds.map(command => tools.shell_command({ command })))`
 * The call site then passes `{ command }` shorthand, so there is no literal to
 * read at the call itself.
 */
function readMappedCommandCandidates(source: string): string[] {
  const commands: string[] = [];
  const arrayPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[([\s\S]*?)\]\s*;/g;
  const stringPattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/gs;

  for (const arrayMatch of source.matchAll(arrayPattern)) {
    if (!new RegExp(`\\b${arrayMatch[1]}\\.map\\s*\\(`).test(source)) {
      continue;
    }
    for (const stringMatch of arrayMatch[2].matchAll(stringPattern)) {
      commands.push(decodeJavaScriptStringLiteral(stringMatch[1]));
    }
  }

  return commands;
}

/**
 * Turns one Codex `exec` script into the operations it performs, in source
 * order. An empty result means the script did nothing recognizable and the
 * caller should fall back to showing it as code.
 *
 * Exported for tests.
 */
export function parseCodexExecScript(input: unknown): CodexExecOperation[] {
  const source = typeof input === 'string' ? input : String(input ?? '');
  if (!source.includes('tools.')) {
    return [];
  }

  const operations: CodexExecOperation[] = [];
  const callPattern = /tools\.([A-Za-z_0-9]+)\s*\(/g;
  /** Filled in lazily, and only once, for shorthand-argument shell calls. */
  let mappedCommands: string[] | null = null;

  for (const match of source.matchAll(callPattern)) {
    const toolName = match[1];
    const openParenIndex = match.index + match[0].length - 1;
    const argumentSource = readCallArguments(source, openParenIndex) ?? '';

    switch (toolName) {
      case 'shell_command':
      case 'exec_command': {
        const command = readStringProperty(argumentSource, 'command')
          ?? readStringProperty(argumentSource, 'cmd');
        if (command) {
          operations.push({
            kind: 'shell',
            command,
            justification: readStringProperty(argumentSource, 'justification'),
          });
          break;
        }

        if (mappedCommands === null) {
          mappedCommands = readMappedCommandCandidates(source);
          for (const mappedCommand of mappedCommands) {
            operations.push({ kind: 'shell', command: mappedCommand });
          }
        }
        break;
      }
      case 'write_stdin': {
        operations.push({ kind: 'stdin', chars: readStringProperty(argumentSource, 'chars') ?? '' });
        break;
      }
      case 'apply_patch': {
        const patch = readPatchLiteral(argumentSource) ?? readPatchLiteral(source);
        if (patch) {
          operations.push({ kind: 'patch', patch });
        }
        break;
      }
      case 'web__run':
      case 'web_search': {
        const queries = readSearchQueries(argumentSource);
        if (queries.length > 0) {
          operations.push({ kind: 'search', queries });
        }
        break;
      }
      case 'update_plan': {
        const todos = readPlanSteps(argumentSource);
        if (todos.length > 0) {
          operations.push({ kind: 'plan', todos });
        }
        break;
      }
      default:
        break;
    }
  }

  return operations;
}

// ─── Codex shell output ─────────────────────────────────────────────────────

type CodexShellOutput = {
  output: string;
  /** Set when the command has exited; `undefined` while it is still running. */
  exitCode?: number;
  /** Present while the command runs in the background under this cell id. */
  runningCellId?: string;
  truncated: boolean;
};

/**
 * Strips the two nested envelopes Codex wraps shell output in.
 *
 * The outer one reports on the sandbox *script* (`Script completed`, its wall
 * time, and `Output:`); the inner one reports on the *command* (`Exit code`,
 * its own wall time, an optional line count). Neither is useful in a chat
 * transcript, but the exit code decides whether the row is shown as failed, so
 * it is lifted out before the text is discarded.
 *
 * Exported for tests.
 */
export function cleanCodexShellOutput(rawOutput: string): CodexShellOutput {
  let output = rawOutput;
  let exitCode: number | undefined;
  let runningCellId: string | undefined;
  let truncated = false;

  const runningMatch = /^Script running with cell ID\s+(\S+)[^\n]*\n?/i.exec(output);
  if (runningMatch) {
    runningCellId = runningMatch[1];
    output = output.slice(runningMatch[0].length);
  } else {
    output = output.replace(/^Script (?:completed|failed)[^\n]*\n?/i, '');
  }

  output = output.replace(/^Wall time[^\n]*\n?/i, '');
  output = output.replace(/^Output:\s*\n?/i, '');
  output = output.replace(/^Script error:\s*\n?/i, '');

  const truncationMatch = /^Warning: truncated output[^\n]*\n(?:Total output lines:[^\n]*\n)?\n?/i.exec(output);
  if (truncationMatch) {
    truncated = true;
    output = output.slice(truncationMatch[0].length);
    output = output.replace(/^Script error:\s*\n?/i, '');
  }

  const exitCodeMatch = /^Exit code:\s*(-?\d+)[^\n]*\n?/i.exec(output);
  if (exitCodeMatch) {
    exitCode = Number.parseInt(exitCodeMatch[1], 10);
    output = output.slice(exitCodeMatch[0].length);
    output = output.replace(/^Wall time:[^\n]*\n?/i, '');
    output = output.replace(/^Total output lines:[^\n]*\n?/i, '');
    output = output.replace(/^Output:\s*\n?/i, '');
  }

  return { output, exitCode, runningCellId, truncated };
}

/**
 * `write_stdin` answers with a JSON envelope rather than plain text. Only its
 * `output` and `exit_code` matter to a reader.
 */
function readCodexStdinOutput(rawOutput: string): CodexShellOutput | null {
  const trimmed = rawOutput.trim();
  const jsonStart = trimmed.indexOf('{');
  if (jsonStart === -1) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart)) as AnyRecord;
    if (typeof parsed.output !== 'string') {
      return null;
    }
    return {
      output: parsed.output,
      exitCode: typeof parsed.exit_code === 'number' ? parsed.exit_code : undefined,
      truncated: false,
    };
  } catch {
    return null;
  }
}

// ─── Unified patches ────────────────────────────────────────────────────────

type CodexFileChange = {
  filePath: string;
  /** `add` and `delete` are rendered as a whole-file write/removal. */
  changeType: 'add' | 'update' | 'delete';
  oldText: string;
  newText: string;
};

/**
 * Rebuilds the before/after text of one unified diff.
 *
 * Only the hunks are available — never the whole file — so the reconstruction
 * keeps context lines in both sides and drops hunk headers. Feeding that pair
 * to the frontend's line differ reproduces exactly the additions, removals and
 * surrounding context the patch described, which is what Claude's `Edit` rows
 * already show.
 *
 * Exported for tests.
 */
export function unifiedDiffToTexts(unifiedDiff: string): { oldText: string; newText: string } {
  const oldLines: string[] = [];
  const newLines: string[] = [];

  for (const line of unifiedDiff.split('\n')) {
    if (line.startsWith('@@') || line.startsWith('\\ No newline')) {
      continue;
    }
    if (line.startsWith('+')) {
      newLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith('-')) {
      oldLines.push(line.slice(1));
      continue;
    }
    const contextLine = line.startsWith(' ') ? line.slice(1) : line;
    oldLines.push(contextLine);
    newLines.push(contextLine);
  }

  // A unified diff ends with a newline, which would otherwise reconstruct as a
  // phantom trailing blank line on both sides.
  if (oldLines[oldLines.length - 1] === '' && newLines[newLines.length - 1] === '') {
    oldLines.pop();
    newLines.pop();
  }

  return { oldText: oldLines.join('\n'), newText: newLines.join('\n') };
}

/**
 * Splits a `*** Begin Patch` body into one change per file.
 *
 * Exported for tests.
 */
export function parseCodexPatch(patch: string): CodexFileChange[] {
  const changes: CodexFileChange[] = [];
  const lines = patch.split('\n');
  let current: { filePath: string; changeType: CodexFileChange['changeType']; body: string[] } | null = null;

  const flush = () => {
    if (!current) {
      return;
    }
    const { oldText, newText } = unifiedDiffToTexts(current.body.join('\n'));
    changes.push({
      filePath: current.filePath,
      changeType: current.changeType,
      oldText: current.changeType === 'add' ? '' : oldText,
      newText: current.changeType === 'delete' ? '' : newText,
    });
    current = null;
  };

  for (const line of lines) {
    const fileHeader = /^\*\*\* (Add|Update|Delete) File:\s*(.+)$/.exec(line);
    if (fileHeader) {
      flush();
      const changeType = fileHeader[1].toLowerCase() as CodexFileChange['changeType'];
      current = { filePath: fileHeader[2].trim(), changeType, body: [] };
      continue;
    }

    if (line.startsWith('*** ')) {
      // `*** Begin Patch`, `*** End Patch`, `*** Move to:` — never diff content.
      continue;
    }

    current?.body.push(line);
  }

  flush();
  return changes;
}

/** Converts a `patch_apply_end` change map into the same per-file shape. */
function readPatchApplyChanges(changes: unknown): CodexFileChange[] {
  const record = readObjectRecord(changes);
  if (!record) {
    return [];
  }

  const parsed: CodexFileChange[] = [];
  for (const [filePath, rawChange] of Object.entries(record)) {
    const change = readObjectRecord(rawChange);
    if (!change) {
      continue;
    }
    const changeType = change.type === 'add' || change.type === 'delete' ? change.type : 'update';
    const { oldText, newText } = unifiedDiffToTexts(
      typeof change.unified_diff === 'string' ? change.unified_diff : '',
    );
    parsed.push({
      filePath,
      changeType,
      oldText: changeType === 'add' ? '' : oldText,
      newText: changeType === 'delete' ? '' : newText,
    });
  }

  return parsed;
}

/** Maps a file change onto the tool the frontend already renders diffs for. */
function fileChangeToToolMessage(change: CodexFileChange, timestamp: string, toolCallId: string): AnyRecord {
  const toolName = change.changeType === 'add' ? 'Write' : 'Edit';
  return {
    type: 'tool_use',
    timestamp,
    toolName,
    toolInput: JSON.stringify({
      file_path: change.filePath,
      old_string: change.oldText,
      new_string: change.newText,
      ...(change.changeType === 'delete' ? { deleted: true } : {}),
    }),
    toolCallId,
  };
}

/** Reads the `file_path` back out of a rendered file-change row. */
function readRowFilePath(row: AnyRecord): string {
  try {
    return String((JSON.parse(String(row.toolInput ?? '{}')) as AnyRecord).file_path ?? '');
  } catch {
    return '';
  }
}

/**
 * Rewrites the rows reconstructed from a patch call's input with the
 * authoritative diffs Codex reports once the patch has been applied.
 *
 * Rows are matched by path, never by position: `patch_apply_end` reports the
 * touched files in map order, which does not follow the order they appeared in
 * the patch body. Rows whose file the report does not mention are dropped
 * rather than left behind claiming an edit that never happened.
 */
function rewritePatchRows(
  rows: AnyRecord[],
  changes: CodexFileChange[],
  callId: string,
  messages: AnyRecord[],
): void {
  const rowsByPath = new Map<string, AnyRecord>();
  for (const row of rows) {
    rowsByPath.set(readRowFilePath(row), row);
  }

  const keptRows: AnyRecord[] = [];
  for (const [index, change] of changes.entries()) {
    const replacement = fileChangeToToolMessage(change, String(rows[0]?.timestamp ?? ''), `${callId}#${index}`);
    const existing = rowsByPath.get(change.filePath);
    if (existing) {
      existing.toolName = replacement.toolName;
      existing.toolInput = replacement.toolInput;
      keptRows.push(existing);
      rowsByPath.delete(change.filePath);
      continue;
    }

    replacement.timestamp = rows[0]?.timestamp ?? replacement.timestamp;
    keptRows.push(replacement);
    messages.push(replacement);
  }

  for (const surplus of rowsByPath.values()) {
    const position = messages.indexOf(surplus);
    if (position !== -1) {
      messages.splice(position, 1);
    }
  }

  rows.splice(0, rows.length, ...keptRows);
}

// ─── Subagents ──────────────────────────────────────────────────────────────

type CodexSubagentRecord = {
  toolCallId: string;
  message: AnyRecord;
  agentPath?: string;
  agentThreadId?: string;
  isComplete: boolean;
};

function parseCodexSubagentMessage(payload: AnyRecord): {
  author: string;
  messageType: string;
  result: string;
} | null {
  const text = extractCodexTextContent(payload.content);
  const header = /Message Type:\s*([^\r\n]+)[\s\S]*?Sender:\s*([^\r\n]+)[\s\S]*?Payload:\s*\r?\n([\s\S]*)/i.exec(text);
  const author = readNonEmptyString(payload.author) || header?.[2]?.trim();
  if (!author) {
    return null;
  }

  return {
    author,
    messageType: header?.[1]?.trim().toUpperCase() || 'MESSAGE',
    result: header?.[3]?.trim() || '',
  };
}

/**
 * Codex names a spawned agent's rollout file `rollout-<timestamp>-<threadId>`
 * and writes it next to the parent's. Look there first, then widen to the
 * enclosing day/month directories so a run that crosses midnight still
 * resolves, and give up rather than walking the whole archive.
 */
async function findCodexSubagentRollout(
  parentFilePath: string,
  agentThreadId: string,
): Promise<string | null> {
  const suffix = `-${agentThreadId}.jsonl`;
  let directory = path.dirname(parentFilePath);

  for (let level = 0; level <= SUBAGENT_LOOKUP_PARENT_LEVELS; level += 1) {
    const match = await findFileWithSuffix(directory, suffix, level === 0 ? 0 : level);
    if (match) {
      return match;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }

  return null;
}

/** Depth-limited search for a file whose name ends with `suffix`. */
async function findFileWithSuffix(directory: string, suffix: string, depth: number): Promise<string | null> {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }

  const subdirectories: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      subdirectories.push(path.join(directory, entry.name));
      continue;
    }
    if (entry.name.endsWith(suffix)) {
      return path.join(directory, entry.name);
    }
  }

  if (depth <= 0) {
    return null;
  }

  for (const subdirectory of subdirectories) {
    const match = await findFileWithSuffix(subdirectory, suffix, depth - 1);
    if (match) {
      return match;
    }
  }

  return null;
}

type CodexSubagentTranscript = {
  activity: SubagentActivity[];
  nickname?: string;
  agentPath?: string;
  model?: string;
};

/**
 * Flattens a spawned agent's own rollout into the shared activity timeline.
 *
 * The subagent's transcript is the same format as the parent's, so its shell
 * and patch calls go through the same translation and end up rendered by the
 * same components as the main thread's.
 */
async function readCodexSubagentTranscript(filePath: string): Promise<CodexSubagentTranscript> {
  const activity: SubagentActivity[] = [];
  const transcript: CodexSubagentTranscript = { activity };
  const pendingResults = new Map<string, SubagentActivity>();

  let fileStream;
  try {
    fileStream = fsSync.createReadStream(filePath);
  } catch {
    return transcript;
  }

  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    let entry: AnyRecord;
    try {
      entry = JSON.parse(line) as AnyRecord;
    } catch {
      continue;
    }

    const payload = readObjectRecord(entry.payload);
    if (!payload) {
      continue;
    }

    if (entry.type === 'session_meta') {
      // A resumed rollout writes a second, sparser session_meta; assigning
      // unconditionally would erase the identity the first one carried.
      transcript.nickname = readNonEmptyString(payload.agent_nickname) ?? transcript.nickname;
      transcript.agentPath = readNonEmptyString(payload.agent_path) ?? transcript.agentPath;
      continue;
    }

    if (entry.type === 'turn_context') {
      transcript.model = readNonEmptyString(payload.model) ?? transcript.model;
      continue;
    }

    if (entry.type !== 'response_item') {
      continue;
    }

    const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : undefined;

    if (payload.type === 'message' && payload.role === 'assistant') {
      const content = extractCodexTextContent(payload.content).trim();
      if (content) {
        activity.push({ kind: 'text', content, timestamp });
      }
      continue;
    }

    if (payload.type === 'reasoning') {
      const summary = Array.isArray(payload.summary)
        ? payload.summary.map((item: AnyRecord) => item?.text).filter(Boolean).join('\n')
        : '';
      if (summary.trim()) {
        activity.push({ kind: 'thinking', content: summary, timestamp });
      }
      continue;
    }

    if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      const callId = readNonEmptyString(payload.call_id) ?? generateMessageId('codex-subagent-call');
      for (const child of translateCodexToolCall(payload, callId)) {
        const record: SubagentActivity = { ...child, timestamp };
        activity.push(record);
        pendingResults.set(callId, record);
      }
      continue;
    }

    if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      const callId = readNonEmptyString(payload.call_id);
      const target = callId ? pendingResults.get(callId) : undefined;
      if (!target) {
        continue;
      }
      const cleaned = cleanCodexShellOutput(extractCodexToolOutput(payload.output));
      target.toolResult = {
        content: cleaned.output,
        isError: cleaned.exitCode !== undefined && cleaned.exitCode !== 0,
      };
    }
  }

  return transcript;
}

/**
 * Translates one persisted Codex tool call into the canonical tool rows the
 * transcript renders. Most calls produce exactly one row; a patch produces one
 * per file it touched.
 *
 * Shared by the main thread and by subagent transcripts so a subagent's shell
 * command looks identical to the parent's.
 */
function translateCodexToolCall(payload: AnyRecord, callId: string): SubagentActivity[] {
  const name = readNonEmptyString(payload.name) ?? 'tool';
  const rawInput = payload.type === 'custom_tool_call' ? payload.input : payload.arguments;

  if (name === 'exec') {
    const operations = parseCodexExecScript(rawInput);
    const rows: SubagentActivity[] = [];
    for (const operation of operations) {
      if (operation.kind === 'shell') {
        rows.push({
          kind: 'tool',
          toolId: callId,
          toolName: 'Bash',
          toolInput: { command: operation.command, description: operation.justification },
        });
      } else if (operation.kind === 'patch') {
        for (const change of parseCodexPatch(operation.patch)) {
          rows.push({
            kind: 'tool',
            toolId: callId,
            toolName: change.changeType === 'add' ? 'Write' : 'Edit',
            toolInput: {
              file_path: change.filePath,
              old_string: change.oldText,
              new_string: change.newText,
            },
          });
        }
      } else if (operation.kind === 'search') {
        rows.push({
          kind: 'tool',
          toolId: callId,
          toolName: 'WebSearch',
          toolInput: { query: operation.queries.join(' | ') },
        });
      }
    }
    if (rows.length > 0) {
      return rows;
    }
  }

  if (name === 'shell_command' || name === 'exec_command') {
    let command = '';
    try {
      const args = JSON.parse(String(rawInput || '{}')) as AnyRecord;
      command = String(args.command ?? args.cmd ?? '');
    } catch {
      command = String(rawInput ?? '');
    }
    return [{ kind: 'tool', toolId: callId, toolName: 'Bash', toolInput: { command } }];
  }

  if (name === 'apply_patch') {
    return parseCodexPatch(String(rawInput ?? '')).map((change) => ({
      kind: 'tool' as const,
      toolId: callId,
      toolName: change.changeType === 'add' ? 'Write' : 'Edit',
      toolInput: {
        file_path: change.filePath,
        old_string: change.oldText,
        new_string: change.newText,
      },
    }));
  }

  if (name === 'update_plan') {
    return [{ kind: 'tool', toolId: callId, toolName: 'TodoWrite', toolInput: readCodexPlanInput(rawInput) }];
  }

  return [{ kind: 'tool', toolId: callId, toolName: humanizeCodexToolName(name), toolInput: rawInput }];
}

/**
 * Converts Codex's `update_plan` steps into the todo shape Claude's
 * `TodoWrite` already uses, so one renderer covers both providers.
 */
function readCodexPlanInput(rawArguments: unknown): AnyRecord {
  try {
    const parsed = JSON.parse(String(rawArguments || '{}')) as AnyRecord;
    const steps = Array.isArray(parsed.plan) ? parsed.plan : [];
    return {
      todos: steps.map((step: AnyRecord) => ({
        content: typeof step?.step === 'string' ? step.step : String(step?.content ?? ''),
        status: typeof step?.status === 'string' ? step.status : 'pending',
      })),
    };
  } catch {
    return { todos: [] };
  }
}

function humanizeCodexToolName(toolName: string): string {
  return toolName
    .replace(/__/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

const CODEX_COLLABORATION_CONTROL_TOOLS = new Set([
  'followup_task',
  'interrupt_agent',
  'list_agents',
  'send_message',
  'wait_agent',
]);

// ─── Transcript reader ──────────────────────────────────────────────────────

/**
 * Reads one Codex rollout file and produces the compact per-message records
 * `normalizeHistoryEntry` turns into `NormalizedMessage`s.
 */
async function getCodexSessionMessages(sessionId: string): Promise<CodexHistoryResult> {
  const sessionFilePath = sessionsDb.getSessionById(sessionId)?.jsonl_path;

  if (!sessionFilePath) {
    console.warn(`Codex session file not found for session ${sessionId}`);
    return { messages: [], total: 0, hasMore: false };
  }

  const messages: AnyRecord[] = [];
  let tokenUsage: AnyRecord | null = null;

  /** Call ids whose orchestration wrapper must never reach the transcript. */
  const ignoredToolCallIds = new Set<string>();
  /** Exec calls that own a shell row, so their output can be routed back. */
  const shellCallMessages = new Map<string, AnyRecord>();
  /**
   * File rows produced by each patch call, so the authoritative
   * `patch_apply_end` diffs can replace what was reconstructed from the call
   * input, and so every row gets exactly one result.
   */
  const patchGroups = new Map<string, {
    callId: string;
    rows: AnyRecord[];
    timestamp: string;
    success?: boolean;
    failure?: string;
  }>();
  /** Patch call awaiting its out-of-band `patch_apply_end` report. */
  let pendingPatchCallId: string | null = null;
  const execCallByCellId = new Map<string, string>();
  const waitCallToExecCall = new Map<string, string>();
  const pendingExecOutput = new Map<string, string>();
  const completedExecCalls = new Set<string>();
  /** Newest still-running exec call, for `write_stdin` polls that carry no cell id. */
  let runningExecCallId: string | null = null;

  const subagentsByCallId = new Map<string, CodexSubagentRecord>();
  const subagentsByPath = new Map<string, CodexSubagentRecord>();
  const turns = createCodexTurnTracker();
  /** Turns whose prompt already carries the anchor, so only the first does. */
  const anchoredTurnIds = new Set<string>();

  const fileStream = fsSync.createReadStream(sessionFilePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  /** Emits a tool_result row unless the call already produced one. */
  const pushToolResult = (callId: string, timestamp: string, output: string, isError: boolean) => {
    if (completedExecCalls.has(callId)) {
      return;
    }
    completedExecCalls.add(callId);
    messages.push({ type: 'tool_result', timestamp, toolCallId: callId, output, isError });
  };

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    let entry: AnyRecord;
    try {
      entry = JSON.parse(line) as AnyRecord;
    } catch {
      continue;
    }

    const payload = readObjectRecord(entry.payload);
    if (!payload) {
      continue;
    }
    const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString();
    // Before the type-specific branches: a turn is opened and closed by rows
    // that produce no transcript entry of their own, and each of those
    // branches ends in a `continue`.
    turns.observe(entry.type, payload);

    // ── event_msg ──────────────────────────────────────────────────────────
    if (entry.type === 'event_msg') {
      if (payload.type === 'token_count' && payload.info) {
        const info = payload.info as AnyRecord;
        if (info.total_token_usage) {
          const usage = info.total_token_usage as AnyRecord;
          tokenUsage = { used: usage.total_tokens || 0, total: info.model_context_window || 200000 };
        }
        continue;
      }

      if (payload.type === 'sub_agent_activity' && payload.kind === 'started') {
        const eventId = readNonEmptyString(payload.event_id);
        const agentPath = readNonEmptyString(payload.agent_path);
        const agentThreadId = readNonEmptyString(payload.agent_thread_id);
        const subagent = eventId ? subagentsByCallId.get(eventId) : undefined;
        if (subagent) {
          subagent.agentThreadId = agentThreadId ?? subagent.agentThreadId;
          if (agentPath) {
            subagent.agentPath = agentPath;
            subagentsByPath.set(agentPath, subagent);
          }
        }
        continue;
      }

      // Codex reports patch results out of band. They carry the real unified
      // diffs, so they replace whatever was reconstructed from the call input.
      // Codex reports the applied patch out of band, and it is the only place
      // the real unified diffs appear. It always arrives before the call's own
      // output, so the rows reconstructed from the call input are rewritten
      // here rather than duplicated.
      if (payload.type === 'patch_apply_end') {
        const callId = readNonEmptyString(payload.call_id);
        if (!callId) {
          continue;
        }
        const changes = readPatchApplyChanges(payload.changes);
        // A patch applied from inside an `exec` script is reported under a
        // synthetic id that does not match the script's call id, so fall back
        // to the patch call that is still in flight.
        const group = patchGroups.get(callId)
          ?? (pendingPatchCallId ? patchGroups.get(pendingPatchCallId) : undefined);
        if (group) {
          rewritePatchRows(group.rows, changes, group.callId, messages);
          group.success = payload.success !== false;
          group.failure = String(payload.stderr || payload.stdout || '');
          pendingPatchCallId = null;
        } else if (changes.length > 0) {
          // A resumed thread can replay the result of a patch whose call is
          // not in this file; the rows still belong in the transcript.
          const rows = changes.map((change, index) =>
            fileChangeToToolMessage(change, timestamp, `${callId}#${index}`));
          rows.forEach((row) => messages.push(row));
          patchGroups.set(callId, {
            callId,
            rows,
            timestamp,
            success: payload.success !== false,
            failure: String(payload.stderr || payload.stdout || ''),
          });
        }
        continue;
      }

      if (payload.type === 'turn_aborted') {
        messages.push({
          type: 'status_note',
          timestamp,
          content: payload.reason === 'interrupted' ? 'Turn interrupted' : `Turn aborted (${String(payload.reason ?? 'unknown')})`,
        });
        continue;
      }

      if (payload.type === 'context_compacted') {
        messages.push({ type: 'status_note', timestamp, content: 'Context compacted' });
        continue;
      }

      if (isVisibleCodexUserMessage(payload)) {
        // Only the first prompt of a turn is anchored. A turn can hold more
        // than one — a follow-up queued while the turn was running is written
        // into it — and the cut is per turn, so anchoring the second would
        // quietly take the first with it when the user edited only the second.
        const turnId = turns.getCurrentTurnId();
        const isFirstPromptOfTurn = Boolean(turnId) && !anchoredTurnIds.has(turnId as string);
        if (isFirstPromptOfTurn) {
          anchoredTurnIds.add(turnId as string);
        }
        messages.push({
          type: 'user',
          timestamp,
          message: { role: 'user', content: payload.message },
          images: extractCodexUserImages(payload),
          ...(isFirstPromptOfTurn ? { turnId } : {}),
        });
      }
      continue;
    }

    if (entry.type !== 'response_item') {
      continue;
    }

    // ── response_item ──────────────────────────────────────────────────────
    if (payload.type === 'message' && payload.role === 'assistant') {
      const cited = readCodexMemoryCitations(extractCodexTextContent(payload.content));
      const textContent = cited.text;
      if (!textContent.trim()) {
        continue;
      }

      const proposedPlan = readCodexProposedPlan(textContent);
      if (proposedPlan) {
        const planCallId = readNonEmptyString(payload.id) ?? generateMessageId('codex-plan');
        messages.push({
          type: 'tool_use',
          timestamp,
          toolName: 'ExitPlanMode',
          toolInput: JSON.stringify({ plan: proposedPlan }),
          toolCallId: planCallId,
          memoryCitations: cited.memoryCitations,
        });
        messages.push({ type: 'tool_result', timestamp, toolCallId: planCallId, output: '' });
        continue;
      }

      messages.push({
        type: 'assistant',
        timestamp,
        message: { role: 'assistant', content: textContent },
        memoryCitations: cited.memoryCitations,
      });
      continue;
    }

    if (payload.type === 'reasoning') {
      const summaryText = Array.isArray(payload.summary)
        ? payload.summary.map((item: AnyRecord) => item?.text).filter(Boolean).join('\n')
        : '';
      if (summaryText.trim()) {
        messages.push({
          type: 'thinking',
          timestamp,
          message: { role: 'assistant', content: summaryText },
        });
      }
      continue;
    }

    if (payload.type === 'web_search_call') {
      const action = readObjectRecord(payload.action);
      const query = readNonEmptyString(action?.query as string | undefined);
      if (query) {
        const callId = readNonEmptyString(payload.id) ?? generateMessageId('codex-search');
        messages.push({
          type: 'tool_use',
          timestamp,
          toolName: 'WebSearch',
          toolInput: JSON.stringify({ query }),
          toolCallId: callId,
        });
      }
      continue;
    }

    if (payload.type === 'agent_message') {
      const agentMessage = parseCodexSubagentMessage(payload);
      if (!agentMessage || agentMessage.messageType !== 'FINAL_ANSWER' || !agentMessage.result) {
        continue;
      }

      let subagent = subagentsByPath.get(agentMessage.author);
      if (!subagent) {
        // A resumed thread can replay an answer whose spawn call is not in this
        // file. Synthesize the container so the answer still has a home.
        const fallbackCallId = readNonEmptyString(payload.id) ?? generateMessageId('codex-subagent');
        const taskName = agentMessage.author.split('/').filter(Boolean).pop() || 'agent';
        const taskMessage: AnyRecord = {
          uuid: fallbackCallId,
          type: 'tool_use',
          timestamp,
          toolName: 'Task',
          toolInput: JSON.stringify({ description: humanizeCodexToolName(taskName) }),
          toolCallId: fallbackCallId,
        };
        messages.push(taskMessage);
        subagent = { toolCallId: fallbackCallId, message: taskMessage, agentPath: agentMessage.author, isComplete: false };
        subagentsByCallId.set(fallbackCallId, subagent);
        subagentsByPath.set(agentMessage.author, subagent);
      }

      if (!subagent.isComplete) {
        messages.push({
          type: 'tool_result',
          timestamp,
          toolCallId: subagent.toolCallId,
          output: agentMessage.result,
        });
        subagent.isComplete = true;
      }
      continue;
    }

    if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      const callId = readNonEmptyString(payload.call_id) ?? generateMessageId('codex-call');
      const name = readNonEmptyString(payload.name) ?? 'tool';
      const rawInput = payload.type === 'custom_tool_call' ? payload.input : payload.arguments;

      if (name === 'spawn_agent') {
        let taskName = 'agent';
        let prompt: string | undefined;
        try {
          const args = JSON.parse(String(rawInput || '{}')) as AnyRecord;
          taskName = readNonEmptyString(args.task_name) || taskName;
          // `message` is an encrypted transport blob on collaboration spawns —
          // only surface it when it is readable prompt text.
          const message = readNonEmptyString(args.message);
          prompt = message && !/^gAAAAA/.test(message) ? message : undefined;
        } catch {
          // The activity event still supplies the canonical agent path.
        }

        const taskMessage: AnyRecord = {
          uuid: callId,
          type: 'tool_use',
          timestamp,
          toolName: 'Task',
          // No `subagent_type`: Codex has no agent presets, and naming the
          // provider there would render as "Codex / Codex" in the transcript.
          toolInput: JSON.stringify({
            description: humanizeCodexToolName(taskName),
            ...(prompt ? { prompt } : {}),
          }),
          toolCallId: callId,
        };
        messages.push(taskMessage);
        subagentsByCallId.set(callId, { toolCallId: callId, message: taskMessage, isComplete: false });
        ignoredToolCallIds.add(callId);
        continue;
      }

      if (name === 'wait') {
        try {
          const args = JSON.parse(String(rawInput || '{}')) as AnyRecord;
          const execCallId = execCallByCellId.get(String(args.cell_id || ''));
          if (execCallId) {
            waitCallToExecCall.set(callId, execCallId);
          }
        } catch {
          // Suppress the orchestration wait even when its payload is malformed.
        }
        ignoredToolCallIds.add(callId);
        continue;
      }

      if (CODEX_COLLABORATION_CONTROL_TOOLS.has(name)) {
        ignoredToolCallIds.add(callId);
        continue;
      }

      if (name === 'update_plan') {
        messages.push({
          type: 'tool_use',
          timestamp,
          toolName: 'TodoWrite',
          toolInput: JSON.stringify(readCodexPlanInput(rawInput)),
          toolCallId: callId,
        });
        continue;
      }

      if (name === 'exec') {
        const operations = parseCodexExecScript(rawInput);
        const shellCommands = operations.filter((operation) => operation.kind === 'shell');
        const stdinWrites = operations.filter((operation) => operation.kind === 'stdin');
        const patches = operations.filter((operation) => operation.kind === 'patch');
        const searches = operations.filter((operation) => operation.kind === 'search');
        const plans = operations.filter((operation) => operation.kind === 'plan');

        // A bare stdin poll continues whatever command is still running; it is
        // a continuation, not an action of its own.
        if (operations.length > 0 && shellCommands.length === 0 && stdinWrites.length > 0) {
          ignoredToolCallIds.add(callId);
          if (runningExecCallId) {
            waitCallToExecCall.set(callId, runningExecCallId);
          }
          continue;
        }

        if (operations.length === 0) {
          // An unrecognized wrapper is shown as-is rather than mislabelled as a
          // shell command, so a new Codex tool degrades to a readable code
          // block instead of a wrong one.
          const fallbackMessage: AnyRecord = {
            type: 'tool_use',
            timestamp,
            toolName: 'exec',
            toolInput: rawInput,
            toolCallId: callId,
          };
          messages.push(fallbackMessage);
          continue;
        }

        // The call has exactly one output, so whichever row represents the work
        // it did keeps the call id and receives that output. Extra rows get
        // suffixed ids and are resolved by their own bookkeeping.
        let outputOwnerAssigned = false;
        const nextRowId = () => {
          if (!outputOwnerAssigned) {
            outputOwnerAssigned = true;
            return callId;
          }
          return `${callId}~${messages.length}`;
        };

        if (shellCommands.length > 0) {
          const shellMessage: AnyRecord = {
            type: 'tool_use',
            timestamp,
            toolName: 'Bash',
            toolInput: JSON.stringify({
              command: shellCommands.map((operation) => operation.command).join('\n'),
              description: shellCommands.find((operation) => operation.justification)?.justification,
            }),
            toolCallId: nextRowId(),
          };
          messages.push(shellMessage);
          shellCallMessages.set(callId, shellMessage);
        }

        for (const search of searches) {
          messages.push({
            type: 'tool_use',
            timestamp,
            toolName: 'WebSearch',
            toolInput: JSON.stringify({ query: search.queries.join(' | ') }),
            toolCallId: nextRowId(),
          });
        }

        for (const plan of plans) {
          // The script's own result covers whatever else it did, so the plan
          // row is closed here — without one it would read as still running.
          const planCallId = nextRowId();
          messages.push({
            type: 'tool_use',
            timestamp,
            toolName: 'TodoWrite',
            toolInput: JSON.stringify({ todos: plan.todos }),
            toolCallId: planCallId,
          });
          messages.push({ type: 'tool_result', timestamp, toolCallId: planCallId, output: '' });
        }

        if (patches.length > 0) {
          const changes = patches.flatMap((patch) => parseCodexPatch(patch.patch));
          const rows = changes.map((change, index) =>
            fileChangeToToolMessage(change, timestamp, index === 0 ? nextRowId() : `${callId}#${index}`));
          rows.forEach((row) => messages.push(row));
          patchGroups.set(callId, { callId, rows, timestamp });
          pendingPatchCallId = callId;
        }

        if (!outputOwnerAssigned) {
          // Every recognized operation produced no row (an empty patch, say).
          // Nothing owns the output, so drop it rather than leaving it loose.
          ignoredToolCallIds.add(callId);
        }
        continue;
      }

      if (name === 'apply_patch') {
        const rows = parseCodexPatch(String(rawInput ?? ''))
          .map((change, index) => fileChangeToToolMessage(change, timestamp, `${callId}#${index}`));
        rows.forEach((row) => messages.push(row));
        patchGroups.set(callId, { callId, rows, timestamp });
        pendingPatchCallId = callId;
        // The call's own output is a bare `{}`; the per-file rows carry the result.
        ignoredToolCallIds.add(callId);
        continue;
      }

      if (name === 'shell_command' || name === 'exec_command') {
        let command = '';
        try {
          const args = JSON.parse(String(rawInput || '{}')) as AnyRecord;
          command = String(args.command ?? args.cmd ?? '');
        } catch {
          command = String(rawInput ?? '');
        }
        const shellMessage: AnyRecord = {
          type: 'tool_use',
          timestamp,
          toolName: 'Bash',
          toolInput: JSON.stringify({ command }),
          toolCallId: callId,
        };
        messages.push(shellMessage);
        shellCallMessages.set(callId, shellMessage);
        continue;
      }

      messages.push({
        type: 'tool_use',
        timestamp,
        toolName: name,
        toolInput: rawInput,
        toolCallId: callId,
      });
      continue;
    }

    if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      const callId = readNonEmptyString(payload.call_id) ?? '';
      const rawOutput = extractCodexToolOutput(payload.output);

      // A wait / stdin poll delivers the tail of an earlier command's output.
      const continuedCallId = waitCallToExecCall.get(callId);
      if (continuedCallId) {
        const cleaned = readCodexStdinOutput(rawOutput) ?? cleanCodexShellOutput(rawOutput);
        const accumulated = `${pendingExecOutput.get(continuedCallId) || ''}${cleaned.output}`;
        pendingExecOutput.set(continuedCallId, accumulated);
        if (!cleaned.runningCellId) {
          if (runningExecCallId === continuedCallId) {
            runningExecCallId = null;
          }
          pushToolResult(
            continuedCallId,
            timestamp,
            accumulated,
            cleaned.exitCode !== undefined && cleaned.exitCode !== 0,
          );
        }
        continue;
      }

      const subagent = subagentsByCallId.get(callId);
      if (subagent) {
        try {
          const taskPath = readNonEmptyString((JSON.parse(rawOutput) as AnyRecord).task_name);
          if (taskPath) {
            subagent.agentPath = taskPath;
            subagentsByPath.set(taskPath, subagent);
          }
        } catch {
          // The sub_agent_activity event normally supplies the path.
        }
        continue;
      }

      if (ignoredToolCallIds.has(callId)) {
        continue;
      }

      if (shellCallMessages.has(callId)) {
        const cleaned = cleanCodexShellOutput(rawOutput);
        if (cleaned.runningCellId) {
          execCallByCellId.set(cleaned.runningCellId, callId);
          pendingExecOutput.set(callId, cleaned.output);
          runningExecCallId = callId;
          continue;
        }
        const accumulated = `${pendingExecOutput.get(callId) || ''}${cleaned.output}`;
        pushToolResult(
          callId,
          timestamp,
          accumulated,
          cleaned.exitCode !== undefined && cleaned.exitCode !== 0,
        );
        continue;
      }

      pushToolResult(callId, timestamp, rawOutput, false);
    }
  }

  // Every file row needs a result or the UI shows it as still running. The
  // patch outcome is known only after `patch_apply_end` (which may never
  // arrive), so results are emitted once the whole file has been read.
  for (const group of patchGroups.values()) {
    const failed = group.success === false;
    for (const row of group.rows) {
      messages.push({
        type: 'tool_result',
        timestamp: group.timestamp,
        toolCallId: row.toolCallId,
        output: failed ? (group.failure || 'Patch failed') : '',
        isError: failed,
      });
    }
  }

  await attachCodexSubagentTranscripts(sessionFilePath, subagentsByCallId);

  // A rollback is recorded after the turns it retires, so a prompt can be
  // anchored and then retired later in the same file. Its rows still render —
  // they are what the conversation looked like — but the turn is gone from the
  // thread, so the anchor goes with it and the message loses its pencil.
  for (const message of messages) {
    if (typeof message.turnId === 'string' && turns.isRolledBack(message.turnId)) {
      delete message.turnId;
    }
  }

  messages.sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
  return { messages, tokenUsage: tokenUsage ?? undefined };
}

/**
 * Loads each spawned agent's own rollout and hangs its timeline off the
 * `Task` row that started it.
 */
async function attachCodexSubagentTranscripts(
  parentFilePath: string,
  subagentsByCallId: Map<string, CodexSubagentRecord>,
): Promise<void> {
  for (const record of subagentsByCallId.values()) {
    let parsedInput: AnyRecord = {};
    try {
      parsedInput = JSON.parse(String(record.message.toolInput || '{}')) as AnyRecord;
    } catch {
      parsedInput = {};
    }

    const agentName = record.agentPath?.split('/').filter(Boolean).pop();
    // Codex has no agent-type concept the way Claude does, so `type` is left
    // unset rather than filled with the provider's own name; the panel falls
    // back to a neutral label.
    const subagent: SubagentInfo = {
      id: record.agentThreadId ?? record.toolCallId,
      description: readNonEmptyString(parsedInput.description as string | undefined) ?? agentName,
      status: record.isComplete ? 'completed' : 'running',
    };

    if (record.agentThreadId) {
      const rolloutPath = await findCodexSubagentRollout(parentFilePath, record.agentThreadId);
      if (rolloutPath) {
        const transcript = await readCodexSubagentTranscript(rolloutPath);
        if (transcript.activity.length > 0) {
          record.message.subagentTools = transcript.activity
            .slice(0, MAX_TRANSMITTED_SUBAGENT_ACTIVITIES)
            .map(truncateSubagentActivity);
          subagent.activityCount = transcript.activity.length;
        }
        subagent.name = transcript.nickname ?? agentName;
        subagent.model = transcript.model;
      }
    }

    subagent.name = subagent.name ?? agentName;
    record.message.subagent = subagent;
  }
}

export class CodexSessionsProvider implements IProviderSessions {
  /**
   * Resolves the last turn to keep when the turn `anchorId` names is replaced.
   *
   * `thread/fork`'s `lastTurnId` is inclusive of the turn it names, which is
   * the same thing this contract's `resumeThroughId` means, so the answer is
   * simply the turn before the edited one. Editing the first prompt leaves
   * nothing to keep, and `null` is how that is reported.
   */
  async resolveEditAnchor(
    sessionId: string,
    anchorId: string,
  ): Promise<{ found: boolean; resumeThroughId: string | null }> {
    const session = sessionsDb.getSessionById(sessionId);
    const jsonlPath = session?.jsonl_path;
    if (!jsonlPath || !session?.provider_session_id) {
      return { found: false, resumeThroughId: null };
    }

    const liveTurnIds = await readCodexLiveTurnIds(jsonlPath);
    const anchorIndex = liveTurnIds.indexOf(anchorId);
    if (anchorIndex < 0) {
      return { found: false, resumeThroughId: null };
    }

    return {
      found: true,
      resumeThroughId: anchorIndex === 0 ? null : liveTurnIds[anchorIndex - 1],
    };
  }

  /**
   * Branches the conversation at `keepThroughId` and moves the session onto
   * the branch.
   *
   * Codex threads are append-only — the SDK resumes one at its tip and nothing
   * shortens it — so rewinding means copying the part being kept into a new
   * thread. The pre-edit thread stays on disk in full and is recorded as
   * superseded so the session indexer does not hand it back later.
   */
  async rewindSession(sessionId: string, keepThroughId: string | null): Promise<void> {
    const session = sessionsDb.getSessionById(sessionId);
    const supersededThreadId = session?.provider_session_id;
    if (!session || !supersededThreadId) {
      throw new AppError('This session has not produced a transcript yet.', {
        code: 'EDIT_SOURCE_NOT_READY',
        statusCode: 409,
      });
    }

    // Nothing of the conversation survives an edit to its first prompt, and
    // there is no such thing as a fork of no turns, so the session is simply
    // detached and the next run opens a new thread.
    if (keepThroughId === null) {
      sessionsDb.markProviderSessionSuperseded({
        providerSessionId: supersededThreadId,
        provider: PROVIDER,
        sessionId,
        jsonlPath: session.jsonl_path ?? null,
      });
      sessionsDb.detachProviderSession(sessionId);
      return;
    }

    const fork = await codexAppServer.forkThread({
      threadId: supersededThreadId,
      lastTurnId: keepThroughId,
      cwd: session.project_path ?? '',
    });

    sessionsDb.markProviderSessionSuperseded({
      providerSessionId: supersededThreadId,
      provider: PROVIDER,
      sessionId,
      jsonlPath: session.jsonl_path ?? null,
    });
    sessionsDb.repointSessionToProviderSession(sessionId, {
      providerSessionId: fork.threadId,
      jsonlPath: fork.path,
    });
  }

  /**
   * Normalizes a persisted Codex JSONL entry.
   *
   * Live Codex SDK events are transformed before they reach normalizeMessage(),
   * while history entries already use the compact message/tool shape produced
   * by getCodexSessionMessages().
   */
  private normalizeHistoryEntry(raw: AnyRecord, sessionId: string | null): NormalizedMessage[] {
    const ts = raw.timestamp || new Date().toISOString();
    const baseId = raw.uuid || generateMessageId('codex');

    if (raw.type === 'status_note' && typeof raw.content === 'string') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'task_notification',
        summary: raw.content,
        status: 'info',
      })];
    }

    if (raw.type === 'thinking' || raw.isReasoning) {
      const thinkingContent = typeof raw.message?.content === 'string' ? raw.message.content : '';
      if (!thinkingContent.trim()) {
        return [];
      }
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'thinking',
        content: thinkingContent,
      })];
    }

    if (raw.message?.role === 'user') {
      const content = typeof raw.message.content === 'string'
        ? raw.message.content
        : Array.isArray(raw.message.content)
          ? raw.message.content
            .map((part: string | AnyRecord) => typeof part === 'string' ? part : part?.text || '')
            .filter(Boolean)
            .join('\n')
          : String(raw.message.content || '');
      const parsedFiles = parseFilesInputTag(content);
      const rawImages = Array.isArray(raw.images) && raw.images.length > 0 ? raw.images : undefined;
      const files = parsedFiles.attachments.length > 0 ? parsedFiles.attachments : undefined;
      if (!parsedFiles.text.trim() && !rawImages && !files) {
        return [];
      }
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'text',
        role: 'user',
        content: parsedFiles.text,
        images: rawImages,
        files,
        // The enclosing turn, when the reader could name one. `baseId` is not
        // usable for this: Codex rows carry no id, so it is synthesized per
        // read and would address a different message every time.
        transcriptAnchorId: readNonEmptyString(raw.turnId),
      })];
    }

    if (raw.message?.role === 'assistant') {
      const content = typeof raw.message.content === 'string'
        ? raw.message.content
        : Array.isArray(raw.message.content)
          ? raw.message.content
            .map((part: string | AnyRecord) => typeof part === 'string' ? part : part?.text || '')
            .filter(Boolean)
            .join('\n')
          : '';
      if (!content.trim()) {
        return [];
      }
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'text',
        role: 'assistant',
        content,
        memoryCitations: raw.memoryCitations,
      })];
    }

    if (raw.type === 'tool_use' || raw.toolName) {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: raw.toolName || 'Unknown',
        toolInput: raw.toolInput,
        toolId: raw.toolCallId || baseId,
        subagentTools: raw.subagentTools,
        subagent: raw.subagent,
        memoryCitations: raw.memoryCitations,
      })];
    }

    if (raw.type === 'tool_result') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'tool_result',
        toolId: raw.toolCallId || '',
        content: raw.output || '',
        isError: Boolean(raw.isError),
      })];
    }

    return [];
  }

  /**
   * Normalizes either a Codex history entry or a transformed live SDK event.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    if (raw.message?.role) {
      return this.normalizeHistoryEntry(raw, sessionId);
    }

    const ts = raw.timestamp || new Date().toISOString();
    const baseId = raw.uuid || generateMessageId('codex');

    if (raw.type === 'item') {
      // Live items carry a stable SDK id, so an in-progress row and its later
      // completion collapse onto the same transcript entry instead of stacking.
      const itemId = readNonEmptyString(raw.itemId as string | undefined) ?? baseId;

      switch (raw.itemType) {
        case 'agent_message': {
          const cited = readCodexMemoryCitations(String(raw.message?.content || ''));
          const text = cited.text;
          const proposedPlan = readCodexProposedPlan(text);
          if (proposedPlan) {
            // Same unification as history: a proposed plan is a plan card, not
            // an assistant paragraph that happens to start with a tag.
            return [createNormalizedMessage({
              id: itemId,
              sessionId,
              timestamp: ts,
              provider: PROVIDER,
              kind: 'tool_use',
              toolName: 'ExitPlanMode',
              toolInput: { plan: proposedPlan },
              toolId: itemId,
              memoryCitations: cited.memoryCitations,
            })];
          }
          return [createNormalizedMessage({
            id: itemId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'text',
            role: 'assistant',
            content: text,
            memoryCitations: cited.memoryCitations,
          })];
        }
        case 'reasoning':
          return [createNormalizedMessage({
            id: itemId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'thinking',
            content: raw.message?.content || '',
          })];
        case 'command_execution': {
          const toolUse = createNormalizedMessage({
            id: itemId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: 'Bash',
            toolInput: { command: raw.command },
            toolId: itemId,
            status: raw.status,
          });
          const partialOutput = typeof raw.output === 'string' ? raw.output : '';
          if (raw.status === 'in_progress' && !partialOutput) {
            return [toolUse];
          }
          // The SDK reports a command's output on the item itself; the UI reads
          // tool output from a paired result, so one is emitted here. Emitting
          // it while the command is still running is what lets its output
          // stream into the row instead of appearing only at the end.
          return [toolUse, createNormalizedMessage({
            id: `${itemId}_result`,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_result',
            toolId: itemId,
            content: partialOutput,
            isError: raw.status === 'failed' || (typeof raw.exitCode === 'number' && raw.exitCode !== 0),
          })];
        }
        case 'file_change': {
          // One row per file so each change gets the same diff view as an Edit.
          const changes = Array.isArray(raw.changes) ? raw.changes : [];
          return changes.map((change: AnyRecord, index: number) => createNormalizedMessage({
            id: `${itemId}_${index}`,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: change?.kind === 'add' ? 'Write' : 'Edit',
            toolInput: { file_path: change?.path, old_string: '', new_string: '' },
            toolId: `${itemId}_${index}`,
            status: raw.status,
          }));
        }
        case 'mcp_tool_call': {
          const toolName = raw.server ? `mcp__${String(raw.server)}__${String(raw.tool ?? 'tool')}` : String(raw.tool || 'MCP');
          const toolUse = createNormalizedMessage({
            id: itemId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName,
            toolInput: raw.arguments,
            toolId: itemId,
            status: raw.status,
          });
          if (raw.status === 'in_progress') {
            return [toolUse];
          }
          return [toolUse, createNormalizedMessage({
            id: `${itemId}_result`,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_result',
            toolId: itemId,
            content: raw.error
              ? String((raw.error as AnyRecord)?.message ?? raw.error)
              : JSON.stringify(raw.result ?? ''),
            isError: Boolean(raw.error) || raw.status === 'failed',
          })];
        }
        case 'web_search':
          return [createNormalizedMessage({
            id: itemId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: 'WebSearch',
            toolInput: { query: raw.query },
            toolId: itemId,
          })];
        case 'todo_list':
          // Codex's live plan uses `{text, completed}`; Claude's TodoWrite uses
          // `{content, status}`. Normalizing here means one renderer, not two.
          return [createNormalizedMessage({
            id: itemId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: 'TodoWrite',
            toolInput: {
              todos: (Array.isArray(raw.items) ? raw.items : []).map((item: AnyRecord) => ({
                content: String(item?.text ?? ''),
                status: item?.completed ? 'completed' : 'pending',
              })),
            },
            toolId: itemId,
          })];
        case 'error':
          return [createNormalizedMessage({
            id: itemId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'error',
            content: raw.message?.content || 'Unknown error',
          })];
        default:
          return [createNormalizedMessage({
            id: itemId,
            sessionId,
            timestamp: ts,
            provider: PROVIDER,
            kind: 'tool_use',
            toolName: raw.itemType || 'Unknown',
            toolInput: raw.item || raw,
            toolId: itemId,
          })];
      }
    }

    if (raw.type === 'turn_complete') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'complete',
      })];
    }
    if (raw.type === 'turn_failed') {
      return [createNormalizedMessage({
        id: baseId,
        sessionId,
        timestamp: ts,
        provider: PROVIDER,
        kind: 'error',
        content: raw.error?.message || 'Turn failed',
      })];
    }

    return [];
  }

  /**
   * Loads Codex JSONL history and keeps token usage metadata when the
   * transcript reported it.
   */
  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;

    let result: CodexHistoryResult;
    try {
      result = await getCodexSessionMessages(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[CodexProvider] Failed to load session ${sessionId}:`, message);
      return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
    }

    const normalized: NormalizedMessage[] = [];
    for (const raw of result.messages) {
      normalized.push(...this.normalizeHistoryEntry(raw, sessionId));
    }

    const toolResultMap = new Map<string, NormalizedMessage>();
    for (const msg of normalized) {
      if (msg.kind === 'tool_result' && msg.toolId) {
        toolResultMap.set(msg.toolId, msg);
      }
    }
    for (const msg of normalized) {
      if (msg.kind === 'tool_use' && msg.toolId && toolResultMap.has(msg.toolId)) {
        const toolResult = toolResultMap.get(msg.toolId);
        if (toolResult) {
          msg.toolResult = { content: toolResult.content, isError: toolResult.isError };
        }
      }
    }

    // Everything the transcript draws, and nothing else — so a page of N rows
    // is N rows the user sees, and `total` counts the same thing.
    const transcript = prepareTranscriptMessages(normalized);
    const total = transcript.length;
    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = limit === null ? null : Math.max(0, limit);
    const { page, hasMore } = sliceTailPage(transcript, normalizedLimit, normalizedOffset);

    return {
      messages: page,
      total,
      hasMore,
      offset: normalizedOffset,
      limit: normalizedLimit,
      tokenUsage: result.tokenUsage,
    };
  }
}

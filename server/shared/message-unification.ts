import type { AnyRecord, NormalizedMessage } from '@/shared/types.js';
import { readObjectRecord } from '@/shared/utils.js';

/**
 * Cross-provider unification of the two interaction surfaces that Claude and
 * Codex both have but spell differently: the running checklist and the
 * ask-the-user round trip.
 *
 * Each provider parses its own transcript format first; this pass runs once the
 * tool results have been attached and rewrites those rows onto a single
 * canonical shape, so the chat needs exactly one renderer per surface:
 *
 * - checklist → a `TodoWrite` call whose input is the full list at that point
 * - question  → an `AskUserQuestion` call whose input carries the chosen answers
 *
 * Doing it here rather than in each provider is what keeps the two feeling like
 * one product: Claude's incremental `TaskCreate`/`TaskUpdate` calls and Codex's
 * whole-list `update_plan` calls both come out as the same evolving checklist.
 */

//----------------- CANONICAL TOOL NAMES ------------

/** The one tool name every provider's checklist is rewritten onto. */
const CHECKLIST_TOOL = 'TodoWrite';

/** The one tool name every provider's user-question call is rewritten onto. */
const ASK_TOOL = 'AskUserQuestion';

/** Provider spellings of the ask-the-user tool. Codex calls it `request_user_input`. */
const ASK_TOOL_ALIASES = new Set([ASK_TOOL, 'request_user_input']);

/**
 * Claude's incremental task tracker. Each call mutates one entry of a list the
 * transcript never states in full, so the list is rebuilt here and every call
 * is replaced by the resulting snapshot.
 */
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);

//----------------- SHARED PAYLOAD READERS ------------

/**
 * Reads a tool payload that providers store either as an object (Claude) or as
 * the raw JSON string it arrived as (Codex).
 */
function readToolPayload(value: unknown): AnyRecord | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) {
      return null;
    }
    try {
      return readObjectRecord(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }

  return readObjectRecord(value);
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : '';
}

//----------------- ASK-THE-USER ANSWERS ------------

/**
 * Flattens one answer value into the comma-joined label list the question view
 * renders. Claude stores the labels already joined, Codex stores them as
 * `{ answers: [...] }`, and a multi-select answer is an array either way.
 */
function readAnswerLabels(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string').join(', ');
  }

  const record = readObjectRecord(value);
  return record ? readAnswerLabels(record.answers) : '';
}

/**
 * Recovers the answers from Claude's acknowledgement sentence.
 *
 * A live turn only carries the prose result — `Your questions have been
 * answered: "<question>"="<answer>".` — because the structured `toolUseResult`
 * is written when the transcript is persisted, not when the tool returns. The
 * selection would otherwise be invisible for the whole run.
 */
function readAnswersFromAcknowledgement(content: string): Record<string, string> {
  if (!content.includes('questions have been answered')) {
    return {};
  }

  const answers: Record<string, string> = {};
  const pattern = /"([^"]+)"\s*=\s*"([^"]*)"/g;
  let match = pattern.exec(content);
  while (match) {
    answers[match[1]] = match[2];
    match = pattern.exec(content);
  }

  return answers;
}

/**
 * Rewrites answers onto the question text they belong to.
 *
 * Codex keys its answers by the question's `id`; Claude keys them by the
 * question text. Settling on the text means the renderer needs no provider
 * knowledge to pair a question with its answer.
 */
function keyAnswersByQuestion(questions: unknown, rawAnswers: AnyRecord): Record<string, string> {
  const questionById = new Map<string, string>();
  if (Array.isArray(questions)) {
    for (const entry of questions) {
      const question = readObjectRecord(entry);
      const id = readNonEmptyString(question?.id);
      const text = readNonEmptyString(question?.question);
      if (id && text) {
        questionById.set(id, text);
      }
    }
  }

  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawAnswers)) {
    const labels = readAnswerLabels(value);
    if (labels) {
      answers[questionById.get(key) ?? key] = labels;
    }
  }

  return answers;
}

/** Pulls the answer map out of whichever result shape the provider produced. */
function readAskAnswers(message: NormalizedMessage): AnyRecord | null {
  const structured = readObjectRecord(readObjectRecord(message.toolResult?.toolUseResult)?.answers);
  if (structured) {
    return structured;
  }

  const content = readNonEmptyString(message.toolResult?.content);
  if (!content) {
    return null;
  }

  const fromPayload = readObjectRecord(readToolPayload(content)?.answers);
  if (fromPayload) {
    return fromPayload;
  }

  const fromSentence = readAnswersFromAcknowledgement(content);
  return Object.keys(fromSentence).length > 0 ? fromSentence : null;
}

/**
 * Normalizes one ask-the-user call: canonical name, and the answers folded into
 * the input so the question and what was picked render as one card instead of a
 * question card followed by an unreadable result blob.
 */
function unifyAskCall(message: NormalizedMessage): void {
  message.toolName = ASK_TOOL;

  const input = readToolPayload(message.toolInput);
  if (!input || !Array.isArray(input.questions)) {
    return;
  }

  const rawAnswers = readAskAnswers(message);
  message.toolInput = rawAnswers
    ? { ...input, answers: keyAnswersByQuestion(input.questions, rawAnswers) }
    : input;
}

//----------------- RUNNING CHECKLIST ------------

type ChecklistEntry = {
  id: string;
  content: string;
  status: string;
  activeForm?: string;
};

/** Claude's task statuses already match the todo vocabulary; anything else is pending. */
function readTaskStatus(value: unknown): string {
  const status = readNonEmptyString(value);
  return status === 'in_progress' || status === 'completed' ? status : 'pending';
}

/**
 * Replays Claude's task-tracker calls into the list they describe.
 *
 * `TaskCreate` returns the id the tracker assigned, so entries are keyed by it
 * and later `TaskUpdate` calls land on the right row. A create whose result has
 * not arrived yet is keyed by its tool call id, which is unique for the same
 * reason an assigned id would be.
 */
class ChecklistState {
  private readonly entries = new Map<string, ChecklistEntry>();

  applyTaskCall(message: NormalizedMessage): void {
    const input = readToolPayload(message.toolInput) ?? {};
    const result = readObjectRecord(message.toolResult?.toolUseResult);

    // A listing restates the whole tracker, which is the most reliable source
    // there is — adopt it wholesale. It omits the present-tense wording each
    // task was created with, so that is carried over from what is already known.
    const listed = result?.tasks;
    if (Array.isArray(listed)) {
      const known = new Map(this.entries);
      this.entries.clear();
      for (const entry of listed) {
        const task = readObjectRecord(entry);
        const activeForm = known.get(readNonEmptyString(task?.id))?.activeForm ?? '';
        this.upsertTask(task, { content: '', activeForm });
      }
      return;
    }

    const single = readObjectRecord(result?.task);
    if (single) {
      this.upsertTask(single, {
        content: readNonEmptyString(input.subject),
        activeForm: readNonEmptyString(input.activeForm),
      });
      return;
    }

    const id = readNonEmptyString(input.taskId) || readNonEmptyString(message.toolId);
    if (!id) {
      return;
    }

    const existing = this.entries.get(id);
    this.entries.set(id, {
      id,
      content: readNonEmptyString(input.subject) || existing?.content || id,
      status: input.status === undefined ? existing?.status ?? 'pending' : readTaskStatus(input.status),
      activeForm: readNonEmptyString(input.activeForm) || existing?.activeForm,
    });
  }

  private upsertTask(task: AnyRecord | null, defaults: { content: string; activeForm: string } = { content: '', activeForm: '' }): void {
    if (!task) {
      return;
    }

    const id = readNonEmptyString(task.id);
    if (!id) {
      return;
    }

    const existing = this.entries.get(id);
    this.entries.set(id, {
      id,
      content: readNonEmptyString(task.subject) || defaults.content || existing?.content || id,
      status: task.status === undefined ? existing?.status ?? 'pending' : readTaskStatus(task.status),
      activeForm: defaults.activeForm || existing?.activeForm,
    });
  }

  snapshot(): ChecklistEntry[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }));
  }
}

/** True for a tool row that already carries a whole checklist in its input. */
function isChecklistSnapshot(message: NormalizedMessage): boolean {
  return message.kind === 'tool_use' && message.toolName === CHECKLIST_TOOL;
}

/**
 * Identity of a checklist as it is drawn: the steps and their states, and
 * nothing else. Two snapshots with the same signature look identical on screen,
 * so only the first is worth keeping.
 */
function readChecklistSignature(message: NormalizedMessage): string {
  const todos = readToolPayload(message.toolInput)?.todos;
  if (!Array.isArray(todos)) {
    return '';
  }

  return JSON.stringify(todos.map((todo) => {
    const entry = readObjectRecord(todo);
    return [readNonEmptyString(entry?.content), readTaskStatus(entry?.status)];
  }));
}

//----------------- TOOL OUTPUT SIZE ------------

/**
 * Longest tool output one transcript row carries.
 *
 * A provider records whatever the tool returned, which for a `Read` of a
 * screenshot is a base64 image and for a long test run is the whole log. The
 * transcript shows that output inside a collapsed section, so past roughly a
 * screenful of scrolling nobody reads further — but every byte is parsed,
 * stored and held in memory for the life of the session. Real Claude sessions
 * ship megabytes per page this way.
 */
const MAX_TOOL_RESULT_CONTENT = 40_000;

function truncateOutput(value: string): string {
  if (value.length <= MAX_TOOL_RESULT_CONTENT) {
    return value;
  }

  const omitted = value.length - MAX_TOOL_RESULT_CONTENT;
  return `${value.slice(0, MAX_TOOL_RESULT_CONTENT)}\n… ${omitted} more characters`;
}

/**
 * Applies the same cap to every string inside a provider's structured result.
 *
 * The structure is preserved rather than dropped wholesale because the
 * transcript reads small fields out of it (a search's file list, for one), and
 * only a single oversized string — a file body or an encoded image — is ever
 * the thing making it large.
 */
function truncateNestedOutput(value: unknown): unknown {
  if (typeof value === 'string') {
    return truncateOutput(value);
  }

  if (Array.isArray(value)) {
    return value.map(truncateNestedOutput);
  }

  const record = readObjectRecord(value);
  if (!record) {
    return value;
  }

  const truncated: AnyRecord = {};
  for (const [key, entry] of Object.entries(record)) {
    truncated[key] = truncateNestedOutput(entry);
  }
  return truncated;
}

function capToolResult(message: NormalizedMessage): void {
  const result = message.toolResult;
  if (!result) {
    return;
  }

  if (typeof result.content === 'string') {
    result.content = truncateOutput(result.content);
  }
  if (result.toolUseResult !== undefined) {
    result.toolUseResult = truncateNestedOutput(result.toolUseResult);
  }
}

//----------------- TRANSCRIPT PASS ------------

/**
 * Turns one loaded history into exactly the rows the transcript draws.
 *
 * Three things happen here:
 *
 * 1. Provider-specific interaction rows are rewritten onto the canonical
 *    shapes described above.
 * 2. Checklist snapshots that a later snapshot supersedes are dropped.
 *    Consecutive snapshots are the normal case once incremental task calls are
 *    replayed — three `TaskCreate` calls in a row describe one list, not three
 *    — and keeping only the last of a run turns a wall of near-identical cards
 *    into the single checklist the model was actually building. Snapshots
 *    separated by real work are all kept, so the list still reappears wherever
 *    it changed.
 * 3. Standalone tool-result rows are dropped, because the provider has already
 *    attached each result to the call it belongs to and the chat draws it
 *    there. Shipping the row twice is half of everything a tool-heavy Claude
 *    session sends.
 * 4. Tool output is capped, so one `Read` of an image cannot cost the session
 *    a megabyte of memory for content nothing renders.
 *
 * Mutates and returns the given array; callers own it.
 */
export function prepareTranscriptMessages(messages: NormalizedMessage[]): NormalizedMessage[] {
  const checklist = new ChecklistState();

  for (const message of messages) {
    if (message.kind !== 'tool_use' || !message.toolName) {
      continue;
    }

    if (ASK_TOOL_ALIASES.has(message.toolName)) {
      unifyAskCall(message);
      continue;
    }

    if (TASK_TOOLS.has(message.toolName)) {
      checklist.applyTaskCall(message);
      message.toolName = CHECKLIST_TOOL;
      message.toolInput = { todos: checklist.snapshot() };
    }
  }

  // After the rewrites, so a folded-in answer is read from the full result.
  for (const message of messages) {
    capToolResult(message);
  }

  const superseded = new Set<number>();
  let openSnapshotIndex = -1;
  let keptSignature: string | null = null;

  messages.forEach((message, index) => {
    // A result row renders as part of its call, so it must not break a run of
    // snapshots apart — the results of the calls being folded away sit exactly
    // between them.
    if (message.kind === 'tool_result') {
      return;
    }

    if (!isChecklistSnapshot(message)) {
      openSnapshotIndex = -1;
      return;
    }

    // Restating a checklist that has not moved since it was last drawn adds
    // nothing, however far apart the two calls are.
    const signature = readChecklistSignature(message);
    if (signature === keptSignature) {
      superseded.add(index);
      return;
    }

    if (openSnapshotIndex !== -1) {
      superseded.add(openSnapshotIndex);
    }
    openSnapshotIndex = index;
    keptSignature = signature;
  });

  // A result that names its call is only ever drawn through that call. The one
  // shape worth keeping is a result with no call to attach to, which the chat
  // renders on its own.
  return messages.filter((message, index) => (
    !superseded.has(index)
    && !(message.kind === 'tool_result' && message.toolId)
  ));
}

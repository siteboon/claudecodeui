import type { NormalizedMessage } from '@/shared/types';

/**
 * Rebuilds the session's task ledger from the transcript.
 *
 * Two shapes feed the same ledger, and both arrive as `tool_use` rows:
 * - a whole-list snapshot — Claude's `TodoWrite` (and Codex's `update_plan`,
 *   which the Codex adapter already normalizes into the TodoWrite shape) —
 *   restates every step, so the latest one wins;
 * - the incremental task tracker — `TaskCreate`/`TaskUpdate`/`TaskList`/
 *   `TaskGet` — where each call moves one row, keyed by the id the tracker
 *   assigned in the call's result.
 *
 * This is the read-side twin of `server/shared/message-unification.ts`'s
 * `ChecklistState`, kept in sync by the shared test fixtures; change the
 * replay rules there and mirror them here. Subagent tool rows
 * (`parentToolUseId` set) belong to a child transcript, not this ledger.
 */

export type SessionTaskStatus = 'pending' | 'in_progress' | 'completed';

export type SessionTask = {
  id: string;
  content: string;
  status: SessionTaskStatus;
  activeForm?: string;
};

export type SessionTaskLedger = {
  tasks: SessionTask[];
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
};

const CHECKLIST_TOOL = 'TodoWrite';
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);

type AnyRecord = Record<string, unknown>;

function readObjectRecord(value: unknown): AnyRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as AnyRecord)
    : null;
}

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

/** Claude's task statuses already match the todo vocabulary; anything else is pending. */
function readTaskStatus(value: unknown): SessionTaskStatus {
  const status = readNonEmptyString(value);
  return status === 'in_progress' || status === 'completed' ? status : 'pending';
}

/** True for a tool row that already carries a whole checklist in its input. */
function isChecklistSnapshot(message: NormalizedMessage): boolean {
  return message.kind === 'tool_use' && message.toolName === CHECKLIST_TOOL;
}

/**
 * Identity of a checklist as it is drawn: the steps and their states, and
 * nothing else. Consecutive snapshots with the same signature replay as one.
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

/** Replays the incremental tracker calls into the list they describe. */
class TrackerState {
  private readonly entries = new Map<string, SessionTask>();

  applyTaskCall(message: NormalizedMessage): void {
    const input = readToolPayload(message.toolInput) ?? {};
    const result = readObjectRecord(message.toolResult?.toolUseResult);

    // A listing restates the whole tracker — adopt it wholesale, carrying the
    // present-tense wording already known for ids the listing omits.
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
    const id = readNonEmptyString(task?.id);
    if (!id) {
      return;
    }

    const existing = this.entries.get(id);
    this.entries.set(id, {
      id,
      content: readNonEmptyString(task?.subject) || defaults.content || existing?.content || id,
      status: task?.status === undefined ? existing?.status ?? 'pending' : readTaskStatus(task.status),
      activeForm: defaults.activeForm || existing?.activeForm,
    });
  }

  snapshot(): SessionTask[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }));
  }
}

/**
 * Replays the transcript into the task ledger. `TodoWrite` snapshots and the
 * incremental tracker calls both write the same ledger: snapshots replace it
 * wholesale (signatures collapse replay churn), tracker calls move one row.
 */
export function buildSessionTaskLedger(messages: NormalizedMessage[]): SessionTaskLedger {
  const tracker = new TrackerState();
  let snapshotTasks: SessionTask[] | null = null;
  let lastSignature = '';
  // Whichever source wrote the ledger last owns it — providers do not mix the
  // snapshot and tracker styles, but a resumed/edited transcript can contain
  // both, and the later write is the fresher truth.
  let lastWriter: 'snapshot' | 'tracker' | null = null;

  for (const message of messages) {
    // A subagent's checklist is the child's own work; the panel's ledger
    // tracks what the main agent committed to.
    if (message.parentToolUseId) {
      continue;
    }

    if (message.kind !== 'tool_use' || !message.toolName) {
      continue;
    }

    if (isChecklistSnapshot(message)) {
      const signature = readChecklistSignature(message);
      if (signature && signature === lastSignature) {
        lastWriter = 'snapshot';
        continue;
      }
      lastSignature = signature;

      const todos = readToolPayload(message.toolInput)?.todos;
      snapshotTasks = Array.isArray(todos)
        ? todos.flatMap((todo, index) => {
            const entry = readObjectRecord(todo);
            const content = readNonEmptyString(entry?.content);
            if (!content) {
              return [];
            }
            return [{
              id: readNonEmptyString(entry?.id) || `todo-${index}`,
              content,
              status: readTaskStatus(entry?.status),
              activeForm: readNonEmptyString(entry?.activeForm) || undefined,
            } satisfies SessionTask];
          })
        : [];
      lastWriter = 'snapshot';
      continue;
    }

    if (TASK_TOOLS.has(message.toolName)) {
      tracker.applyTaskCall(message);
      lastWriter = 'tracker';
    }
  }

  const tasks = lastWriter === 'tracker' ? tracker.snapshot() : lastWriter === 'snapshot' ? (snapshotTasks ?? []) : [];

  const completed = tasks.filter((task) => task.status === 'completed').length;
  const inProgress = tasks.filter((task) => task.status === 'in_progress').length;
  return {
    tasks,
    total: tasks.length,
    completed,
    inProgress,
    pending: tasks.length - completed - inProgress,
  };
}

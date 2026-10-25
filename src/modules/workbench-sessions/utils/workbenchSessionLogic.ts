import type { WorkbenchHookAgent, WorkbenchHooksStatus, WorkbenchSession, WorkbenchStatus } from '@/shared/types';

/** Presentation hints for one session status; `labelKey` is a `workbench` namespace key. */
type StatusBadge = {
  labelKey: string;
  /** Tailwind classes for the pill. */
  className: string;
  /** Whether the dot beside the label should pulse (the CLI is actively working). */
  pulse: boolean;
};

const STATUS_BADGES: Record<WorkbenchStatus, StatusBadge> = {
  running: {
    labelKey: 'status.running',
    className: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
    pulse: true,
  },
  waiting: {
    labelKey: 'status.waiting',
    className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    pulse: true,
  },
  done: {
    labelKey: 'status.done',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    pulse: false,
  },
  error: {
    labelKey: 'status.error',
    className: 'bg-red-500/10 text-red-700 dark:text-red-300',
    pulse: false,
  },
};

/** Maps a server status to its badge; unknown future statuses fall back to the neutral running look. */
export function getStatusBadge(status: string): StatusBadge {
  return STATUS_BADGES[status as WorkbenchStatus] ?? STATUS_BADGES.running;
}

/** Last path segment of a folder path, tolerating both separators and trailing slashes. */
export function getProjectNameFromPath(projectPath: string): string {
  const segments = projectPath.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] ?? projectPath;
}

type SessionGroup = {
  projectPath: string;
  projectName: string;
  sessions: WorkbenchSession[];
};

/**
 * Groups sessions by project. Sessions inside a group and the groups themselves are ordered by
 * most recent activity, so what the user touched last is at the top.
 */
export function groupSessionsByProject(sessions: WorkbenchSession[]): SessionGroup[] {
  const byProject = new Map<string, WorkbenchSession[]>();
  for (const session of sessions) {
    const bucket = byProject.get(session.projectPath);
    if (bucket) bucket.push(session);
    else byProject.set(session.projectPath, [session]);
  }

  const newestFirst = (a: WorkbenchSession, b: WorkbenchSession) =>
    b.lastActivityAt.localeCompare(a.lastActivityAt);

  return [...byProject.entries()]
    .map(([projectPath, group]) => ({
      projectPath,
      projectName: getProjectNameFromPath(projectPath),
      sessions: [...group].sort(newestFirst),
    }))
    .sort((a, b) => newestFirst(a.sessions[0], b.sessions[0]));
}

/** Compact age such as "now", "5m", "3h" or "2d" for the session list. */
export function formatCompactAge(isoTimestamp: string, now: number): string {
  const then = Date.parse(isoTimestamp);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 45) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Polling state: the latest snapshot plus the statuses seen, which is what transitions are detected against. */
export type SessionsPollState = {
  sessions: WorkbenchSession[];
  /** Null until the first successful snapshot, so loading the page never fires notifications. */
  statusById: Record<string, WorkbenchStatus> | null;
  error: string | null;
};

export const INITIAL_POLL_STATE: SessionsPollState = { sessions: [], statusById: null, error: null };

/** Statuses worth interrupting the user for. */
const NOTIFY_STATUSES: ReadonlySet<WorkbenchStatus> = new Set(['waiting', 'done']);

/**
 * Applies one successful poll. Returns the next state and the sessions that just switched into
 * `waiting` or `done` since the previous snapshot (new sessions and the first snapshot never notify).
 */
export function applySessionsSnapshot(
  state: SessionsPollState,
  sessions: WorkbenchSession[],
): { state: SessionsPollState; notify: WorkbenchSession[] } {
  const previous = state.statusById;
  const statusById: Record<string, WorkbenchStatus> = {};
  const notify: WorkbenchSession[] = [];

  for (const session of sessions) {
    statusById[session.id] = session.status;
    const before = previous?.[session.id];
    if (before !== undefined && before !== session.status && NOTIFY_STATUSES.has(session.status)) {
      notify.push(session);
    }
  }

  return { state: { sessions, statusById, error: null }, notify };
}

/** A failed poll keeps the last good data (and status history) and records the error for display. */
export function applySessionsError(state: SessionsPollState, message: string): SessionsPollState {
  return { ...state, error: message };
}

/** Every CLI Workbench can install status hooks for, in display order. */
export const HOOK_AGENTS: readonly WorkbenchHookAgent[] = ['claude', 'codex'];

/**
 * Reads the per-agent install state from a hooks status response. Older servers only send the
 * top-level Claude fields, so Claude falls back to them and Codex reads as not installed.
 */
export function getAgentHookState(
  status: WorkbenchHooksStatus,
  agent: WorkbenchHookAgent,
): { installed: boolean; settingsPath: string } {
  const entry = status.agents?.[agent];
  if (entry) return entry;
  return agent === 'claude'
    ? { installed: status.installed, settingsPath: status.settingsPath }
    : { installed: false, settingsPath: '' };
}

/** Whether the first-session prompt should open: only while some CLI still lacks hooks and the user has not said "don't ask". */
export function shouldOfferHooksConsent(status: WorkbenchHooksStatus, declined: boolean): boolean {
  if (declined) return false;
  return HOOK_AGENTS.some((agent) => !getAgentHookState(status, agent).installed);
}

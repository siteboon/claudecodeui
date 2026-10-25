import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getRunScript } from '@/modules/workbench-sessions/workbench-config.js';
import { findCliSessionId, homeDataDir } from '@/modules/workbench-sessions/workbench-sessions.service.js';
import {
  workbenchSessionsStore,
  type WorkbenchSession,
  type WorkbenchStatus,
} from '@/modules/workbench-sessions/workbench-sessions.store.js';

/** Per-process secret; only PTYs launched by this server receive it. */
const hookToken = randomBytes(24).toString('hex');

/** Seconds of PTY silence after which a session without hook events is treated as waiting. */
export const IDLE_WAITING_MS = 20_000;

export function getHookToken(): string {
  return hookToken;
}

export type SessionLaunch = {
  sessionId: string;
  cwd: string;
  command: string;
  provider: WorkbenchSession['agent'];
  env: Record<string, string>;
  isRun?: boolean;
};

/** First port handed out to per-session dev servers; each session gets its own offset. */
export const RUN_PORT_BASE = 4100;

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Builds the shell command for a session's PTY. The first prompt travels through a file
 * (read by the shell at launch), so no user text is ever interpolated into the command.
 */
export async function buildLaunch(session: WorkbenchSession, platform: NodeJS.Platform = process.platform): Promise<SessionLaunch> {
  const quote = platform === 'win32' ? powershellQuote : posixQuote;
  const resumeId = session.launched ? findCliSessionId(session) : null;
  let command: string;

  if (resumeId) {
    command = session.agent === 'claude'
      ? `claude --resume ${quote(resumeId)}`
      : `codex resume ${quote(resumeId)}`;
  } else if (!session.launched && session.firstPrompt.trim()) {
    const promptDir = path.join(homeDataDir(), 'prompts');
    await mkdir(promptDir, { recursive: true });
    const promptFile = path.join(promptDir, `${session.id}.txt`);
    // A leading dash would be read as an option; a leading space avoids that.
    const text = session.firstPrompt.startsWith('-') ? ` ${session.firstPrompt}` : session.firstPrompt;
    await writeFile(promptFile, text, 'utf8');
    const reader = platform === 'win32'
      ? `(Get-Content -Raw -Encoding UTF8 -LiteralPath ${quote(promptFile)})`
      : `"$(cat ${quote(promptFile)})"`;
    command = `${session.agent} ${reader}`;
  } else {
    // Already launched before but no CLI session is known: start fresh in the same worktree.
    command = session.agent;
  }

  return {
    sessionId: session.id,
    cwd: session.worktreePath,
    command,
    provider: session.agent,
    env: {
      WORKBENCH_SESSION_ID: session.id,
      WORKBENCH_PORT: process.env.SERVER_PORT || '3001',
      WORKBENCH_HOOK_TOKEN: hookToken,
    },
  };
}

/**
 * Launch spec for the project's run script (for example `npm run dev`) in the session's
 * worktree. Each session gets its own PORT so parallel dev servers do not collide.
 */
export async function buildRunLaunch(session: WorkbenchSession): Promise<SessionLaunch | null> {
  const script = await getRunScript(session.projectPath);
  if (!script) return null;
  const ordered = workbenchSessionsStore.list().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const index = Math.max(0, ordered.findIndex((entry) => entry.id === session.id));
  return {
    sessionId: session.id,
    cwd: session.worktreePath,
    command: script,
    provider: session.agent,
    isRun: true,
    env: { PORT: String(RUN_PORT_BASE + index), WORKBENCH_SESSION_ID: session.id },
  };
}

// ---- status tracking ------------------------------------------------------

const hookDriven = new Set<string>();
const idleTimers = new Map<string, NodeJS.Timeout>();
const lastTouch = new Map<string, number>();

function emitStatus(session: WorkbenchSession, status: WorkbenchStatus): void {
  if (typeof process.send === 'function') {
    process.send({ type: 'workbench:status', sessionId: session.id, title: session.title, status });
  }
}

export function setStatus(id: string, status: WorkbenchStatus): void {
  const session = workbenchSessionsStore.get(id);
  if (!session || session.status === 'discarded' || session.status === status) {
    if (session) workbenchSessionsStore.touch(id);
    return;
  }
  workbenchSessionsStore.setStatus(id, status);
  if (status === 'waiting' || status === 'done' || status === 'error') {
    emitStatus(session, status);
  }
}

export function onSessionLaunched(id: string): void {
  workbenchSessionsStore.markLaunched(id);
  setStatus(id, 'running');
}

/** PTY produced output. Hook events win over this heuristic once seen. */
export function onSessionOutput(id: string): void {
  const now = Date.now();
  if (now - (lastTouch.get(id) ?? 0) > 5000) {
    lastTouch.set(id, now);
    workbenchSessionsStore.touch(id);
  }
  if (hookDriven.has(id)) return;
  const session = workbenchSessionsStore.get(id);
  if (session && session.status !== 'running' && session.status !== 'discarded') {
    setStatus(id, 'running');
  }
  clearTimeout(idleTimers.get(id));
  const timer = setTimeout(() => {
    if (!hookDriven.has(id)) setStatus(id, 'waiting');
  }, IDLE_WAITING_MS);
  timer.unref();
  idleTimers.set(id, timer);
}

export function onSessionExit(id: string, exitCode: number): void {
  clearTimeout(idleTimers.get(id));
  idleTimers.delete(id);
  setStatus(id, exitCode === 0 ? 'done' : 'error');
}

const HOOK_EVENT_STATUS: Record<string, WorkbenchStatus> = {
  Notification: 'waiting',
  PermissionRequest: 'waiting',
  Stop: 'done',
  UserPromptSubmit: 'running',
};

/** Handles a status hook POST. Returns false for unknown sessions or events. */
export function recordHookEvent(id: string, event: string): boolean {
  const status = HOOK_EVENT_STATUS[event];
  if (!status || !workbenchSessionsStore.get(id)) return false;
  hookDriven.add(id);
  clearTimeout(idleTimers.get(id));
  setStatus(id, status);
  return true;
}

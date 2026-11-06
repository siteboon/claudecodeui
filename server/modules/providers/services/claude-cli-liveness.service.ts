import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * One Claude CLI process that is currently producing a response.
 *
 * `providerSessionId` is Claude's own session id, which is what the registry
 * records; callers map it onto an app session themselves.
 */
type LiveClaudeCliSession = {
  providerSessionId: string;
  startedAt: number;
};

/**
 * Claude Code keeps one file per running session here, named `<pid>.json`.
 * The directory belongs to the CLI, not to CloudCLI: it is only ever read.
 */
const registryDirectory = () => path.join(os.homedir(), '.claude', 'sessions');

/**
 * Upper bound on registry files inspected per poll.
 *
 * The running-sessions endpoint is polled continuously, so a directory left
 * full of stale files by repeated crashes must not turn every poll into
 * unbounded filesystem work. Real installations hold a handful of entries.
 */
const MAX_REGISTRY_FILES = 256;

/**
 * Whether `pid` is still the process the registry recorded.
 *
 * A registry file outlives a crash, so its mere presence proves nothing. The
 * signal-0 probe answers "does this pid exist" (EPERM means it exists but is
 * owned by someone else, which still counts), and on Linux the recorded
 * `procStart` is compared against the kernel's start-time for that pid so a
 * reused pid cannot be mistaken for the original process.
 */
function isRecordedProcessAlive(pid: number, procStart: unknown): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EPERM') {
      return false;
    }
  }

  if (process.platform !== 'linux' || typeof procStart !== 'string' || !procStart) {
    return true;
  }

  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // The comm field is parenthesised and may itself contain spaces, so the
    // fields are counted from the last ')'. starttime is the 22nd field
    // overall, i.e. the 20th of what follows the comm field.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return fields[19] === procStart;
  } catch {
    // No procfs entry means the process is gone between the two checks.
    return false;
  }
}

/** Reads one registry file, returning null for anything that is not a live busy session. */
async function readLiveBusySession(filePath: string): Promise<LiveClaudeCliSession | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch {
    // Unreadable, half-written or malformed entries are simply not evidence
    // of a running session.
    return null;
  }

  const record = parsed as Record<string, unknown> | null;
  if (!record || typeof record !== 'object') {
    return null;
  }

  const providerSessionId = typeof record.sessionId === 'string' ? record.sessionId : '';
  const pid = typeof record.pid === 'number' ? record.pid : NaN;
  if (!providerSessionId || !Number.isInteger(pid) || pid <= 0 || record.status !== 'busy') {
    return null;
  }

  if (!isRecordedProcessAlive(pid, record.procStart)) {
    return null;
  }

  const startedAt = typeof record.startedAt === 'number' ? record.startedAt : Date.now();
  return { providerSessionId, startedAt };
}

/**
 * Lists the Claude CLI sessions that are mid-turn right now.
 *
 * Used by the providers module's sessions service so the running-sessions poll
 * also reports turns driven outside CloudCLI's own chat runs — including the
 * `claude` processes CloudCLI itself spawns for the Shell view, which live in
 * the PTY map rather than the chat-run registry. Liveness is ephemeral, so it
 * is recomputed on every read instead of being cached or persisted.
 */
export async function listBusyClaudeCliSessions(): Promise<LiveClaudeCliSession[]> {
  let entries: string[];
  try {
    entries = await fsp.readdir(registryDirectory());
  } catch {
    // No registry directory at all is the normal case for an install that has
    // never run the CLI, and an unreadable one is not worth failing a poll for.
    return [];
  }

  const registryFiles = entries.filter((entry) => entry.endsWith('.json')).slice(0, MAX_REGISTRY_FILES);
  const sessions = await Promise.all(
    registryFiles.map((entry) => readLiveBusySession(path.join(registryDirectory(), entry))),
  );

  return sessions.filter((session): session is LiveClaudeCliSession => session !== null);
}

/** Job ids end up in a shell command line, so only plain id characters pass. */
const SAFE_JOB_ID = /^[A-Za-z0-9_.:-]+$/;

/**
 * The job id of the live background Claude process (`claude --bg`, or a
 * session sent to the background) that holds `providerSessionId`, or null.
 *
 * The CLI refuses `claude --resume` for such a session and asks for
 * `claude attach <job id>` instead, so the Shell view launches that.
 *
 * Used by the websocket module's Shell gateway when it builds a launch
 * command. It is synchronous because the launch command is built
 * synchronously; the registry holds a handful of small files.
 */
export function findBackgroundClaudeJobId(providerSessionId: string): string | null {
  if (!providerSessionId) {
    return null;
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(registryDirectory());
  } catch {
    return null;
  }

  for (const entry of entries.filter((name) => name.endsWith('.json')).slice(0, MAX_REGISTRY_FILES)) {
    let record: Record<string, unknown> | null;
    try {
      record = JSON.parse(fs.readFileSync(path.join(registryDirectory(), entry), 'utf8'));
    } catch {
      continue;
    }
    if (
      !record ||
      typeof record !== 'object' ||
      record.kind !== 'bg' ||
      record.sessionId !== providerSessionId ||
      typeof record.jobId !== 'string' ||
      !SAFE_JOB_ID.test(record.jobId)
    ) {
      continue;
    }
    const pid = typeof record.pid === 'number' ? record.pid : NaN;
    if (Number.isInteger(pid) && pid > 0 && isRecordedProcessAlive(pid, record.procStart)) {
      return record.jobId;
    }
  }

  return null;
}

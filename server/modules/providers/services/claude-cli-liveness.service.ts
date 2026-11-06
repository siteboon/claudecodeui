import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ClaudeCliProcessSession } from '@/shared/types.js';

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
 * Claude Code keeps one file per running session here, named `<pid>.json`,
 * under its config directory: `CLAUDE_CONFIG_DIR` when that is set (the server
 * forwards its env to every CLI it spawns), `~/.claude` otherwise. The
 * directory belongs to the CLI, not to CloudCLI: it is only ever read.
 */
const registryDirectory = () => {
  const configDirectory = process.env.CLAUDE_CONFIG_DIR?.trim();
  const baseDirectory = configDirectory && path.isAbsolute(configDirectory)
    ? configDirectory
    : path.join(os.homedir(), '.claude');
  return path.join(baseDirectory, 'sessions');
};

/**
 * Upper bound on registry files inspected per poll.
 *
 * The running-sessions endpoint is polled continuously, so a directory left
 * full of stale files by repeated crashes must not turn every poll into
 * unbounded filesystem work. Real installations hold a handful of entries.
 */
const MAX_REGISTRY_FILES = 256;

/** Whether a process with this pid exists (EPERM: it does, owned by someone else). */
function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

/**
 * The registry's `.json` entries worth reading. An entry named after a pid
 * that no longer exists is left out without being read, so crash leftovers
 * neither cost a read nor count towards `limit`. `pidNamedOnly` also leaves
 * out entries not named `<pid>.json`.
 */
async function listRegistryEntries(
  { limit = MAX_REGISTRY_FILES, pidNamedOnly = false }: { limit?: number; pidNamedOnly?: boolean } = {},
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fsp.readdir(registryDirectory());
  } catch {
    return [];
  }
  return entries
    .filter((entry) => {
      if (!entry.endsWith('.json')) {
        return false;
      }
      const pidName = /^(\d+)\.json$/.exec(entry);
      return pidName ? pidExists(Number(pidName[1])) : !pidNamedOnly;
    })
    .slice(0, limit);
}

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
  if (!pidExists(pid)) {
    return false;
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

/** A registry record that is still the live process it describes, or null. */
async function readLiveRecord(pid: number): Promise<Record<string, unknown> | null> {
  let record: Record<string, unknown> | null;
  try {
    record = JSON.parse(await fsp.readFile(path.join(registryDirectory(), `${pid}.json`), 'utf8'));
  } catch {
    return null;
  }
  if (!record || typeof record !== 'object' || record.pid !== pid || !isRecordedProcessAlive(pid, record.procStart)) {
    return null;
  }
  return record;
}

/** The live registry entry Claude Code wrote for `pid`, if any. */
async function readLiveProcessSession(pid: number): Promise<ClaudeCliProcessSession | null> {
  const record = await readLiveRecord(pid);
  if (!record || typeof record.sessionId !== 'string' || !record.sessionId) {
    return null;
  }
  return { pid, providerSessionId: record.sessionId };
}

/**
 * Reads the parent pid of each of `pids`, or of none where that cannot be
 * done. Linux has procfs; macOS and the BSDs answer through one `ps` call for
 * the whole set. Windows is not supported, so only a CLI that is the pty
 * process itself (or a background job it attached to) is found there.
 */
async function readParentPids(pids: number[]): Promise<Map<number, number>> {
  const parents = new Map<number, number>();
  if (pids.length === 0 || process.platform === 'win32') {
    return parents;
  }
  if (process.platform === 'linux') {
    await Promise.all(pids.map(async (pid) => {
      try {
        // Fields after the parenthesised comm field: state, then ppid.
        const stat = await fsp.readFile(`/proc/${pid}/stat`, 'utf8');
        const parentPid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
        if (Number.isInteger(parentPid)) {
          parents.set(pid, parentPid);
        }
      } catch {
        // Gone since the registry was listed.
      }
    }));
    return parents;
  }
  const output = await new Promise<string>((resolve) => {
    try {
      execFile('ps', ['-o', 'pid=,ppid=', '-p', pids.join(',')], { encoding: 'utf8', timeout: 2000 }, (_error, stdout) => {
        // ps exits non-zero when some pids are gone but still lists the others.
        resolve(typeof stdout === 'string' ? stdout : '');
      });
    } catch {
      // Spawning can fail synchronously (e.g. EPERM under a sandbox profile).
      resolve('');
    }
  });
  for (const line of output.split('\n')) {
    const [pid, parentPid] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(pid) && Number.isInteger(parentPid) && parentPid > 0) {
      parents.set(pid, parentPid);
    }
  }
  return parents;
}

/**
 * Finds the Claude CLI that a pty started and the session it is in now.
 *
 * Claude Code rewrites its registry entry when `/clear` or `/resume` moves the
 * CLI to another session, so this is how the Shell gateway learns about the
 * switch. The CLI is the pty process itself when the shell execs it, or one of
 * its children otherwise. A pty that runs `claude attach <job>` shows a
 * background process it did not start, found by `backgroundJobId` instead.
 *
 * Used by the websocket module's Shell gateway, polled per open Claude pty.
 * All reads are asynchronous, and one poll spawns at most one `ps`.
 */
export async function findClaudeCliProcessSession(
  rootPid: number,
  knownPid: number | null,
  backgroundJobId: string | null = null,
): Promise<ClaudeCliProcessSession | null> {
  if (knownPid !== null) {
    const known = await readLiveProcessSession(knownPid);
    if (known) {
      return known;
    }
  }

  const direct = await readLiveProcessSession(rootPid);
  if (direct) {
    return direct;
  }

  // Only live pids are listed (see listRegistryEntries), and every one of them
  // is a candidate, so no cap can hide the CLI. A poll reads only the entries
  // of the pty's own children, after one `ps` for all candidates; an attached
  // job's search reads live entries until it is found, and later polls read
  // its known pid directly.
  const candidates = (await listRegistryEntries({ limit: Infinity, pidNamedOnly: true }))
    .map((entry) => /^(\d+)\.json$/.exec(entry))
    .map((match) => (match ? Number(match[1]) : NaN))
    .filter((pid) => Number.isInteger(pid) && pid !== rootPid && pid !== knownPid);

  if (backgroundJobId) {
    for (const pid of candidates) {
      const record = await readLiveRecord(pid);
      if (record?.kind === 'bg' && record.jobId === backgroundJobId
        && typeof record.sessionId === 'string' && record.sessionId) {
        return { pid, providerSessionId: record.sessionId };
      }
    }
    return null;
  }

  const parents = await readParentPids(candidates);
  for (const pid of candidates) {
    if (parents.get(pid) !== rootPid) {
      continue;
    }
    const candidate = await readLiveProcessSession(pid);
    if (candidate) {
      return candidate;
    }
  }
  return null;
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
  // No registry directory at all is the normal case for an install that has
  // never run the CLI, and an unreadable one is not worth failing a poll for.
  const registryFiles = await listRegistryEntries();
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
 * Used by the websocket module's Shell gateway before it builds a launch
 * command. Reads are asynchronous so a slow config directory cannot stall the
 * server while a Shell tab opens.
 */
export async function findBackgroundClaudeJobId(providerSessionId: string): Promise<string | null> {
  if (!providerSessionId) {
    return null;
  }

  const entries = await listRegistryEntries();
  const jobIds = await Promise.all(entries.map(async (entry) => {
    let record: Record<string, unknown> | null;
    try {
      record = JSON.parse(await fsp.readFile(path.join(registryDirectory(), entry), 'utf8'));
    } catch {
      return null;
    }
    if (
      !record ||
      typeof record !== 'object' ||
      record.kind !== 'bg' ||
      record.sessionId !== providerSessionId ||
      typeof record.jobId !== 'string' ||
      !SAFE_JOB_ID.test(record.jobId)
    ) {
      return null;
    }
    const pid = typeof record.pid === 'number' ? record.pid : NaN;
    return Number.isInteger(pid) && pid > 0 && isRecordedProcessAlive(pid, record.procStart)
      ? record.jobId
      : null;
  }));

  return jobIds.find((jobId): jobId is string => jobId !== null) ?? null;
}

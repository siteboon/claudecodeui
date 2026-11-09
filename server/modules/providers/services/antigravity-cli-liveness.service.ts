import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { getLinuxFileLockIdentity, parseLinuxExclusiveFileLocks } from '@/shared/index.js';

type AntigravityCliSession = {
  providerSessionId: string;
  startedAt: number;
  canInterrupt: false;
};

type LivenessOptions = {
  procRoot?: string;
  getDataDirectory?: () => string;
};

type NativeSummary = {
  conversation_id: string;
  last_user_input_time: string;
};

const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Providers and its regression tests inspect AGY's native activity and live presence owner. */
export function createAntigravityCliLivenessService(options: LivenessOptions = {}) {
  const procRoot = options.procRoot ?? '/proc';
  const getDataDirectory = options.getDataDirectory
    ?? (() => path.join(os.homedir(), '.gemini', 'antigravity-cli'));

  async function listSessions(): Promise<AntigravityCliSession[]> {
    if (process.platform !== 'linux') return [];
    const directory = getDataDirectory();
    const databasePath = path.join(directory, 'conversation_summaries.db');
    let summaries: NativeSummary[];
    let locks: string;
    try {
      // A read-only connection neither creates a store for an uninstalled CLI
      // nor changes AGY's own journaling. Keep it open only for this snapshot.
      await fsp.access(databasePath);
      locks = await fsp.readFile(path.join(procRoot, 'locks'), 'utf8');
      const database = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 100 });
      try {
        summaries = database.prepare(`
          SELECT conversation_id, last_user_input_time
          FROM conversation_summaries
          WHERE killed = 0 AND (
            status IN ('CASCADE_RUN_STATUS_RUNNING', 'CASCADE_RUN_STATUS_BUSY', 'CASCADE_RUN_STATUS_CANCELING')
            OR not_fully_idle = 1
          )
        `).all() as NativeSummary[];
      } finally {
        database.close();
      }
    } catch (error) {
      // Missing/older AGY stores and a momentarily busy SQLite writer provide
      // no activity evidence. Other I/O failures remain visible to callers.
      if (['ENOENT', 'ENOTDIR', 'SQLITE_ERROR', 'SQLITE_BUSY', 'SQLITE_CANTOPEN']
        .includes((error as NodeJS.ErrnoException).code ?? '')) return [];
      throw error;
    }

    const holders = parseLinuxExclusiveFileLocks(locks);
    const sessions: AntigravityCliSession[] = [];
    for (const summary of summaries) {
      if (!CONVERSATION_ID.test(summary.conversation_id)) continue;
      try {
        const presence = await fsp.stat(path.join(directory, 'presence', `${summary.conversation_id}.lock`), { bigint: true });
        const pid = holders.get(getLinuxFileLockIdentity(presence.dev, presence.ino));
        if (!pid) continue;
        const processDirectory = path.join(procRoot, String(pid));
        const [owner, executable, processStat] = await Promise.all([
          fsp.stat(processDirectory),
          fsp.readlink(path.join(processDirectory, 'exe')),
          fsp.readFile(path.join(processDirectory, 'stat'), 'utf8'),
        ]);
        if (owner.uid !== process.getuid?.() || path.basename(executable) !== 'agy') continue;
        const state = processStat.slice(processStat.lastIndexOf(')') + 2).trim().split(/\s+/)[0];
        if (!state || state === 'Z' || state === 'X') continue;
        const startedAt = Date.parse(summary.last_user_input_time.replace(' ', 'T'));
        sessions.push({
          providerSessionId: summary.conversation_id,
          // A just-created summary can still contain Go's year-one zero time.
          startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : Number(presence.mtimeMs),
          // Interactive AGY processes can own multiple conversations. Reporting
          // activity must never turn Stop into a signal that kills the CLI.
          canInterrupt: false,
        });
      } catch (error) {
        if (['ENOENT', 'ESRCH', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) continue;
        throw error;
      }
    }
    return sessions;
  }

  return {
    listSessions,
    async getSession(providerSessionId: string): Promise<AntigravityCliSession | null> {
      if (!CONVERSATION_ID.test(providerSessionId)) return null;
      return (await listSessions()).find((session) => session.providerSessionId === providerSessionId) ?? null;
    },
  };
}

/** Sessions uses this reader to show and protect turns driven by an external Antigravity CLI. */
export const antigravityCliLivenessService = createAntigravityCliLivenessService();

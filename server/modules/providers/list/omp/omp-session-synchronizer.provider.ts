import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import {
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
};

const UNTITLED = 'Untitled omp Session';

/**
 * Session indexer for omp ACP transcripts.
 *
 * omp persists each session as `~/.omp/agent/sessions/<cwd-slug>/<ts>_<id>.jsonl`.
 * agent.db has NO sessions table, so the jsonl store is the source of truth
 * (Claude-style scan, not the Hermes SQLite one). The `type:'session'` header
 * carries `{id, cwd, timestamp}` and a `type:'title'` entry carries the display
 * title — neither is guaranteed to be line 1 (position varies by omp version),
 * so we scan until both are found.
 */
export class OmpSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'omp' as const;
  private readonly sessionsRoot = path.join(os.homedir(), '.omp', 'agent', 'sessions');

  async synchronize(since?: Date): Promise<number> {
    if (!fs.existsSync(this.sessionsRoot)) {
      return 0;
    }
    const files = await findFilesRecursivelyCreatedAfter(this.sessionsRoot, '.jsonl', since ?? null);

    let processed = 0;
    for (const filePath of files) {
      if (await this.synchronizeFile(filePath)) {
        processed += 1;
      }
    }
    return processed;
  }

  async synchronizeFile(filePath: string): Promise<string | null> {
    // Skip omp sub-agent sidecar files (e.g. `__advisor.jsonl`). They live inside
    // a session's dir and carry their OWN session header, so indexing them would
    // surface confusing internal sub-sessions (the main agent's output appears as
    // `user` messages, the sub-agent's as `assistant`). They are skipped here so a
    // session's sidecars never appear as sessions of their own.
    if (!filePath.endsWith('.jsonl') || path.basename(filePath).startsWith('__')) {
      return null;
    }

    const parsed = await this.parseSessionHeader(filePath);
    if (!parsed) {
      return null;
    }

    // Preserve a user-set custom name (mirrors kiro/codex synchronizers): the DB
    // upsert COALESCEs, so re-pass the existing name unless it's still the
    // placeholder, otherwise adopt the jsonl title.
    // App-created rows key session_id=app-id, provider_session_id=native-id, so
    // look up by provider id first (else the rename gets clobbered by the auto
    // title on every watcher tick) — matches codex/opencode/claude.
    const existing = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    let nameToPersist = parsed.sessionName;
    if (existing?.custom_name && existing.custom_name !== UNTITLED) {
      nameToPersist = existing.custom_name;
    }

    const timestamps = await readFileTimestamps(filePath);
    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      nameToPersist,
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath,
    );
  }

  /**
   * Scans the jsonl for the `session` header (id + cwd) and the `title` entry.
   * Short-circuits once both are found — they sit near the top in practice.
   */
  private async parseSessionHeader(filePath: string): Promise<ParsedSession | null> {
    // <ts>_<id>.jsonl → the id is the last '_'-delimited segment (the ISO ts
    // uses '-', so it never contains '_'). Used only as a fallback for id.
    const idFromName = path.basename(filePath, '.jsonl').split('_').pop() || '';

    let sessionId: string | undefined;
    let projectPath: string | undefined;
    let title: string | undefined;

    // Keep a handle on the stream: `rl.close()` does NOT destroy its input, so the
    // early `break` below would leak the fd until GC — once per watcher tick, per
    // session file.
    const stream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        let entry: Record<string, unknown> | null;
        try {
          entry = readObjectRecord(JSON.parse(trimmed));
        } catch {
          continue; // partial/malformed trailing line
        }
        if (!entry) {
          continue;
        }
        if (entry.type === 'session') {
          sessionId = readOptionalString(entry.id) ?? sessionId;
          projectPath = readOptionalString(entry.cwd) ?? projectPath;
          title = title ?? readOptionalString(entry.title); // some versions inline it
        } else if (entry.type === 'title' || entry.type === 'title_change') {
          title = readOptionalString(entry.title) ?? title;
        }
        if (sessionId && projectPath && title) {
          break;
        }
      }
    } finally {
      rl.close();
      stream.destroy();
    }

    const resolvedId = sessionId ?? (idFromName || undefined);
    if (!resolvedId || !projectPath) {
      return null; // without a cwd we can't attribute the session to a project
    }
    return {
      sessionId: resolvedId,
      projectPath,
      sessionName: normalizeSessionName(title, UNTITLED),
    };
  }
}

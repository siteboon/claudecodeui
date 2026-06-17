import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';

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

const UNTITLED = 'Untitled Kiro Session';

/**
 * Session indexer for Kiro CLI ACP transcripts.
 *
 * Kiro persists each ACP session as a pair under `~/.kiro/sessions/cli/`:
 *   <sessionId>.jsonl  — append-only event log (Prompt/AssistantMessage/ToolResults)
 *   <sessionId>.json   — sidecar with `{session_id, cwd, created_at, updated_at, title, ...}`
 *
 * The sidecar is the cheaper, more reliable source for project path and
 * display title; the JSONL is parsed by `KiroSessionsProvider.fetchHistory`.
 */
export class KiroSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'kiro' as const;
  private readonly sessionsRoot = path.join(os.homedir(), '.kiro', 'sessions', 'cli');

  /**
   * Scans `~/.kiro/sessions/cli/*.jsonl` and upserts discovered sessions.
   */
  async synchronize(since?: Date): Promise<number> {
    if (!fs.existsSync(this.sessionsRoot)) {
      return 0;
    }

    const files = await findFilesRecursivelyCreatedAfter(
      this.sessionsRoot,
      '.jsonl',
      since ?? null,
    );

    let processed = 0;
    for (const filePath of files) {
      const upserted = await this.synchronizeFile(filePath);
      if (upserted) {
        processed += 1;
      }
    }

    return processed;
  }

  /**
   * Parses one JSONL session file and upserts it via the sidecar `.json`.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }

    const parsed = await this.parseSessionFromSidecar(filePath);
    if (!parsed) {
      return null;
    }

    // Honor any user-set custom_name. `sessionsDb.createSession` upserts
    // with `COALESCE(excluded.custom_name, sessions.custom_name)`, so any
    // non-null name we pass replaces the stored one. The pattern (mirrors
    // codex-session-synchronizer.provider.ts:123-131): when the existing
    // session has a non-default name, re-pass that name so the COALESCE
    // is a no-op; only adopt the sidecar title when no name has been set
    // (or when the placeholder is still the default "Untitled" string).
    const existing = sessionsDb.getSessionById(parsed.sessionId);
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
   * Reads the sidecar `<sessionId>.json` to extract `cwd`, `session_id`, and
   * `title`. Falls back to deriving the session id from the filename when the
   * sidecar is missing or malformed.
   */
  private async parseSessionFromSidecar(jsonlPath: string): Promise<ParsedSession | null> {
    const sessionIdFromName = path.basename(jsonlPath, '.jsonl');
    const sidecarPath = jsonlPath.replace(/\.jsonl$/, '.json');

    let sidecar: Record<string, unknown> | null = null;
    try {
      const content = await readFile(sidecarPath, 'utf8');
      sidecar = readObjectRecord(JSON.parse(content));
    } catch {
      // Missing sidecar — without a cwd we can't index the session.
      return null;
    }

    const sessionId = readOptionalString(sidecar?.session_id) ?? sessionIdFromName;
    const projectPath = readOptionalString(sidecar?.cwd);
    if (!projectPath) {
      return null;
    }

    const title = readOptionalString(sidecar?.title);

    return {
      sessionId,
      projectPath,
      sessionName: normalizeSessionName(title, UNTITLED),
    };
  }
}

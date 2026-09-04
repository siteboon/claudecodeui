import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import { getCommandCodeHomePath } from '@/modules/providers/list/command-code/command-code-auth.provider.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import {
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
  readJsonRecord,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
};

const FALLBACK_TITLE = 'Untitled Command Code Session';

/**
 * True when a file under `~/.commandcode/projects/**` is a top-level session
 * transcript rather than a sidecar.
 *
 * Command Code writes `<id>.jsonl` transcripts plus sidecars that also end in
 * `.jsonl` (`<id>.checkpoints.jsonl`, `<id>.prompts.jsonl`) and `.json`
 * metadata (`<id>.meta.json`, `<id>.share.json`). Indexing a sidecar as a
 * standalone session would overwrite the parent row's `jsonl_path` — the exact
 * corruption the Claude synchronizer guards against for subagent transcripts.
 */
const isSessionTranscriptFile = (filePath: string): boolean => {
  const fileName = path.basename(filePath);
  if (!fileName.endsWith('.jsonl')) {
    return false;
  }
  return !fileName.endsWith('.checkpoints.jsonl')
    && !fileName.endsWith('.prompts.jsonl')
    && !fileName.endsWith('.share.jsonl');
};

/**
 * Session indexer for Command Code transcript artifacts.
 */
export class CommandCodeSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'command-code' as const;
  private readonly commandCodeHome = getCommandCodeHomePath();

  /**
   * Scans ~/.commandcode/projects and upserts discovered sessions into DB.
   */
  async synchronize(since?: Date): Promise<number> {
    const files = await findFilesRecursivelyCreatedAfter(
      path.join(this.commandCodeHome, 'projects'),
      '.jsonl',
      since ?? null,
    );

    let processed = 0;
    for (const filePath of files) {
      if (!isSessionTranscriptFile(filePath)) {
        continue;
      }

      const parsed = await this.processSessionFile(filePath);
      if (!parsed) {
        continue;
      }

      const timestamps = await readFileTimestamps(filePath);
      sessionsDb.createSession(
        parsed.sessionId,
        this.provider,
        parsed.projectPath,
        parsed.sessionName,
        timestamps.createdAt,
        timestamps.updatedAt,
        filePath,
      );
      processed += 1;
    }

    return processed;
  }

  /**
   * Parses and upserts one Command Code session JSONL file.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!isSessionTranscriptFile(filePath)) {
      return null;
    }

    const parsed = await this.processSessionFile(filePath);
    if (!parsed) {
      return null;
    }

    const timestamps = await readFileTimestamps(filePath);
    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      parsed.sessionName,
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath,
    );
  }

  /**
   * Extracts session metadata from one Command Code session JSONL file.
   */
  private async processSessionFile(filePath: string): Promise<ParsedSession | null> {
    // The header row is the only place the session id + cwd live.
    const parsed = await extractFirstValidJsonlData(filePath, (rawData) => {
      const data = readObjectRecord(rawData);
      if (!data || data.type !== 'session') {
        return null;
      }

      const sessionId = readOptionalString(data.id);
      const projectPath = readOptionalString(data.cwd);
      if (!sessionId || !projectPath) {
        return null;
      }

      return { sessionId, projectPath };
    });

    if (!parsed) {
      return null;
    }

    // A thread a session was edited/rewound off stays on disk on purpose; it
    // is nobody's conversation any more.
    if (sessionsDb.isProviderSessionSuperseded(parsed.sessionId, this.provider)) {
      return null;
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must first be bound to any pending app row (AD-13: the runtime owns
    // app-launched rows; the synchronizer defers to it).
    const pendingAppSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId)
      ?? sessionsDb.findLatestPendingAppSession(this.provider, parsed.projectPath);
    if (pendingAppSession && !pendingAppSession.provider_session_id) {
      sessionsDb.assignProviderSessionId(pendingAppSession.session_id, parsed.sessionId);
    }

    const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    const existingSessionName = existingSession?.custom_name;
    if (existingSessionName && existingSessionName !== FALLBACK_TITLE) {
      return {
        ...parsed,
        sessionName: normalizeSessionName(existingSessionName, FALLBACK_TITLE),
      };
    }

    const sessionName = await this.readSessionTitle(filePath);

    return {
      ...parsed,
      sessionName: normalizeSessionName(sessionName, FALLBACK_TITLE),
    };
  }

  /**
   * Reads a session's title from its `.meta.json` sidecar, falling back to the
   * first user prompt in the transcript.
   */
  private async readSessionTitle(filePath: string): Promise<string | undefined> {
    const metaPath = filePath.replace(/\.jsonl$/, '.meta.json');
    try {
      const metaContent = await readFile(metaPath, 'utf8');
      const meta = readJsonRecord(metaContent);
      const metaTitle = readOptionalString(meta?.title);
      if (metaTitle) {
        return metaTitle;
      }
    } catch {
      // No meta sidecar — fall through to the transcript's first user prompt.
    }

    return this.readFirstUserPrompt(filePath);
  }

  /**
   * Reads the first user prompt from a Command Code transcript to use as a
   * session title when no meta sidecar (or title) exists.
   */
  private async readFirstUserPrompt(filePath: string): Promise<string | undefined> {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/);

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        try {
          const entry = JSON.parse(trimmed) as { type?: unknown; message?: { role?: unknown; content?: unknown } };
          if (entry.type !== 'message') {
            continue;
          }
          const message = readObjectRecord(entry.message);
          if (message?.role !== 'user') {
            continue;
          }

          const content = typeof message.content === 'string'
            ? message.content
            : Array.isArray(message.content)
              ? message.content
                .map((part: unknown) => (typeof part === 'string' ? part : readObjectRecord(part)?.text ?? ''))
                .filter(Boolean)
                .join(' ')
              : '';
          const prompt = typeof content === 'string' ? content.trim() : '';
          if (prompt) {
            return prompt;
          }
        } catch {
          // Skip malformed lines.
        }
      }
    } catch {
      // Missing/unreadable transcripts produce no title.
    }

    return undefined;
  }
}

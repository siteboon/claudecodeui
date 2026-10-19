import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import {
  buildLookupMap,
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
};

/**
 * How far one transcript file has got, used to pick between two files that
 * carry the same session id.
 *
 * `lastTimestamp` is the newest record timestamp in the file (epoch ms) and
 * `size` its byte length, which breaks ties between files whose records stop
 * at the same instant. File mtime is deliberately not part of this: tooling
 * that copies a transcript between project directories normally preserves it
 * (`cp -p`, `shutil.copy2`), which leaves the copy indistinguishable from the
 * original by timestamp.
 */
type TranscriptProgress = {
  lastTimestamp: number;
  size: number;
};

/**
 * Session indexer for Claude transcript artifacts.
 */
export class ClaudeSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'claude' as const;
  private readonly claudeHome = path.join(os.homedir(), '.claude');

  /**
   * Returns true when a JSONL file is a subagent transcript or tool result
   * rather than a top-level session.
   *
   * Claude stores subagent transcripts under a `subagents/` directory and
   * tool results under a `tool-results/` directory, e.g.
   * `~/.claude/projects/<encoded-cwd>/<session-id>/subagents/agent-<id>.jsonl`.
   * Those files repeat the parent session's `sessionId`, so indexing them as
   * standalone sessions overwrites the parent row's `jsonl_path` and corrupts
   * the main session record. The recursive scan in `synchronize()` reaches
   * them, so both entry points must skip them.
   */
  private isSubagentTranscript(filePath: string): boolean {
    const pathParts = path.normalize(filePath).split(path.sep);
    return pathParts.includes('subagents') || pathParts.includes('tool-results');
  }

  /**
   * Reads how far one transcript file has got. Returns `'gone'` when the file
   * no longer exists, and null when it exists but could not be read this time
   * (EMFILE, EACCES, ...), which must not be mistaken for a move.
   *
   * The newest record timestamp wins over the last line's timestamp because a
   * transcript can end on bookkeeping rows that carry none (`atis-latch`,
   * `last-prompt`, `ai-title`), and a half-written trailing line is simply
   * skipped.
   */
  private async readTranscriptProgress(filePath: string): Promise<TranscriptProgress | 'gone' | null> {
    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === 'ENOENT' || code === 'ENOTDIR' ? 'gone' : null;
    }

    let lastTimestamp = 0;
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }

      const rawTimestamp = (parsed as Record<string, unknown>).timestamp;
      if (typeof rawTimestamp !== 'string') {
        continue;
      }

      const timestamp = Date.parse(rawTimestamp);
      if (!Number.isNaN(timestamp) && timestamp > lastTimestamp) {
        lastTimestamp = timestamp;
      }
    }

    return { lastTimestamp, size: Buffer.byteLength(content) };
  }

  /**
   * Returns the id of the session already pointed at a transcript that is
   * further along than `filePath`, or null when `filePath` is the file the
   * session should be read from.
   *
   * Claude derives a transcript's project directory from the session cwd, so
   * one session ends up with two `<session-id>.jsonl` files whenever its cwd
   * changes mid-session (entering a git worktree) or tooling copies the
   * transcript into another project directory to keep `--resume` working.
   * Nothing else compares them: the row simply kept whichever file was indexed
   * last, so Chat could render a copy that stops mid-turn — reading as a hung
   * session — while the conversation had finished in the other file.
   *
   * The session only follows a different file when that file is strictly
   * further along, or when the stored one no longer exists (a transcript that
   * genuinely moved must not pin the row to a deleted path). A file that could
   * not be read, on either side, never moves the row, and an exact tie keeps
   * the stored value so the row cannot flap between two indexers.
   */
  private async findSessionAheadOfTranscript(
    providerSessionId: string,
    filePath: string
  ): Promise<string | null> {
    const existing = sessionsDb.getSessionByProviderSessionId(providerSessionId)
      ?? sessionsDb.getSessionById(providerSessionId);
    const storedPath = existing?.jsonl_path;
    if (!existing || !storedPath || storedPath === filePath) {
      return null;
    }

    const [storedProgress, incomingProgress] = await Promise.all([
      this.readTranscriptProgress(storedPath),
      this.readTranscriptProgress(filePath),
    ]);

    if (incomingProgress === null || incomingProgress === 'gone') {
      return existing.session_id;
    }
    if (storedProgress === 'gone') {
      return null;
    }
    if (storedProgress === null) {
      return existing.session_id;
    }

    if (incomingProgress.lastTimestamp !== storedProgress.lastTimestamp) {
      return incomingProgress.lastTimestamp > storedProgress.lastTimestamp
        ? null
        : existing.session_id;
    }

    return incomingProgress.size > storedProgress.size ? null : existing.session_id;
  }

  /**
   * Scans ~/.claude/projects and upserts discovered sessions into DB.
   */
  async synchronize(since?: Date): Promise<number> {
    const nameMap = await buildLookupMap(path.join(this.claudeHome, 'history.jsonl'), 'sessionId', 'display');
    const files = await findFilesRecursivelyCreatedAfter(
      path.join(this.claudeHome, 'projects'),
      '.jsonl',
      since ?? null
    );

    let processed = 0;
    for (const filePath of files) {
      if (this.isSubagentTranscript(filePath)) {
        continue;
      }

      const parsed = await this.processSessionFile(filePath, nameMap);
      if (!parsed) {
        continue;
      }

      // A second copy of an already indexed transcript must not overwrite the
      // row — not its path, and not the timestamps or title read off it.
      if (await this.findSessionAheadOfTranscript(parsed.sessionId, filePath)) {
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
        filePath
      );
      processed += 1;
    }

    return processed;
  }

  /**
   * Parses and upserts one Claude session JSONL file.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }
    if (this.isSubagentTranscript(filePath)) {
      return null;
    }

    const nameMap = await buildLookupMap(path.join(this.claudeHome, 'history.jsonl'), 'sessionId', 'display');
    const parsed = await this.processSessionFile(filePath, nameMap);
    if (!parsed) {
      return null;
    }

    // The file still belongs to that session, so the caller may broadcast it,
    // but nothing in this copy may move the row back onto it.
    const sessionAhead = await this.findSessionAheadOfTranscript(parsed.sessionId, filePath);
    if (sessionAhead) {
      return sessionAhead;
    }

    const timestamps = await readFileTimestamps(filePath);
    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      parsed.sessionName,
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath
    );
  }

  /**
   * Extracts session metadata from one Claude JSONL session file.
   */
  private async processSessionFile(
    filePath: string,
    nameMap: Map<string, string>
  ): Promise<ParsedSession | null> {
    const parsed = await extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
      const projectPath = typeof data.cwd === 'string' ? data.cwd : undefined;

      if (!sessionId || !projectPath) {
        return null;
      }

      return {
        sessionId,
        projectPath,
      };
    });

    if (!parsed) {
      return null;
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    const existingSessionName = existingSession?.custom_name;
    if (existingSessionName && existingSessionName !== 'Untitled Claude Session') {
      return {
        ...parsed,
        sessionName: normalizeSessionName(existingSessionName, 'Untitled Claude Session'),
      };
    }

    let sessionName = await this.extractSessionTitle(filePath, parsed.sessionId);
    if (!sessionName) {
      sessionName = nameMap.get(parsed.sessionId);
    }

    return {
      ...parsed,
      sessionName: normalizeSessionName(sessionName, 'Untitled Claude Session'),
    };
  }

  /**
   * Returns the best available title for one session from its transcript.
   *
   * Scans forward keeping the last match of each event type, then prefers
   * `custom-title` (a manual `/rename`) over `ai-title` over `last-prompt`.
   * Claude writes `custom-title` immediately before `ai-title`, so a reverse
   * scan that returns its first hit would always lose the manual rename.
   *
   * Returns undefined on a missing or unreadable file so sync can continue.
   */
  private async extractSessionTitle(
    filePath: string,
    sessionId: string
  ): Promise<string | undefined> {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/);

      let foundCustomTitle: string | undefined;
      let foundAiTitle: string | undefined;
      let foundLastPrompt: string | undefined;

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]?.trim();
        if (!line) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        const data = parsed as Record<string, unknown>;
        const eventType = typeof data.type === 'string' ? data.type : undefined;
        const eventSessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;

        if (eventSessionId !== sessionId) {
          continue;
        }

        if (eventType === 'custom-title') {
          const title = typeof data.customTitle === 'string' ? data.customTitle : undefined;
          if (title?.trim()) {
            foundCustomTitle = title;
          }
        } else if (eventType === 'ai-title') {
          const title = typeof data.aiTitle === 'string' ? data.aiTitle : undefined;
          if (title?.trim()) {
            foundAiTitle = title;
          }
        } else if (eventType === 'last-prompt') {
          const prompt = typeof data.lastPrompt === 'string' ? data.lastPrompt : undefined;
          if (prompt?.trim()) {
            foundLastPrompt = prompt;
          }
        }
      }

      return foundCustomTitle || foundAiTitle || foundLastPrompt;
    } catch {
      // Ignore missing/unreadable files so sync can continue.
    }

    return undefined;
  }
}

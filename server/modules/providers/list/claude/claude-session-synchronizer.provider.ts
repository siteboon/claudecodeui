import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import {
  buildLookupMap,
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTail,
  readFileTimestamps,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

/**
 * How much of a transcript's tail to scan for a title marker.
 *
 * Markers are appended as the session runs, so the newest sits within the last
 * few hundred bytes: on a 6.1 MB transcript measured here the final marker began
 * 342 bytes from EOF. 64 KiB is ~190x that, and still covers files whose last
 * records are unusually large, while a miss only costs the full read that this
 * function already performed unconditionally.
 */
const SESSION_TITLE_TAIL_BYTES = 64 * 1024;

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
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

    let sessionName = nameMap.get(parsed.sessionId);
    if (!sessionName) {
      sessionName = await this.extractSessionAiTitleFromEnd(filePath, parsed.sessionId);
    }

    return {
      ...parsed,
      sessionName: normalizeSessionName(sessionName, 'Untitled Claude Session'),
    };
  }

  private async extractSessionAiTitleFromEnd(
    filePath: string,
    sessionId: string
  ): Promise<string | undefined> {
    // Title markers are appended as the session progresses, so the newest one
    // sits at the very end of the transcript. Scan a bounded tail first and only
    // fall back to the whole file if that window holds no marker at all.
    const tail = await readFileTail(filePath, SESSION_TITLE_TAIL_BYTES);
    if (tail) {
      const fromTail = this.findLastSessionTitle(tail.content, sessionId);
      if (fromTail !== undefined) {
        return fromTail;
      }

      if (!tail.truncated) {
        // The window already covered the whole file; a wider read cannot help.
        return undefined;
      }
    }

    try {
      const content = await readFile(filePath, 'utf8');
      return this.findLastSessionTitle(content, sessionId);
    } catch {
      // Ignore missing/unreadable files so sync can continue.
      return undefined;
    }
  }

  /**
   * Returns the last title marker for `sessionId` in a run of JSONL text, or
   * `undefined` if it holds none.
   */
  private findLastSessionTitle(content: string, sessionId: string): string | undefined {
    const lines = content.split(/\r?\n/);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
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
      const aiTitle = typeof data.aiTitle === 'string' ? data.aiTitle : undefined;
      const lastPrompt = typeof data.lastPrompt === 'string' ? data.lastPrompt : undefined;
      const claudeRenamedTitle = typeof data.customTitle === 'string' ? data.customTitle : undefined;

      if (
        (eventType === 'ai-title' && eventSessionId === sessionId && aiTitle?.trim()) ||
        (eventType === 'last-prompt' && eventSessionId === sessionId && lastPrompt?.trim()) ||
        (eventType === "custom-title" && eventSessionId === sessionId && claudeRenamedTitle?.trim())
      ) {
        return aiTitle || lastPrompt || claudeRenamedTitle;
      }
    }

    return undefined;
  }
}

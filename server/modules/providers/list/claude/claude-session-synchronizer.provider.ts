import os from 'node:os';
import path from 'node:path';
import { open, readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import {
  buildLookupMap,
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

// The tail is read in growing windows until a message turns up. A transcript
// whose last message is further back than the cap keeps its stored time.
const LAST_MESSAGE_FIRST_WINDOW_BYTES = 64 * 1024;
const LAST_MESSAGE_MAX_WINDOW_BYTES = 8 * 1024 * 1024;

/**
 * Reads `length` bytes from `position`, repeating short reads. Stops early if
 * the file got shorter, and decodes only the bytes actually read.
 */
async function readRange(
  handle: Awaited<ReturnType<typeof open>>,
  position: number,
  length: number
): Promise<string> {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) {
      break;
    }
    filled += bytesRead;
  }
  return buffer.toString('utf8', 0, filled);
}

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

      const timestamps = await this.readSessionTimestamps(filePath, parsed.sessionId);
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

    const timestamps = await this.readSessionTimestamps(filePath, parsed.sessionId);
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
   * Created/updated times for one transcript, where "updated" is the time of
   * its last message rather than the file's modification time.
   *
   * Claude Code also appends rows that are not conversation (cost and tool
   * usage state, titles, mode changes), including when a session is merely
   * opened or closed. Using the file time moved untouched sessions to the top
   * of the list, showed hours- or days-off "last activity", and un-archived
   * archived sessions (an update newer than the stored time un-archives).
   *
   * A transcript that has messages, but none within the scan cap, keeps the
   * time already stored for it: falling back to the file time there would
   * bring back exactly those problems. Only a session seen for the first time
   * gets the file time in that case.
   */
  private async readSessionTimestamps(
    filePath: string,
    providerSessionId: string
  ): Promise<{ createdAt?: string; updatedAt?: string }> {
    const timestamps = await readFileTimestamps(filePath);
    const lastMessage = await this.readLastMessageTime(filePath);
    if (lastMessage.timestamp) {
      return { ...timestamps, updatedAt: lastMessage.timestamp };
    }
    if (lastMessage.capped) {
      const stored = sessionsDb.getSessionByProviderSessionId(providerSessionId)?.updated_at;
      if (stored) {
        return { ...timestamps, updatedAt: stored };
      }
    }
    return timestamps;
  }

  /**
   * Timestamp of the last user or assistant message in a transcript, reading
   * from the end. Sidechain (subagent) and meta rows do not count.
   *
   * `timestamp` is undefined when there is no message or the file cannot be
   * read; `capped` is true when the scan stopped at the size cap before
   * reaching the start of the file, so an older message may still exist.
   */
  private async readLastMessageTime(filePath: string): Promise<{ timestamp?: string; capped: boolean }> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(filePath, 'r');
      const { size } = await handle.stat();
      let windowSize = Math.min(LAST_MESSAGE_FIRST_WINDOW_BYTES, size);
      for (;;) {
        const start = size - windowSize;
        // One byte more than the window, so a row that starts exactly at the
        // window is known to be complete (the byte before it is a newline).
        const readStart = Math.max(0, start - 1);
        const text = await readRange(handle, readStart, size - readStart);
        const lines = text.split('\n');
        if (readStart > 0) {
          lines.shift(); // the part before the first newline: a partial row, or empty
        }
        for (let index = lines.length - 1; index >= 0; index -= 1) {
          const line = lines[index]?.trim();
          if (!line) {
            continue;
          }
          let row: Record<string, unknown>;
          try {
            row = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue; // a row still being written
          }
          if (
            (row.type === 'user' || row.type === 'assistant') &&
            !row.isSidechain &&
            !row.isMeta &&
            typeof row.timestamp === 'string' &&
            !Number.isNaN(Date.parse(row.timestamp))
          ) {
            return { timestamp: row.timestamp, capped: false };
          }
        }
        if (windowSize >= size) {
          return { capped: false };
        }
        if (windowSize >= LAST_MESSAGE_MAX_WINDOW_BYTES) {
          return { capped: true };
        }
        windowSize = Math.min(windowSize * 4, size, LAST_MESSAGE_MAX_WINDOW_BYTES);
      }
    } catch {
      return { capped: false };
    } finally {
      await handle?.close();
    }
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

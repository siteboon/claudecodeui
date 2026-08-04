import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import {
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  getQoderProjectsDir,
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
 * Session indexer for Qoder transcript artifacts.
 *
 * Qoder persists conversations as Claude-compatible JSONL under
 * `~/.qoder/projects/<encoded-cwd>/<sessionId>.jsonl`, where the directory
 * name encodes the working directory with every `/` replaced by `-`
 * (e.g. `/home/admin` → `-home-admin`). Every line carries a top-level
 * `sessionId`; `workspace-directories` rows carry the real project path.
 */
export class QoderSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'qoder' as const;

  /**
   * Scans ~/.qoder/projects and upserts discovered sessions into DB.
   */
  async synchronize(since?: Date): Promise<number> {
    const projectsDir = getQoderProjectsDir();
    const files = await findFilesRecursivelyCreatedAfter(
      projectsDir,
      '.jsonl',
      since ?? null
    );

    let processed = 0;
    for (const filePath of files) {
      const parsed = await this.processSessionFile(filePath);
      if (!parsed) {
        continue;
      }

      const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
        ?? sessionsDb.getSessionById(parsed.sessionId);
      if (existingSession) {
        // If session name is untitled and we now have a name, update it
        if (existingSession.custom_name === 'Untitled Qoder Session' && parsed.sessionName && parsed.sessionName !== 'Untitled Qoder Session') {
          sessionsDb.updateSessionCustomName(existingSession.session_id, parsed.sessionName);
        }
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
   * Parses and upserts one Qoder session JSONL file.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
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
      filePath
    );
  }

  /**
   * Extracts session metadata from one Qoder JSONL session file.
   */
  private async processSessionFile(filePath: string): Promise<ParsedSession | null> {
    const parsed = await extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;
      // Every Qoder JSONL row carries the provider-native session id.
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined;
      // Sidechain (sub-agent) conversations are tagged on their rows; they
      // must not surface in the sidebar.
      const isSubagent = data.isSidechain === true
        || typeof data.parentUuid === 'string';
      if (!sessionId || isSubagent) {
        return null;
      }

      const projectPath = this.extractProjectPath(data);
      if (!projectPath) {
        return null;
      }

      return { sessionId, projectPath };
    });

    if (!parsed) {
      return null;
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    const existingSessionName = existingSession?.custom_name;
    if (existingSessionName && existingSessionName !== 'Untitled Qoder Session') {
      return {
        ...parsed,
        sessionName: normalizeSessionName(existingSessionName, 'Untitled Qoder Session'),
      };
    }

    let sessionName = await this.extractLatestTitleFromEnd(filePath);
    if (!sessionName) {
      sessionName = await this.extractFirstUserMessageFromStart(filePath);
    }
    if (!sessionName) {
      sessionName = await this.extractLastAssistantMessageFromEnd(filePath);
    }

    return {
      ...parsed,
      sessionName: normalizeSessionName(sessionName, 'Untitled Qoder Session'),
    };
  }

  /**
   * Pulls the real working directory out of a Qoder JSONL row:
   * - `workspace-directories` rows carry the canonical `directories` array.
   * - `user` rows carry the `cwd` the CLI was launched from.
   */
  private extractProjectPath(data: Record<string, unknown>): string | undefined {
    if (data.type === 'workspace-directories' && Array.isArray(data.directories)) {
      for (const dir of data.directories) {
        if (typeof dir === 'string' && dir.trim()) {
          return dir;
        }
      }
    }

    if (data.type === 'user' && typeof data.cwd === 'string' && data.cwd.trim()) {
      return data.cwd;
    }

    return undefined;
  }

  /**
   * Returns the most recent `ai-title` row's title. Qoder writes an
   * `ai-title` row each time it renames the conversation, so the last one in
   * the file is the freshest.
   */
  private async extractLatestTitleFromEnd(filePath: string): Promise<string | undefined> {
    try {
      const content = await readFile(filePath, 'utf8');
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
        if (data.type === 'ai-title' && typeof data.aiTitle === 'string' && data.aiTitle.trim()) {
          return data.aiTitle;
        }
      }
    } catch {
      // Ignore missing/unreadable files so sync can continue.
    }

    return undefined;
  }

  /**
   * Returns the first user-typed text in the transcript, used to title
   * app-created sessions from the prompt the user sent from cloudcli.
   */
  private async extractFirstUserMessageFromStart(filePath: string): Promise<string | undefined> {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/);

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        const text = this.extractUserText(parsed);
        if (text) {
          return text;
        }
      }
    } catch {
      // Ignore missing/unreadable files so sync can continue.
    }

    return undefined;
  }

  private async extractLastAssistantMessageFromEnd(filePath: string): Promise<string | undefined> {
    try {
      const content = await readFile(filePath, 'utf8');
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

        const text = this.extractAssistantText(parsed);
        if (text) {
          return text;
        }
      }
    } catch {
      // Ignore missing/unreadable files so sync can continue.
    }

    return undefined;
  }

  /**
   * Extracts the plain text payload of a `user` row (string content or an
   * array of `text` parts; `tool_result` blocks are skipped).
   */
  private extractUserText(parsed: unknown): string | undefined {
    const data = parsed as Record<string, unknown>;
    if (data.type !== 'user') {
      return undefined;
    }
    const message = data.message as Record<string, unknown> | undefined;
    if (message?.role !== 'user') {
      return undefined;
    }

    if (typeof message.content === 'string' && message.content.trim()) {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        const block = part as Record<string, unknown> | undefined;
        if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          return block.text;
        }
      }
    }

    return undefined;
  }

  /**
   * Extracts the first plain `text` part of an `assistant` row.
   */
  private extractAssistantText(parsed: unknown): string | undefined {
    const data = parsed as Record<string, unknown>;
    if (data.type !== 'assistant') {
      return undefined;
    }
    const message = data.message as Record<string, unknown> | undefined;
    if (message?.role !== 'assistant') {
      return undefined;
    }

    if (typeof message.content === 'string' && message.content.trim()) {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        const block = part as Record<string, unknown> | undefined;
        if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          return block.text;
        }
      }
    }

    return undefined;
  }
}

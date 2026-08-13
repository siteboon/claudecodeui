import { sessionsDb } from '@/modules/database/index.js';
import {
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  getQoderProjectsDir,
  normalizeSessionName,
  readFileTimestamps,
  readJsonlEntries,
  readObjectRecord,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';

/** Placeholder title for transcripts that carry no usable name yet. */
const UNTITLED_SESSION_NAME = 'Untitled Qoder Session';

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

      // createSession upserts and writes `parsed.sessionName` over the existing
      // custom_name, and processSessionFile already preserves a user-assigned
      // name, so no separate rename step is needed here.
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
      const data = readObjectRecord(rawData);
      if (!data) {
        return null;
      }

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
    if (existingSessionName && existingSessionName !== UNTITLED_SESSION_NAME) {
      return {
        ...parsed,
        sessionName: normalizeSessionName(existingSessionName, UNTITLED_SESSION_NAME),
      };
    }

    // Freshest AI-assigned title first, then the prompt the user typed, then
    // whatever the assistant last said.
    const candidates = await this.collectSessionTitleCandidates(filePath);
    const sessionName = candidates.aiTitle
      ?? candidates.firstUserText
      ?? candidates.lastAssistantText;

    return {
      ...parsed,
      sessionName: normalizeSessionName(sessionName, UNTITLED_SESSION_NAME),
    };
  }

  /**
   * Pulls the real working directory out of a Qoder JSONL row:
   * - `workspace-directories` rows carry the canonical `directories` array.
   * - `user` rows carry the `cwd` the CLI was launched from.
   */
  private extractProjectPath(data: AnyRecord): string | undefined {
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
   * Collects every title candidate in one streamed pass.
   *
   * Reading the transcript once matters on the watcher's hot path: this was
   * previously three separate whole-file reads per session.
   */
  private async collectSessionTitleCandidates(filePath: string): Promise<{
    aiTitle?: string;
    firstUserText?: string;
    lastAssistantText?: string;
  }> {
    let aiTitle: string | undefined;
    let firstUserText: string | undefined;
    let lastAssistantText: string | undefined;

    for await (const data of readJsonlEntries(filePath)) {
      // Qoder writes an `ai-title` row each time it renames the conversation, so
      // the last one in the file is the freshest.
      if (data.type === 'ai-title' && typeof data.aiTitle === 'string' && data.aiTitle.trim()) {
        aiTitle = data.aiTitle;
        continue;
      }

      if (!firstUserText) {
        firstUserText = this.extractUserText(data);
        if (firstUserText) {
          continue;
        }
      }

      lastAssistantText = this.extractAssistantText(data) ?? lastAssistantText;
    }

    return { aiTitle, firstUserText, lastAssistantText };
  }

  /**
   * Extracts the plain text payload of a `user` row.
   */
  private extractUserText(data: AnyRecord): string | undefined {
    if (data.type !== 'user') {
      return undefined;
    }

    const message = readObjectRecord(data.message);
    return message?.role === 'user' ? this.extractMessageText(message) : undefined;
  }

  /**
   * Extracts the plain text payload of an `assistant` row.
   */
  private extractAssistantText(data: AnyRecord): string | undefined {
    if (data.type !== 'assistant') {
      return undefined;
    }

    const message = readObjectRecord(data.message);
    return message?.role === 'assistant' ? this.extractMessageText(message) : undefined;
  }

  /**
   * Reads a Claude-style `message.content`, which is either a plain string or an
   * array of typed parts. Only `text` parts carry titleable content, so
   * `tool_result` and `thinking` blocks are skipped.
   */
  private extractMessageText(message: AnyRecord): string | undefined {
    if (typeof message.content === 'string' && message.content.trim()) {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        const block = readObjectRecord(part);
        if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          return block.text;
        }
      }
    }

    return undefined;
  }
}

import path from 'node:path';
import fsp, { readFile } from 'node:fs/promises';

import { scanStateDb } from '@/shared/database/repositories/scan-state.db.js';
import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import type { LLMProvider } from '@/shared/types/app.js';
import { AppError } from '@/shared/utils/app-error.js';
import { sessionIndexers } from '@/modules/llm/session-indexers/index.js';
import { llmMessagesUnifier, type UnifiedChatMessage } from '@/modules/llm/services/messages-unifier.service.js';

type SyncResult = {
  processedByProvider: Record<LLMProvider, number>;
  failures: string[];
};

type SessionHistoryPayload = {
  sessionId: string;
  provider: string;
  workspacePath: string;
  filePath: string;
  fileType: 'jsonl' | 'json';
  entries: unknown[];
  messages: UnifiedChatMessage[];
};

const SESSION_ID_PATTERN = /^[a-zA-Z0-9._-]{1,120}$/;

/**
 * Restricts session IDs before they are used in DB/filesystem operations.
 */
function sanitizeSessionId(sessionId: string): string {
  const value = String(sessionId).trim();
  if (!SESSION_ID_PATTERN.test(value)) {
    throw new AppError('Invalid session ID format.', {
      code: 'INVALID_SESSION_ID',
      statusCode: 400,
    });
  }
  return value;
}

/**
 * Removes one file if it exists.
 */
async function removeFileIfExists(filePath: string): Promise<boolean> {
  try {
    await fsp.unlink(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Parses newline-delimited JSON files and preserves malformed lines as raw entries.
 */
const parseJsonl = (content: string): unknown[] => {
  const entries: unknown[] = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      entries.push({ raw: trimmed, parseError: true });
    }
  }

  return entries;
};

/**
 * Parses JSON files and normalizes object payloads into a single-element array.
 */
const parseJson = (content: string): unknown[] => {
  try {
    const parsed = JSON.parse(content) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [{ raw: content, parseError: true }];
  }
};

/**
 * Orchestrates provider-specific session indexers and DB-path based cleanup.
 */
export const llmSessionsService = {
  /**
   * Lists indexed sessions from the shared DB, optionally scoped to one provider.
   */
  listIndexedSessions(provider?: string) {
    const allSessions = sessionsDb.getAllSessions();
    if (!provider) {
      return allSessions;
    }

    return allSessions.filter((session) => session.provider === provider);
  },

  /**
   * Runs all provider indexers and updates `scan_state.last_scanned_at`.
   */
  async synchronizeSessions(): Promise<SyncResult> {
    const lastScanAt = scanStateDb.getLastScannedAt();
    const processedByProvider: Record<LLMProvider, number> = {
      claude: 0,
      codex: 0,
      cursor: 0,
      gemini: 0,
    };
    const failures: string[] = [];

    const results = await Promise.allSettled(
      sessionIndexers.map(async (indexer) => ({
        provider: indexer.provider,
        processed: await indexer.synchronize(lastScanAt),
      })),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        processedByProvider[result.value.provider] = result.value.processed;
        continue;
      }

      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failures.push(reason);
    }

    scanStateDb.updateLastScannedAt();

    return {
      processedByProvider,
      failures,
    };
  },

  /**
   * Indexes one provider artifact file without running a full provider rescan.
   */
  async synchronizeProviderFile(
    provider: LLMProvider,
    filePath: string,
  ): Promise<{ provider: LLMProvider; indexed: boolean }> {
    const indexer = sessionIndexers.find((entry) => entry.provider === provider);
    if (!indexer) {
      throw new AppError(`No session indexer registered for provider "${provider}".`, {
        code: 'SESSION_INDEXER_NOT_FOUND',
        statusCode: 500,
      });
    }

    if (!indexer.synchronizeFile) {
      return { provider, indexed: false };
    }

    const indexed = await indexer.synchronizeFile(filePath);
    return { provider, indexed };
  },

  updateSessionCustomName(sessionId: string, sessionCustomName: string): void {
    const sessionMetadata = sessionsDb.getSessionById(sessionId);
    if (!sessionMetadata) {
      throw new AppError('Session not found.', {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionsDb.updateSessionCustomName(sessionId, sessionCustomName);
  },

  /**
   * Deletes a session artifact using only DB `jsonl_path`, then removes the DB row.
   */
  async deleteSessionArtifacts(rawSessionId: string): Promise<{
    sessionId: string;
    deletedFromDisk: boolean;
    deletedFromDatabase: boolean;
  }> {
    const sessionId = sanitizeSessionId(rawSessionId);
    const existingSession = sessionsDb.getSessionById(sessionId);
    const jsonlPath = existingSession?.jsonl_path ?? null;
    const deletedFromDisk = jsonlPath ? await removeFileIfExists(jsonlPath) : false;

    if (existingSession) {
      sessionsDb.deleteSession(sessionId);
    }

    return {
      sessionId,
      deletedFromDisk,
      deletedFromDatabase: Boolean(existingSession),
    };
  },

  /**
   * Reads session history directly from `sessions.jsonl_path` without legacy fetchers.
   */
  async getSessionHistory(sessionId: string): Promise<SessionHistoryPayload> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (!session.jsonl_path) {
      throw new AppError(`Session "${sessionId}" does not have a history file path.`, {
        code: 'SESSION_HISTORY_NOT_AVAILABLE',
        statusCode: 404,
      });
    }

    const filePath = session.jsonl_path;
    const fileContent = await readFile(filePath, 'utf8');
    const extension = path.extname(filePath).toLowerCase();
    const isGeminiJson = session.provider === 'gemini' || extension === '.json';
    const entries = isGeminiJson ? parseJson(fileContent) : parseJsonl(fileContent);

    return {
      sessionId: session.session_id,
      provider: session.provider,
      workspacePath: session.workspace_path,
      filePath,
      fileType: isGeminiJson ? 'json' : 'jsonl',
      entries,
      messages: llmMessagesUnifier.normalizeHistoryEntries(
        session.provider,
        session.session_id,
        entries,
      ),
    };
  },
};

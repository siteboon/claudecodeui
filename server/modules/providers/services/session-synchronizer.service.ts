import path from 'node:path';
import fsp, { readFile } from 'node:fs/promises';

import { scanStateDb, sessionsDb, projectsDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import type { LLMProvider, NormalizedMessage } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type SessionSynchronizeResult = {
  processedByProvider: Record<LLMProvider, number>;
  failures: string[];
};

type SessionHistoryPayload = {
  sessionId: string;
  provider: string;
  projectPath: string | null;
  filePath: string;
  fileType: 'jsonl' | 'json';
  entries: unknown[];
  messages: NormalizedMessage[];
};

const SESSION_ID_PATTERN = /^[a-zA-Z0-9._-]{1,120}$/;

/**
 * Restricts session ids before they are used in DB and filesystem operations.
 */
function sanitizeSessionId(sessionId: string): string {
  const value = String(sessionId).trim();
  if (!SESSION_ID_PATTERN.test(value)) {
    throw new AppError('Invalid session id format.', {
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
 * Parses newline-delimited JSON and preserves malformed lines as raw entries.
 */
function parseJsonl(content: string): unknown[] {
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
}

/**
 * Parses JSON and normalizes object payloads into a single-element array.
 */
function parseJson(content: string): unknown[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [{ raw: content, parseError: true }];
  }
}

/**
 * Orchestrates provider-specific session indexers and indexed-session lifecycle operations.
 */
export const sessionSynchronizerService = {
  /**
   * Lists indexed sessions from DB, optionally scoped to one provider.
   */
  listIndexedSessions(provider?: string) {
    const allSessions = sessionsDb.getAllSessions();
    if (!provider) {
      return allSessions;
    }

    return allSessions.filter((session) => session.provider === provider);
  },

  /**
   * Reads one indexed session row and enriches it with the associated project id.
   */
  getIndexedSession(sessionId: string) {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const project = session.project_path ? projectsDb.getProjectPath(session.project_path) : null;
    return {
      ...session,
      project_id: project?.project_id ?? null,
    };
  },

  /**
   * Runs all provider synchronizers and updates scan_state.last_scanned_at.
   */
  async synchronizeSessions(): Promise<SessionSynchronizeResult> {
    const lastScanAt = scanStateDb.getLastScannedAt();
    const processedByProvider: Record<LLMProvider, number> = {
      claude: 0,
      codex: 0,
      cursor: 0,
      gemini: 0,
    };
    const failures: string[] = [];

    const results = await Promise.allSettled(
      providerRegistry.listProviders().map(async (provider) => ({
        provider: provider.id,
        processed: await provider.sessionSynchronizer.synchronize(lastScanAt ?? undefined),
      }))
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
    filePath: string
  ): Promise<{ provider: LLMProvider; indexed: boolean }> {
    const resolvedProvider = providerRegistry.resolveProvider(provider);
    const indexed = await resolvedProvider.sessionSynchronizer.synchronizeFile(filePath);
    return { provider, indexed };
  },

  /**
   * Updates one indexed session custom name after validating existence.
   */
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
   * Deletes a session artifact path from disk (if present) and deletes DB metadata.
   */
  async deleteSessionArtifacts(rawSessionId: string): Promise<{
    sessionId: string;
    deletedFromDisk: boolean;
    deletedFromDatabase: boolean;
  }> {
    const sessionId = sanitizeSessionId(rawSessionId);
    const existingSession = sessionsDb.getSessionById(sessionId);
    const sessionFilePath = existingSession?.jsonl_path ?? null;
    const deletedFromDisk = sessionFilePath ? await removeFileIfExists(sessionFilePath) : false;

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
   * Reads indexed session history directly from session json path and normalizes entries.
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

    const messages: NormalizedMessage[] = [];
    for (const entry of entries) {
      messages.push(...sessionsService.normalizeMessage(session.provider, entry, session.session_id));
    }

    return {
      sessionId: session.session_id,
      provider: session.provider,
      projectPath: session.project_path,
      filePath,
      fileType: isGeminiJson ? 'json' : 'jsonl',
      entries,
      messages,
    };
  },
};

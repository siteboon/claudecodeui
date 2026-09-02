import { randomUUID } from 'node:crypto';
import fsSync from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { getAntigravityDataRoot, getAntigravitySummariesDbPath } from '@/modules/providers/list/antigravity/index.js';
import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  NormalizedMessage,
} from '@/shared/types.js';
import {
  AppError,
  getOpenCodeDatabasePath,
  getZCodeDatabasePath,
  normalizeProjectPath,
  parseAntigravityWorkspacePath,
  sanitizeLeafDirectoryName,
} from '@/shared/utils.js';

type CreateAppSessionResult = {
  sessionId: string;
  provider: LLMProvider;
  projectPath: string;
  sessionName: string;
};

type ArchivedSessionListItem = {
  sessionId: string;
  provider: LLMProvider;
  projectId: string | null;
  projectPath: string | null;
  projectDisplayName: string;
  sessionTitle: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isProjectArchived: boolean;
};

type RecentSessionListItem = Pick<
  ArchivedSessionListItem,
  'sessionId' | 'provider' | 'projectId' | 'projectDisplayName' | 'sessionTitle' | 'lastActivity'
>;

type RecentSessionsPage = {
  conversations: RecentSessionListItem[];
  total: number;
  hasMore: boolean;
};

type SessionDetails = {
  /** Canonical app-facing session id (may differ from the looked-up id when a provider-native id was given). */
  sessionId: string;
  provider: LLMProvider;
  summary: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isArchived: boolean;
  project: {
    projectId: string;
    path: string;
    fullPath: string;
    displayName: string;
    isStarred: boolean;
    isArchived: boolean;
  } | null;
};

const MAX_CLOUDCLI_SESSION_NAME_WORDS = 4;

function buildCloudCliSessionName(initialMessage: string): string {
  const words = initialMessage.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, MAX_CLOUDCLI_SESSION_NAME_WORDS).join(' ') || 'Untitled Session';
}

/**
 * Removes one file or directory recursively if it exists.
 */
async function removePathIfExists(targetPath: string): Promise<boolean> {
  try {
    await fsp.rm(targetPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return false;
    }
    return false;
  }
}

/**
 * Removes provider-native files and storage records when a session is hard-deleted.
 */
async function cleanupProviderNativeSession(session: {
  session_id: string;
  provider: string;
  provider_session_id: string | null;
  jsonl_path: string | null;
  project_path: string | null;
}): Promise<boolean> {
  let removed = false;

  // 1. JSONL file removal (Claude, Cursor, Codex, etc.)
  if (session.jsonl_path) {
    const fileRemoved = await removePathIfExists(session.jsonl_path);
    if (fileRemoved) {
      removed = true;
    }

    // Also check for subagent directory in same parent folder.
    // Ensure nativeId is a safe single leaf directory to prevent deleting parent folders.
    const nativeId = session.provider_session_id || session.session_id;
    if (nativeId) {
      try {
        const safeLeaf = sanitizeLeafDirectoryName(nativeId, 'native session id');
        const subagentsDir = path.join(path.dirname(session.jsonl_path), safeLeaf);
        await removePathIfExists(subagentsDir);
      } catch {
        // Skip subagents folder deletion if nativeId is not a valid leaf directory name
      }
    }
  }

  const nativeSessionId = session.provider_session_id || session.session_id;

  // 2. Antigravity cleanup
  if (session.provider === 'antigravity') {
    const summariesDbPath = getAntigravitySummariesDbPath();
    if (fsSync.existsSync(summariesDbPath)) {
      let db: Database.Database | null = null;
      try {
        db = new Database(summariesDbPath);
        const res = db.prepare('DELETE FROM conversation_summaries WHERE conversation_id = ?').run(nativeSessionId);
        if (res.changes > 0) {
          removed = true;
        }
      } catch (err) {
        console.warn('[SessionsService] Failed to delete Antigravity summary row:', err);
      } finally {
        if (db) {
          db.close();
        }
      }
    }

    if (nativeSessionId) {
      try {
        const safeId = sanitizeLeafDirectoryName(nativeSessionId, 'antigravity session id');
        const dataRoot = getAntigravityDataRoot();
        const brainDir = path.join(dataRoot, 'brain', safeId);
        if (await removePathIfExists(brainDir)) {
          removed = true;
        }

        const conversationsDir = path.join(dataRoot, 'conversations', safeId);
        if (await removePathIfExists(conversationsDir)) {
          removed = true;
        }
      } catch {
        // Skip if safeId is invalid
      }
    }
  }

  // 3. OpenCode cleanup
  if (session.provider === 'opencode') {
    const openCodeDbPath = getOpenCodeDatabasePath();
    if (fsSync.existsSync(openCodeDbPath)) {
      let db: Database.Database | null = null;
      try {
        db = new Database(openCodeDbPath);
        const res = db.prepare('DELETE FROM session WHERE id = ?').run(nativeSessionId);
        if (res.changes > 0) {
          removed = true;
        }
      } catch (err) {
        console.warn('[SessionsService] Failed to delete OpenCode session row:', err);
      } finally {
        if (db) {
          db.close();
        }
      }
    }
  }

  // 4. ZCode cleanup
  if (session.provider === 'zcode') {
    const zcodeDbPath = getZCodeDatabasePath();
    if (fsSync.existsSync(zcodeDbPath)) {
      let db: Database.Database | null = null;
      try {
        db = new Database(zcodeDbPath);
        const res = db.prepare('DELETE FROM session WHERE id = ?').run(nativeSessionId);
        if (res.changes > 0) {
          removed = true;
        }
      } catch (err) {
        console.warn('[SessionsService] Failed to delete ZCode session row:', err);
      } finally {
        if (db) {
          db.close();
        }
      }
    }
  }

  return removed;
}

/**
 * Cleans up provider-native storage (transcripts, brain directories, summary DB rows)
 * for an entire project path when a project is permanently deleted.
 */
async function cleanupProviderProjectStorage(projectPath: string): Promise<void> {
  const normalizedPath = normalizeProjectPath(projectPath);
  // Defensive guard: never delete root, empty, or whitespace-only paths
  if (!normalizedPath || normalizedPath === path.parse(normalizedPath).root) {
    return;
  }

  // 1. Antigravity workspace cleanup
  const summariesDbPath = getAntigravitySummariesDbPath();
  const matchingConversationIds: string[] = [];
  if (fsSync.existsSync(summariesDbPath)) {
    let db: Database.Database | null = null;
    try {
      db = new Database(summariesDbPath);
      const rows = db.prepare('SELECT conversation_id, workspace_uris FROM conversation_summaries').all() as Array<{
        conversation_id: string;
        workspace_uris: string | null;
      }>;

      for (const row of rows) {
        if (!row.workspace_uris) {
          continue;
        }
        const ws = parseAntigravityWorkspacePath(row.workspace_uris);
        if (ws && normalizeProjectPath(ws) === normalizedPath) {
          matchingConversationIds.push(row.conversation_id);
          db.prepare('DELETE FROM conversation_summaries WHERE conversation_id = ?').run(row.conversation_id);
        }
      }
    } catch (err) {
      console.warn('[SessionsService] Failed to clean up Antigravity workspace summaries:', err);
    } finally {
      if (db) {
        db.close();
      }
    }
  }

  // Clean up Antigravity brain and conversation folders after closing the database
  const dataRoot = getAntigravityDataRoot();
  for (const convId of matchingConversationIds) {
    try {
      const safeId = sanitizeLeafDirectoryName(convId, 'conversation id');
      await removePathIfExists(path.join(dataRoot, 'brain', safeId));
      await removePathIfExists(path.join(dataRoot, 'conversations', safeId));
    } catch {
      // Ignore invalid leaf directory names
    }
  }

  // 2. Claude projects folder cleanup
  const claudeProjectsRoot = path.join(os.homedir(), '.claude', 'projects');
  const encodedCandidate = normalizedPath.replace(/[^a-zA-Z0-9_-]/g, '-');
  if (encodedCandidate && encodedCandidate !== '-') {
    const claudeProjectDir = path.join(claudeProjectsRoot, encodedCandidate);
    if (fsSync.existsSync(claudeProjectDir)) {
      await removePathIfExists(claudeProjectDir);
    }
  }

  // 3. Cursor projects folder cleanup
  const cursorProjectsRoot = path.join(os.homedir(), '.cursor', 'projects');
  if (encodedCandidate && encodedCandidate !== '-') {
    const cursorProjectDir = path.join(cursorProjectsRoot, encodedCandidate);
    if (fsSync.existsSync(cursorProjectDir)) {
      await removePathIfExists(cursorProjectDir);
    }
  }

  // 4. OpenCode database cleanup
  const openCodeDbPath = getOpenCodeDatabasePath();
  if (fsSync.existsSync(openCodeDbPath)) {
    let db: Database.Database | null = null;
    try {
      db = new Database(openCodeDbPath);
      db.prepare('DELETE FROM session WHERE directory = ?').run(normalizedPath);
    } catch (err) {
      console.warn('[SessionsService] Failed to clean up OpenCode project sessions:', err);
    } finally {
      if (db) {
        db.close();
      }
    }
  }

  // 5. ZCode database cleanup
  const zcodeDbPath = getZCodeDatabasePath();
  if (fsSync.existsSync(zcodeDbPath)) {
    let db: Database.Database | null = null;
    try {
      db = new Database(zcodeDbPath);
      db.prepare('DELETE FROM session WHERE directory = ?').run(normalizedPath);
    } catch (err) {
      console.warn('[SessionsService] Failed to clean up ZCode project sessions:', err);
    } finally {
      if (db) {
        db.close();
      }
    }
  }
}

/**
 * Archive rows need a stable project label even when the owning project is not
 * part of the active sidebar payload. This lightweight resolver keeps the
 * archive API self-contained while still matching the project's stored display
 * name when one exists.
 */
function resolveProjectDisplayName(
  projectPath: string | null,
  customProjectName: string | null | undefined,
): string {
  const trimmedCustomName = typeof customProjectName === 'string' ? customProjectName.trim() : '';
  if (trimmedCustomName.length > 0) {
    return trimmedCustomName;
  }

  if (!projectPath) {
    return 'Unknown Project';
  }

  return path.basename(projectPath) || projectPath;
}

/**
 * Application service for provider-backed session message operations.
 *
 * Callers pass a provider id and this service resolves the concrete provider
 * class, keeping normalization/history call sites decoupled from implementation
 * file layout.
 */
export const sessionsService = {
  /**
   * Lists provider ids that can load session history and normalize live messages.
   */
  listProviderIds(): LLMProvider[] {
    return providerRegistry.listProviders().map((provider) => provider.id);
  },

  /**
   * Returns app-facing ids for provider runs that are currently processing.
   *
   * This is intentionally status-only: callers that only need sidebar activity
   * indicators should not attach to chat streams or request replayed messages.
   */
  listRunningSessions(): Array<{
    sessionId: string;
    provider: LLMProvider;
    startedAt: number;
    lastSeq: number;
  }> {
    return chatRunRegistry.listRunningRuns();
  },

  /**
   * Returns the active conversation feed in true global activity order.
   */
  listRecentSessions(limit: number, offset: number): RecentSessionsPage {
    const page = sessionsDb.getRecentSessionsPage(limit, offset);
    const projectCache = new Map<string, ReturnType<typeof projectsDb.getProjectPath>>();
    const conversations = page.sessions.map((session) => {
      const projectPath = session.project_path?.trim() ? session.project_path : null;
      let project = null;

      if (projectPath) {
        if (!projectCache.has(projectPath)) {
          projectCache.set(projectPath, projectsDb.getProjectPath(projectPath));
        }
        project = projectCache.get(projectPath) ?? null;
      }

      return {
        sessionId: session.session_id,
        provider: session.provider as LLMProvider,
        projectId: project?.project_id ?? null,
        projectDisplayName: resolveProjectDisplayName(projectPath, project?.custom_project_name),
        sessionTitle: session.custom_name?.trim() || session.session_id,
        lastActivity: session.updated_at ?? session.created_at ?? null,
      };
    });

    return {
      conversations,
      total: page.total,
      hasMore: offset + conversations.length < page.total,
    };
  },

  /**
   * Resolves the provider-native session id a runtime needs for resume.
   *
   * Callers hand provider runtimes the stable app session id; the provider
   * CLIs/SDKs only understand their own native id, which lives on the session
   * row. Ids without a row are assumed to be provider-native already (direct
   * API callers that reference sessions the watcher has not indexed yet).
   */
  resolveProviderSessionId(sessionId: string | null | undefined): string | null {
    if (!sessionId) {
      return null;
    }

    const session = sessionsDb.getSessionById(sessionId);
    return session ? session.provider_session_id : sessionId;
  },

  /**
   * Normalizes one provider-native event into frontend session message events.
   */
  normalizeMessage(
    providerName: string,
    raw: unknown,
    sessionId: string | null,
  ): NormalizedMessage[] {
    return providerRegistry.resolveProvider(providerName).sessions.normalizeMessage(raw, sessionId);
  },

  /**
   * Allocates a stable app-facing session id before any provider run happens.
   *
   * This is the entry point of the session gateway: the frontend calls this
   * (via `POST /api/providers/sessions`) when the user starts a brand-new
   * chat, navigates to the returned id immediately, and the id never changes
   * for the lifetime of the conversation. The provider-native id is mapped to
   * this row later, when the provider runtime announces it mid-run. Its title
   * comes directly from the first visible CloudCLI message and is limited to
   * four whole words before any provider-owned storage exists.
   */
  createAppSession(
    provider: LLMProvider,
    projectPath: string,
    initialMessage: string,
  ): CreateAppSessionResult {
    const normalizedProjectPath = projectPath.trim();
    if (!normalizedProjectPath) {
      throw new AppError('projectPath is required.', {
        code: 'PROJECT_PATH_REQUIRED',
        statusCode: 400,
      });
    }

    const sessionId = randomUUID();
    const sessionName = buildCloudCliSessionName(initialMessage);
    sessionsDb.createAppSession(sessionId, provider, normalizedProjectPath, sessionName);

    return {
      sessionId,
      provider,
      projectPath: normalizedProjectPath,
      sessionName,
    };
  },

  /**
   * Resolves the provider-native id only for an explicit user copy action.
   * Normal session payloads continue to expose only the stable app id.
   */
  getProviderSessionId(sessionId: string): string {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (!session.provider_session_id) {
      throw new AppError('This session ID is not available yet.', {
        code: 'PROVIDER_SESSION_ID_NOT_AVAILABLE',
        statusCode: 409,
      });
    }

    return session.provider_session_id;
  },

  /**
   * Fetches persisted history by app session id.
   *
   * Provider and provider-specific lookup hints are resolved from the indexed
   * session metadata in the database. The provider adapter receives the
   * provider-native session id (the one written into transcripts on disk),
   * and every returned message is remapped back to the app session id so
   * provider ids never reach the frontend.
   */
  async fetchHistory(
    sessionId: string,
    options: Pick<FetchHistoryOptions, 'limit' | 'offset'> = {},
  ): Promise<FetchHistoryResult> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    // App-created sessions that never produced a provider transcript yet
    // (e.g. first message still streaming) simply have no history.
    if (!session.provider_session_id) {
      return {
        messages: [],
        total: 0,
        hasMore: false,
        offset: options.offset ?? 0,
        limit: options.limit ?? null,
      };
    }

    const provider = session.provider as LLMProvider;
    const result = await providerRegistry.resolveProvider(provider).sessions.fetchHistory(sessionId, {
      limit: options.limit ?? null,
      offset: options.offset ?? 0,
      projectPath: session.project_path ?? '',
      providerSessionId: session.provider_session_id,
    });

    return {
      ...result,
      messages: result.messages.map((message) => ({
        ...message,
        sessionId,
      })),
    };
  },

  /**
   * Resolves one session (by app id, falling back to the provider-native id)
   * to its metadata plus the owning project.
   *
   * This backs deep links like `/session/:sessionId`: the frontend's paginated
   * project payloads only carry each project's first session page, so a
   * session opened directly by URL may not be present client-side at all —
   * this lookup is the authoritative way to learn which project owns it.
   */
  getSessionDetailsById(sessionId: string): SessionDetails {
    const session =
      sessionsDb.getSessionById(sessionId) ?? sessionsDb.getSessionByProviderSessionId(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const projectPath = session.project_path?.trim() ? session.project_path : null;
    const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;

    return {
      sessionId: session.session_id,
      provider: session.provider as LLMProvider,
      summary: session.custom_name?.trim() || '',
      createdAt: session.created_at ?? null,
      updatedAt: session.updated_at ?? null,
      lastActivity: session.updated_at ?? session.created_at ?? null,
      isArchived: Boolean(session.isArchived),
      project: project && projectPath
        ? {
            projectId: project.project_id,
            path: projectPath,
            fullPath: projectPath,
            displayName: resolveProjectDisplayName(projectPath, project.custom_project_name),
            isStarred: Boolean(project.isStarred),
            isArchived: Boolean(project.isArchived),
          }
        : null,
    };
  },

  /**
   * Returns archived sessions with enough project metadata for the sidebar to
   * group, filter, open, and restore them without a per-row follow-up query.
   */
  listArchivedSessions(): ArchivedSessionListItem[] {
    const archivedSessions = sessionsDb.getArchivedSessions();
    const projectCache = new Map<string, ReturnType<typeof projectsDb.getProjectPath>>();

    return archivedSessions.map((session) => {
      const projectPath = session.project_path?.trim() ? session.project_path : null;
      let project = null;

      if (projectPath) {
        if (!projectCache.has(projectPath)) {
          projectCache.set(projectPath, projectsDb.getProjectPath(projectPath));
        }
        project = projectCache.get(projectPath) ?? null;
      }

      return {
        sessionId: session.session_id,
        provider: session.provider as LLMProvider,
        projectId: project?.project_id ?? null,
        projectPath,
        projectDisplayName: resolveProjectDisplayName(projectPath, project?.custom_project_name),
        sessionTitle: session.custom_name?.trim() || session.session_id,
        createdAt: session.created_at ?? null,
        updatedAt: session.updated_at ?? null,
        lastActivity: session.updated_at ?? session.created_at ?? null,
        isProjectArchived: Boolean(project?.isArchived),
      };
    });
  },

  /**
   * Archives or permanently deletes one persisted session row by id.
   *
   * Soft-delete mirrors the project behavior by toggling `isArchived` so the
   * row disappears from active lists but remains restorable. Force-delete
   * optionally removes the transcript file before deleting the database row.
   */
  async deleteOrArchiveSessionById(
    sessionId: string,
    options: {
      force?: boolean;
      deletedFromDisk?: boolean;
    } = {},
  ): Promise<{ sessionId: string; action: 'archived' | 'deleted'; deletedFromDisk: boolean }> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (!options.force) {
      sessionsDb.updateSessionIsArchived(sessionId, true);
      return {
        sessionId,
        action: 'archived',
        deletedFromDisk: false,
      };
    }

    let removedFromDisk = false;
    if (options.deletedFromDisk) {
      removedFromDisk = await cleanupProviderNativeSession(session);
    }

    const deleted = sessionsDb.deleteSessionById(sessionId);
    if (!deleted) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    return {
      sessionId,
      action: 'deleted',
      deletedFromDisk: removedFromDisk,
    };
  },

  /**
   * Restores one archived session back into the active sidebar lists.
   */
  restoreSessionById(sessionId: string): { sessionId: string; isArchived: false } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionsDb.updateSessionIsArchived(sessionId, false);
    return { sessionId, isArchived: false };
  },

  /**
   * Renames one session by id without requiring the caller to pass provider.
   */
  renameSessionById(sessionId: string, summary: string): { sessionId: string; summary: string } {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionsDb.updateSessionCustomName(sessionId, summary);
    return { sessionId, summary };
  },

  /**
   * Cleans up provider-native storage (transcripts, brain directories, summary DB rows)
   * for an entire project path when a project is permanently deleted.
   */
  async deleteProviderProjectStorage(projectPath: string): Promise<void> {
    await cleanupProviderProjectStorage(projectPath);
  },
};

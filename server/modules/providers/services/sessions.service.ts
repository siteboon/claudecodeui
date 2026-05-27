import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  NormalizedMessage,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

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

const HISTORY_JSONL_PATH = path.join(os.homedir(), '.claude', 'history.jsonl');

/**
 * Updates the display name for a session in ~/.claude/history.jsonl.
 * `claude -r` reads entries from this global file with a 100-entry limit per
 * project. Duplicate entries for the same session consume slots, so we keep
 * only one entry per session — the latest one with the correct display name.
 * If no entries exist, a new one is created.
 */
async function updateSessionDisplayNameInHistory(sessionId: string, displayName: string): Promise<void> {
  const session = sessionsDb.getSessionById(sessionId);
  const projectPath = session?.project_path || os.homedir();

  try {
    const content = await fsp.readFile(HISTORY_JSONL_PATH, 'utf8');
    const lines = content.split(/\r?\n/);

    // Collect all entries, keeping only the last one per sessionId
    const lastBySession = new Map<string, string>();
    const otherLines = [];
    const nonJsonLines = []; // lines that aren't valid JSON objects

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        nonJsonLines.push(line);
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          (parsed as Record<string, unknown>).sessionId !== undefined
        ) {
          const sid = String((parsed as Record<string, unknown>).sessionId);
          // Update display for our target, keep last entry per session
          if (sid === sessionId) {
            (parsed as Record<string, unknown>).display = displayName;
          }
          lastBySession.set(sid, JSON.stringify(parsed));
          continue;
        }
      } catch {
        // skip non-JSON lines
      }
      nonJsonLines.push(line);
    }

    // If no existing entry, append one with the correct project path
    if (!lastBySession.has(sessionId)) {
      lastBySession.set(sessionId, JSON.stringify({
        display: displayName,
        pastedContents: {},
        timestamp: Date.now(),
        project: projectPath,
        sessionId,
      }));
    }

    // Sort all entries by timestamp to preserve file order
    const sortedEntries = [...lastBySession.values()].sort((a, b) => {
      try {
        const ta = (JSON.parse(a) as Record<string, unknown>).timestamp;
        const tb = (JSON.parse(b) as Record<string, unknown>).timestamp;
        return Number(ta) - Number(tb);
      } catch {
        return 0;
      }
    });

    const finalLines = [...nonJsonLines, ...sortedEntries];
    await fsp.writeFile(HISTORY_JSONL_PATH, finalLines.join('\n'), 'utf8');
  } catch {
    // history.jsonl may not exist
  }
}

/**
 * Writes a custom-title entry to a session JSONL file so `claude -r` can
 * pick it up. `claude -r` reads the **last** custom-title, so we update all
 * existing entries and also prepend one as fallback.
 */
async function writeSessionCustomTitle(sessionId: string, jsonlPath: string, title: string): Promise<void> {
  try {
    const content = await fsp.readFile(jsonlPath, 'utf8');
    const lines = content.split(/\n/);
    let found = false;

    // Update ALL existing custom-title entries (claude -r reads the last one)
    for (let i = 0; i < lines.length; i++) {
      try {
        const data = JSON.parse(lines[i].trim()) as Record<string, unknown>;
        if (data.type === 'custom-title') {
          (data as Record<string, unknown>).customTitle = title;
          lines[i] = JSON.stringify(data);
          found = true;
        }
      } catch {
        // skip non-JSON lines
      }
    }

    if (found) {
      await fsp.writeFile(jsonlPath, lines.join('\n'), 'utf8');
      return;
    }

    // No custom-title found — prepend one
    const newEntry = JSON.stringify({ type: 'custom-title', customTitle: title });
    const newLines = [newEntry, ...lines];
    await fsp.writeFile(jsonlPath, newLines.join('\n'), 'utf8');
  } catch {
    // file may not exist or be unreadable
  }
}

/**
 * Extracts a display name from a session JSONL file.
 * Priority: custom-title > ai-title > last-prompt
 */
async function extractSessionDisplayName(filePath: string): Promise<string | null> {
  try {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let aiTitle: string | undefined;
    let lastPrompt: string | undefined;

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const data = JSON.parse(trimmed) as Record<string, unknown>;
        const type = typeof data.type === 'string' ? data.type : undefined;
        if (type === 'custom-title' && typeof data.customTitle === 'string') {
          return data.customTitle.trim() || null;
        }
        if (type === 'ai-title' && typeof data.aiTitle === 'string') {
          aiTitle = data.aiTitle.trim() || undefined;
        }
        if (type === 'last-prompt' && typeof data.lastPrompt === 'string') {
          lastPrompt = data.lastPrompt.trim() || undefined;
        }
      } catch {
        // skip non-JSON lines
      }
    }

    return (aiTitle || lastPrompt || null)?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Builds a Map<sessionId, { displayName, projectPath }> from all session JSONL
 * files on disk + DB custom_names (DB takes precedence).
 */
async function buildSessionNameMap(): Promise<Map<string, { displayName: string; projectPath: string }>> {
  const nameMap = new Map<string, { displayName: string; projectPath: string }>();

  // 1. DB custom_name entries (highest priority)
  const dbSessions = sessionsDb.getSessionsWithCustomName();
  for (const s of dbSessions) {
    nameMap.set(s.session_id, { displayName: s.custom_name, projectPath: s.project_path || os.homedir() });
  }

  // 2. All session JSONL files on disk
  try {
    const entries = await fsp.readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectDir = path.join(CLAUDE_PROJECTS_DIR, entry.name);
      try {
        const files = await fsp.readdir(projectDir);
        for (const fileName of files) {
          if (!fileName.endsWith('.jsonl')) continue;
          const filePath = path.join(projectDir, fileName);
          const sessionId = fileName.slice(0, -6);

          // Skip if already in DB
          if (nameMap.has(sessionId)) continue;

          const displayName = await extractSessionDisplayName(filePath);
          if (!displayName) continue;

          // Determine project path from directory name
          // Directory names are URL-encoded paths like "-Users-xiawenhua" or "-Users-xiawenhua-hermes-agent"
          const dirName = entry.name;
          let projectPath = os.homedir();
          try {
            const decoded = decodeURIComponent(dirName);
            projectPath = decoded.startsWith('/') ? decoded : os.homedir();
          } catch {
            // keep default
          }

          nameMap.set(sessionId, { displayName, projectPath });
        }
      } catch {
        // skip unreadable directories
      }
    }
  } catch {
    // claude/projects directory may not exist
  }

  return nameMap;
}

/**
 * Scans all sessions with custom_name and updates ~/.claude/history.jsonl
 * so `claude -r` displays the CloudCLI session names.
 * Also discovers sessions on disk that aren't in the DB yet.
 */
async function syncAllSessionNamesToHistory(): Promise<void> {
  const nameMap = await buildSessionNameMap();
  if (nameMap.size === 0) return;

  try {
    const content = await fsp.readFile(HISTORY_JSONL_PATH, 'utf8');
    const lines = content.split(/\r?\n/);

    // Keep only the last entry per session, update display names
    const lastBySession = new Map<string, string>();
    const nonJsonLines = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        nonJsonLines.push(line);
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null && (parsed as Record<string, unknown>).sessionId !== undefined) {
          const sid = String((parsed as Record<string, unknown>).sessionId);
          const nameEntry = nameMap.get(sid);
          if (nameEntry) {
            (parsed as Record<string, unknown>).display = nameEntry.displayName;
            (parsed as Record<string, unknown>).project = nameEntry.projectPath;
          }
          lastBySession.set(sid, JSON.stringify(parsed));
          continue;
        }
      } catch {
        // skip non-JSON lines
      }
      nonJsonLines.push(line);
    }

    // Add entries for sessions not yet in history.jsonl
    for (const [sid, info] of nameMap) {
      if (!lastBySession.has(sid)) {
        lastBySession.set(sid, JSON.stringify({
          display: info.displayName,
          pastedContents: {},
          timestamp: Date.now(),
          project: info.projectPath,
          sessionId: sid,
        }));
      }
    }

    // Sort by timestamp
    const sortedEntries = [...lastBySession.values()].sort((a, b) => {
      try {
        return Number(JSON.parse(a).timestamp) - Number(JSON.parse(b).timestamp);
      } catch {
        return 0;
      }
    });

    const finalLines = [...nonJsonLines, ...sortedEntries];
    await fsp.writeFile(HISTORY_JSONL_PATH, finalLines.join('\n'), 'utf8');
    console.log(`[Sessions] Synced ${nameMap.size} session name(s) to ~/.claude/history.jsonl`);
  } catch {
    // history.jsonl may not exist — fall back to per-session sync
    for (const [sid, info] of nameMap) {
      try {
        await updateSessionDisplayNameInHistory(sid, info.displayName);
      } catch {
        // skip
      }
    }
  }
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
   * Normalizes one provider-native event into frontend session message events.
   */
  normalizeMessage(
    providerName: string,
    raw: unknown,
    sessionId: string | null,
    subagentPrompts: Set<string> | null = null,
  ): NormalizedMessage[] {
    return providerRegistry.resolveProvider(providerName).sessions.normalizeMessage(
      raw,
      sessionId,
      subagentPrompts,
    );
  },

  /**
   * Fetches persisted history by session id.
   *
   * Provider and provider-specific lookup hints are resolved from the indexed
   * session metadata in the database.
   */
  fetchHistory(
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

    const provider = session.provider as LLMProvider;
    return providerRegistry.resolveProvider(provider).sessions.fetchHistory(sessionId, {
      limit: options.limit ?? null,
      offset: options.offset ?? 0,
      projectPath: session.project_path ?? '',
    });
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
    if (options.deletedFromDisk && session.jsonl_path) {
      removedFromDisk = await removeFileIfExists(session.jsonl_path);
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
   * Renames one session by id and syncs the name to the provider's history file.
   */
  async renameSessionById(sessionId: string, summary: string): Promise<{ sessionId: string; summary: string }> {
    const session = sessionsDb.getSessionById(sessionId);
    if (!session) {
      throw new AppError(`Session "${sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    sessionsDb.updateSessionCustomName(sessionId, summary);
    void updateSessionDisplayNameInHistory(sessionId, summary);
    if (session.jsonl_path) {
      void writeSessionCustomTitle(sessionId, session.jsonl_path, summary);
    }
    return { sessionId, summary };
  },

  /**
   * Scans all indexed sessions with custom_name and syncs them to their
   * session JSONL files so `claude -r` displays the CloudCLI session names.
   * Runs once at startup to keep existing sessions in sync.
   */
  async syncSessionNames(): Promise<void> {
    await syncAllSessionNamesToHistory();
  },
};

import os from 'node:os';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';

import chokidar, { type FSWatcher } from 'chokidar';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { sessionSynchronizerService } from '@/modules/providers/services/session-synchronizer.service.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { LLMProvider } from '@/shared/types.js';
import { generateDisplayName } from '@/modules/projects/index.js';

type WatcherEventType = 'add' | 'change';

const PROVIDER_WATCH_PATHS: Array<{ provider: LLMProvider; rootPath: string }> = [
  {
    provider: 'claude',
    rootPath: path.join(os.homedir(), '.claude', 'projects'),
  },
  {
    provider: 'cursor',
    rootPath: path.join(os.homedir(), '.cursor', 'projects'),
  },
  {
    provider: 'codex',
    rootPath: path.join(os.homedir(), '.codex', 'sessions'),
  },
  {
    provider: 'opencode',
    rootPath: path.join(os.homedir(), '.local', 'share', 'opencode'),
  },
];

const WATCHER_IGNORED_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/subagents/**',
  '**/tool-results/**',
  '**/*.tmp',
  '**/*.swp',
  '**/.DS_Store',
];

const PROJECTS_UPDATE_DEBOUNCE_MS = 500;
const PROJECTS_UPDATE_MAX_WAIT_MS = 2_000;

const watchers: FSWatcher[] = [];

type PendingWatcherUpdate = {
  providers: Set<LLMProvider>;
  changeTypes: Set<WatcherEventType>;
  /**
   * Provider-native session ids reported by the synchronizers. They are
   * translated back to app-facing session rows at flush time, because the
   * transcript file names on disk only ever contain provider ids.
   */
  updatedSessionIds: Set<string>;
};

let pendingWatcherUpdate: PendingWatcherUpdate | null = null;
let pendingWatcherUpdateStartedAt: number | null = null;
let pendingWatcherFlushTimer: ReturnType<typeof setTimeout> | null = null;
let watcherRefreshInFlight = false;
let watcherRescheduleAfterRefresh = false;

/**
 * Filters watcher events to provider-specific session artifact file types.
 */
function isWatcherTargetFile(provider: LLMProvider, filePath: string): boolean {
  if (provider === 'opencode') {
    return path.basename(filePath) === 'opencode.db';
  }

  return filePath.endsWith('.jsonl');
}

/**
 * Mirrors `ClaudeSessionSynchronizer.isSubagentTranscript`: subagent
 * transcripts live under a `subagents/` directory and repeat their parent
 * session's id, so an unlink of one must never be mistaken for the parent
 * session's transcript disappearing.
 */
function isSubagentTranscriptPath(filePath: string): boolean {
  return path.normalize(filePath).split(path.sep).includes('subagents');
}

/**
 * Removes the session row backing an unlinked transcript file, if any.
 *
 * Disk is the source of truth for a session's existence: `isArchived` is
 * purely a GUI-side hide for sessions that still exist on disk, so once the
 * transcript is gone the row is deleted outright, even if it was archived in
 * the UI — the Claude TUI's own delete unlinks the transcript, and this
 * mirrors that.
 *
 * `opencode` is skipped entirely: its sessions are rows in a shared
 * `opencode.db`, not one file per session, so a single unlink of that file
 * does not mean any particular session disappeared. Subagent transcripts are
 * skipped because they share their parent session's id and are not indexed
 * as sessions in the first place.
 *
 * Exported (rather than only reachable through the chokidar callback) so it
 * can be unit tested directly.
 */
export function removeSessionForUnlinkedFile(
  provider: LLMProvider,
  filePath: string
): { sessionId: string; provider: LLMProvider } | null {
  if (provider === 'opencode' || isSubagentTranscriptPath(filePath)) {
    return null;
  }

  const session = sessionsDb.getSessionByJsonlPath(filePath);
  if (!session) {
    return null;
  }

  sessionsDb.deleteSessionById(session.session_id);
  return { sessionId: session.session_id, provider };
}

/**
 * Sweeps file-backed session rows and deletes any whose transcript no longer
 * exists on disk.
 *
 * Considers archived rows too: disk is the source of truth for a session's
 * existence, so an orphan row must not be able to hide from this sweep in
 * the archive view.
 *
 * Runs once at startup so deletions that happened while the server was down
 * (chokidar only reports changes while it is watching) are still noticed.
 * Exported for direct testing and reuse.
 */
export async function reconcileMissingSessionFiles(): Promise<{ removedCount: number; checkedCount: number }> {
  const candidates = sessionsDb.getReconcilableSessions();
  let removedCount = 0;

  for (const session of candidates) {
    if (!session.jsonl_path) {
      continue;
    }

    try {
      await fsPromises.access(session.jsonl_path);
    } catch {
      sessionsDb.deleteSessionById(session.session_id);
      removedCount += 1;
    }
  }

  return { removedCount, checkedCount: candidates.length };
}

function clearPendingWatcherFlushTimer(): void {
  if (pendingWatcherFlushTimer) {
    clearTimeout(pendingWatcherFlushTimer);
    pendingWatcherFlushTimer = null;
  }
}

function schedulePendingWatcherFlush(): void {
  if (!pendingWatcherUpdate) {
    return;
  }

  const now = Date.now();
  if (pendingWatcherUpdateStartedAt === null) {
    pendingWatcherUpdateStartedAt = now;
  }

  const elapsed = now - pendingWatcherUpdateStartedAt;
  const remainingMaxWait = Math.max(0, PROJECTS_UPDATE_MAX_WAIT_MS - elapsed);
  const delay = Math.min(PROJECTS_UPDATE_DEBOUNCE_MS, remainingMaxWait);

  clearPendingWatcherFlushTimer();
  pendingWatcherFlushTimer = setTimeout(() => {
    void flushPendingWatcherUpdate();
  }, delay);
}

function queuePendingWatcherUpdate(
  eventType: WatcherEventType,
  provider: LLMProvider,
  updatedSessionId: string | null
): void {
  if (!pendingWatcherUpdate) {
    pendingWatcherUpdate = {
      providers: new Set<LLMProvider>(),
      changeTypes: new Set<WatcherEventType>(),
      updatedSessionIds: new Set<string>(),
    };
  }

  pendingWatcherUpdate.providers.add(provider);
  pendingWatcherUpdate.changeTypes.add(eventType);
  if (updatedSessionId) {
    pendingWatcherUpdate.updatedSessionIds.add(updatedSessionId);
  }

  schedulePendingWatcherFlush();
}

/**
 * Builds one `session_upserted` delta event for a provider-native session id.
 *
 * The event carries everything a sidebar needs to upsert the session in place
 * (session summary plus owning-project metadata), so clients never need a full
 * project-list refetch when a transcript file changes on disk. Returns `null`
 * when the id cannot be resolved to an indexed session row.
 */
async function buildSessionUpsertedEvent(updatedProviderSessionId: string): Promise<string | null> {
  const row = sessionsDb.getSessionByProviderSessionId(updatedProviderSessionId)
    ?? sessionsDb.getSessionById(updatedProviderSessionId);
  if (!row || row.isArchived) {
    return null;
  }

  const projectPath = row.project_path;
  const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;
  const displayName = project?.custom_project_name?.trim()
    ? project.custom_project_name
    : await generateDisplayName(path.basename(projectPath ?? '') || (projectPath ?? ''), projectPath);

  return JSON.stringify({
    kind: 'session_upserted',
    sessionId: row.session_id,
    provider: row.provider,
    session: {
      id: row.session_id,
      summary: row.custom_name || '',
      messageCount: 0,
      lastActivity: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    },
    project: project
      ? {
        projectId: project.project_id,
        path: project.project_path,
        fullPath: project.project_path,
        displayName,
        isStarred: Boolean(project.isStarred),
      }
      : null,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Broadcasts a `session_removed` event so the sidebar drops the session
 * live, without waiting for a full project refetch.
 *
 * Follows the same envelope pattern as `session_upserted` (`kind`,
 * `sessionId`, `provider`, `timestamp`) but only carries what the frontend
 * needs to remove a row: no session/project payload, since a deleted
 * session no longer needs to be rendered.
 */
function broadcastSessionRemoved(sessionId: string, provider: LLMProvider): void {
  const event = JSON.stringify({
    kind: 'session_removed',
    sessionId,
    provider,
    timestamp: new Date().toISOString(),
  });

  connectedClients.forEach(client => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(event);
    }
  });
}

/**
 * Handles a chokidar `unlink` event for one provider's watched transcript.
 */
async function onUnlink(filePath: string, provider: LLMProvider): Promise<void> {
  if (!isWatcherTargetFile(provider, filePath)) {
    return;
  }

  try {
    const removed = removeSessionForUnlinkedFile(provider, filePath);
    if (!removed) {
      return;
    }

    console.log(`Session removed after transcript deletion for provider "${provider}"`, {
      filePath,
      sessionId: removed.sessionId,
    });
    broadcastSessionRemoved(removed.sessionId, removed.provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Session watcher unlink handling failed for provider "${provider}"`, {
      filePath,
      error: message,
    });
  }
}

async function flushPendingWatcherUpdate(): Promise<void> {
  clearPendingWatcherFlushTimer();

  if (!pendingWatcherUpdate) {
    return;
  }

  if (watcherRefreshInFlight) {
    watcherRescheduleAfterRefresh = true;
    return;
  }

  const queuedUpdate = pendingWatcherUpdate;
  pendingWatcherUpdate = null;
  pendingWatcherUpdateStartedAt = null;
  watcherRefreshInFlight = true;

  try {
    // Per-session deltas instead of full project snapshots: an upsert of one
    // session can never clobber unrelated client state, so the frontend needs
    // no "suppress updates while a run is active" protection logic.
    const events: string[] = [];
    for (const updatedSessionId of queuedUpdate.updatedSessionIds) {
      const event = await buildSessionUpsertedEvent(updatedSessionId);
      if (event) {
        events.push(event);
      }
    }

    if (events.length > 0) {
      connectedClients.forEach(client => {
        if (client.readyState === WS_OPEN_STATE) {
          for (const event of events) {
            client.send(event);
          }
        }
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Session watcher refresh failed while broadcasting session_upserted', { error: message });
  } finally {
    watcherRefreshInFlight = false;

    if (pendingWatcherUpdate || watcherRescheduleAfterRefresh) {
      watcherRescheduleAfterRefresh = false;
      schedulePendingWatcherFlush();
    }
  }
}

/**
 * Unarchives the session row for a provider-native id touched by real watcher
 * activity (an `add`/`change` event), if it was hidden in the GUI.
 *
 * A watcher event means something happened on disk for this specific
 * session, unlike a full sync (`createSession`), which runs for reasons
 * unrelated to any one session and must never un-hide everything. Must run
 * before `buildSessionUpsertedEvent` resolves the row, since that helper
 * returns null for archived rows.
 *
 * Exported for direct testing.
 */
export function unarchiveSessionForRealActivity(providerSessionId: string): boolean {
  const row = sessionsDb.getSessionByProviderSessionId(providerSessionId)
    ?? sessionsDb.getSessionById(providerSessionId);
  if (!row?.isArchived) {
    return false;
  }

  sessionsDb.updateSessionIsArchived(row.session_id, false);
  return true;
}

/**
 * Handles file watcher updates and triggers provider file-level synchronization.
 */
async function onUpdate(
  eventType: WatcherEventType,
  filePath: string,
  provider: LLMProvider
): Promise<void> {
  if (!isWatcherTargetFile(provider, filePath)) {
    return;
  }

  try {
    const result = await sessionSynchronizerService.synchronizeProviderFile(provider, filePath);
    if (!result.indexed) {
      return;
    }

    if (result.sessionId) {
      unarchiveSessionForRealActivity(result.sessionId);
    }

    console.log(`Session synchronization triggered by ${eventType} event for provider "${provider}"`, {
      filePath,
      sessionId: result.sessionId,
    });
    queuePendingWatcherUpdate(eventType, provider, result.sessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Session watcher sync failed for provider "${provider}"`, {
      eventType,
      filePath,
      error: message,
    });
  }
}

/**
 * Starts provider filesystem watchers and performs initial DB synchronization.
 */
export async function initializeSessionsWatcher(): Promise<void> {
  console.log('Setting up session watchers');

  const initialSync = await sessionSynchronizerService.synchronizeSessions();
  console.log('Initial session synchronization complete', {
    processedByProvider: initialSync.processedByProvider,
    failures: initialSync.failures,
  });

  const reconcileResult = await reconcileMissingSessionFiles();
  console.log(
    `Session reconcile sweep removed ${reconcileResult.removedCount} of ${reconcileResult.checkedCount} checked session(s) with missing transcripts`
  );

  for (const { provider, rootPath } of PROVIDER_WATCH_PATHS) {
    try {
      await fsPromises.mkdir(rootPath, { recursive: true });

      const watcher = chokidar.watch(rootPath, {
        ignored: WATCHER_IGNORED_PATTERNS,
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        depth: 6,
        usePolling: true,
        interval: 6_000,
        binaryInterval: 6_000,
      });

      watcher
        .on('add', (filePath: string) => {
          void onUpdate('add', filePath, provider);
        })
        .on('change', (filePath: string) => {
          void onUpdate('change', filePath, provider);
        })
        .on('unlink', (filePath: string) => {
          void onUnlink(filePath, provider);
        })
        .on('error', (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Session watcher error for provider "${provider}"`, { error: message });
        });

      watchers.push(watcher);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to initialize session watcher for provider "${provider}"`, {
        rootPath,
        error: message,
      });
    }
  }
}

/**
 * Stops all active provider session watchers.
 */
export async function closeSessionsWatcher(): Promise<void> {
  clearPendingWatcherFlushTimer();

  await Promise.all(
    watchers.map(async (watcher) => {
      try {
        await watcher.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Failed to close session watcher', { error: message });
      }
    })
  );
  watchers.length = 0;
  pendingWatcherUpdate = null;
  pendingWatcherUpdateStartedAt = null;
  watcherRefreshInFlight = false;
  watcherRescheduleAfterRefresh = false;
}

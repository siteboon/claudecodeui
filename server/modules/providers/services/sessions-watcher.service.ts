import os from 'node:os';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';

import chokidar, { type FSWatcher } from 'chokidar';

import { sessionSynchronizerService } from '@/modules/providers/services/session-synchronizer.service.js';
import { broadcastSessionUpsertedBatch } from '@/modules/websocket/index.js';
import type { LLMProvider } from '@/shared/types.js';

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

/**
 * What the watcher never descends into or reports. These used to be glob
 * strings, which chokidar v4 no longer understands: it takes a path, a RegExp
 * or a function, so the globs matched nothing and every file under every
 * provider root was watched and, with polling, stat()ed every interval (#1156).
 */
const IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  // Claude writes a subagent's transcript and large tool outputs here. The
  // synchronizer skips them already (#880); ignoring them here keeps the
  // watcher from walking them at all.
  'subagents',
  'tool-results',
]);
const IGNORED_FILE_NAMES = new Set(['.DS_Store']);
const IGNORED_FILE_SUFFIXES = ['.tmp', '.swp'];

/**
 * Builds chokidar's `ignored` matcher for one watch root.
 *
 * Only the part of the path below `rootPath` is checked, so a home directory
 * that happens to sit under `/build` or `/dist` cannot hide a whole provider.
 *
 * Exported for the providers module's tests, which run it against chokidar on
 * a real directory tree.
 */
export function createWatcherIgnoredMatcher(rootPath: string): (filePath: string) => boolean {
  return (filePath: string) => {
    const relativePath = path.relative(rootPath, filePath);
    // Outside the root is `..` as a whole component, or an absolute result
    // (another drive on Windows). A child called `..archive` is still inside.
    const isOutsideRoot = relativePath === '..'
      || relativePath.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativePath);
    if (!relativePath || isOutsideRoot) {
      return false;
    }

    const segments = relativePath.split(path.sep);
    const baseName = segments[segments.length - 1];
    if (IGNORED_FILE_NAMES.has(baseName) || IGNORED_FILE_SUFFIXES.some((suffix) => baseName.endsWith(suffix))) {
      return true;
    }

    return segments.some((segment) => IGNORED_DIRECTORY_NAMES.has(segment));
  };
}

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
    await broadcastSessionUpsertedBatch(queuedUpdate.updatedSessionIds);
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
    prunedOrphans: initialSync.prunedOrphans,
    failures: initialSync.failures,
  });

  for (const { provider, rootPath } of PROVIDER_WATCH_PATHS) {
    try {
      await fsPromises.mkdir(rootPath, { recursive: true });

      const watcher = chokidar.watch(rootPath, {
        ignored: createWatcherIgnoredMatcher(rootPath),
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        depth: 6,
        // Polling reaches filesystems that native events cannot: WSL's /mnt/c,
        // network shares, some container mounts. Where native events do work,
        // chokidar's own CHOKIDAR_USEPOLLING=false overrides this and a finished
        // turn reaches the sidebar at once instead of up to 6 s later.
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

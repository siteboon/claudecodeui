import chokidar from 'chokidar';
import os from 'node:os';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';

import { llmSessionsService } from '@/modules/llm/services/sessions.service.js';
import type { LLMProvider } from '@/shared/types/app.js';
import { logger } from '@/shared/utils/logger.js';

// File system watchers for provider project/session folders
const PROVIDER_WATCH_PATHS: Array<{ provider: LLMProvider; rootPath: string }> = [
  {
    provider: 'claude',
    rootPath: path.join(os.homedir(), '.claude', 'projects'),
  },
  {
    provider: 'cursor',
    rootPath: path.join(os.homedir(), '.cursor', 'chats'),
  },
  {
    provider: 'codex',
    rootPath: path.join(os.homedir(), '.codex', 'sessions'),
  },
  {
    provider: 'gemini',
    rootPath: path.join(os.homedir(), '.gemini', 'sessions'),
  },
  {
    provider: 'gemini',
    rootPath: path.join(os.homedir(), '.gemini', 'tmp'),
  },
];

const WATCHER_IGNORED_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/*.tmp',
  '**/*.swp',
  '**/.DS_Store',
];


const watchers: any[] = [];
type EventType = 'add' | 'change';

/**
 * Handles watcher update events and triggers provider index synchronization.
 */
async function onUpdate(
  eventType: EventType,
  filePath: string,
  provider: LLMProvider,
): Promise<void> {
  try {
    const result = await llmSessionsService.synchronizeProvider(provider, { fullRescan: true });
    logger.info(`LLM watcher sync complete for provider "${provider}" after ${eventType}`, {
      filePath,
      processed: result.processed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`LLM watcher sync failed for provider "${provider}"`, {
      eventType,
      filePath,
      error: message,
    });
  }
}

/**
 * Initializes LLM session watchers and performs an initial index sync.
 */
export async function initializeWatcher(): Promise<void> {
  logger.info('Setting up LLM session watchers...');

  const initialSync = await llmSessionsService.synchronizeSessions();
  logger.info('Initial LLM session sync complete.', {
    processedByProvider: initialSync.processedByProvider,
    failures: initialSync.failures,
  });

  for (const { provider, rootPath } of PROVIDER_WATCH_PATHS) {
    try {
      // chokidar v4 emits ENOENT via the "error" event for missing roots and will not auto-recover.
      // Ensure provider folders exist before creating the watcher so watching stays active.
      await fsPromises.mkdir(rootPath, { recursive: true });

      const watcher = chokidar.watch(rootPath, {
        ignored: WATCHER_IGNORED_PATTERNS,
        persistent: true,
        // Don't fire events for existing files on startup
        ignoreInitial: true,
        followSymlinks: false,
        // Reasonable depth limit
        depth: 6,
        // Use polling to fix Windows fs.watch buffering/batching issues.
        // It now stops relying on native filesystem events and checks for changes at intervals.
        usePolling: true,
        // Poll every 2000ms
        interval: 2_000,
        // Large binary files are more expensive to poll than text files.
        binaryInterval: 6_000,
        // Removed awaitWriteFinish to prevent delays when LLM streams to the file
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
          logger.error(`LLM watcher error for provider "${provider}"`, {
            error: message,
          });
        });

      watchers.push(watcher);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to initialize LLM watcher for provider "${provider}"`, {
        rootPath,
        error: message,
      });
    }
  }
}

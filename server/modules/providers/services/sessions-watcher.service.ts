import { sessionSynchronizerService } from '@/modules/providers/services/session-synchronizer.service.js';

let scanTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts a periodic session scan instead of chokidar file watchers.
 *
 * Watching 60+ JSONL files with recursive stat causes file descriptor leaks,
 * SQLite lock contention, and event loop hangs. A simple interval scan avoids
 * these issues entirely while still keeping the DB in sync.
 */
export async function initializeSessionsWatcher(): Promise<void> {
  console.log('Setting up session watchers');

  const initialSync = await sessionSynchronizerService.synchronizeSessions();
  console.log('Initial session synchronization complete', {
    processedByProvider: initialSync.processedByProvider,
    failures: initialSync.failures,
  });

  // Replace chokidar with a simple interval scan — no file descriptor leak,
  // no recursive stat storm, no SQLite lock contention.
  const SCAN_INTERVAL_MS = 60_000; // 1 minute
  scanTimer = setInterval(async () => {
    try {
      await sessionSynchronizerService.synchronizeSessions();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Periodic session scan failed', { error: message });
    }
  }, SCAN_INTERVAL_MS);

  // Make sure the timer doesn't keep the process alive if everything else shuts down
  if (scanTimer.unref) {
    scanTimer.unref();
  }

  console.log(`Periodic session scan enabled (every ${SCAN_INTERVAL_MS / 1000}s), chokidar watchers disabled`);
}

/**
 * Stops the periodic session scan timer.
 */
export async function closeSessionsWatcher(): Promise<void> {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}

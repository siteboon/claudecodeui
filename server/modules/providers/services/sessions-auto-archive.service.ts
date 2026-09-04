import { appConfigDb, sessionsDb } from '@/modules/database/index.js';

/**
 * Auto-archive configuration options.
 * Used by provider.routes and sessionsAutoArchiveService.
 */
export type SessionsAutoArchiveSettings = {
  enabled: boolean;
  retentionDays: number;
};

/**
 * Fallback defaults when configuration has not been set.
 * Used by sessionsAutoArchiveService and its unit tests.
 */
export const DEFAULT_AUTO_ARCHIVE_SETTINGS: SessionsAutoArchiveSettings = {
  enabled: false,
  retentionDays: 1,
};

const CONFIG_KEY = 'sessions_auto_archive_settings';
const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let initialRunTimer: ReturnType<typeof setTimeout> | null = null;
let isArchiveRunning = false;

/**
 * Calculates the cutoff ISO string based on natural day boundaries.
 * For retentionDays = 1, cutoff is local midnight (00:00:00) of the current day.
 * For retentionDays = N, cutoff is local midnight N - 1 days prior to today.
 * Used by sessionsAutoArchiveService and unit tests.
 */
export function calculateCutoffDate(retentionDays: number, now = new Date()): string {
  const safeDays = Math.max(1, Math.floor(retentionDays));
  // Create date anchored at today's local midnight
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  midnight.setDate(midnight.getDate() - (safeDays - 1));
  return midnight.toISOString();
}

/**
 * Service managing automatic archiving of historical sessions.
 * Used by server/index.ts (scheduler lifecycle) and provider.routes.ts (settings & manual trigger).
 */
export const sessionsAutoArchiveService = {
  getSettings(): SessionsAutoArchiveSettings {
    const raw = appConfigDb.get(CONFIG_KEY);
    if (!raw) {
      return { ...DEFAULT_AUTO_ARCHIVE_SETTINGS };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<SessionsAutoArchiveSettings>;
      return {
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_AUTO_ARCHIVE_SETTINGS.enabled,
        retentionDays:
          typeof parsed.retentionDays === 'number' && parsed.retentionDays >= 1
            ? Math.floor(parsed.retentionDays)
            : DEFAULT_AUTO_ARCHIVE_SETTINGS.retentionDays,
      };
    } catch {
      return { ...DEFAULT_AUTO_ARCHIVE_SETTINGS };
    }
  },

  updateSettings(partial: Partial<SessionsAutoArchiveSettings>): SessionsAutoArchiveSettings {
    const current = this.getSettings();
    const next: SessionsAutoArchiveSettings = {
      enabled: typeof partial.enabled === 'boolean' ? partial.enabled : current.enabled,
      retentionDays:
        typeof partial.retentionDays === 'number' && partial.retentionDays >= 1
          ? Math.floor(partial.retentionDays)
          : current.retentionDays,
    };

    appConfigDb.set(CONFIG_KEY, JSON.stringify(next));
    return next;
  },


  /**
   * Executes the archive operation using current or provided retention setting.
   * Prevents concurrent runs.
   */
  async runAutoArchive(retentionDaysOverride?: number): Promise<{ archivedCount: number; cutoff: string }> {
    if (isArchiveRunning) {
      return { archivedCount: 0, cutoff: new Date().toISOString() };
    }

    isArchiveRunning = true;
    try {
      const settings = this.getSettings();
      const days = retentionDaysOverride ?? settings.retentionDays;
      const cutoff = calculateCutoffDate(days);

      const archivedCount = sessionsDb.archiveSessionsOlderThanCutoff(cutoff);
      if (archivedCount > 0) {
        console.log(`[SessionsAutoArchive] Archived ${archivedCount} session(s) older than ${cutoff}`);
      }
      return { archivedCount, cutoff };
    } finally {
      isArchiveRunning = false;
    }
  },

  /**
   * Starts the background interval scheduler.
   */
  startScheduler(intervalMs = DEFAULT_CHECK_INTERVAL_MS): void {
    if (schedulerTimer) {
      return;
    }

    const checkAndRun = async () => {
      try {
        const settings = this.getSettings();
        if (!settings.enabled) {
          return;
        }
        await this.runAutoArchive();
      } catch (error) {
        console.error('[SessionsAutoArchive] Scheduled check error:', error);
      }
    };

    // Run after a short delay on server startup
    initialRunTimer = setTimeout(() => {
      initialRunTimer = null;
      void checkAndRun();
    }, 10_000);

    schedulerTimer = setInterval(() => {
      void checkAndRun();
    }, intervalMs);

    if (schedulerTimer.unref) {
      schedulerTimer.unref();
    }
    if (initialRunTimer.unref) {
      initialRunTimer.unref();
    }
  },

  /**
   * Stops the background interval scheduler.
   */
  stopScheduler(): void {
    if (initialRunTimer) {
      clearTimeout(initialRunTimer);
      initialRunTimer = null;
    }
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
  },
};

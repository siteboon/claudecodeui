import { recoverFromDatabaseError, scanStateDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { LLMProvider } from '@/shared/types.js';

type SessionSynchronizeResult = {
  processedByProvider: Record<LLMProvider, number>;
  failures: string[];
};

/**
 * Orchestrates provider-specific session indexers and indexed-session lifecycle operations.
 */
export const sessionSynchronizerService = {
  /**
   * Runs all provider synchronizers and updates scan_state.last_scanned_at.
   */
  async synchronizeSessions(): Promise<SessionSynchronizeResult> {
    const lastScanAt = scanStateDb.getLastScannedAt();
    const scanBoundary = new Date();
    const processedByProvider: Record<LLMProvider, number> = {
      claude: 0,
      codex: 0,
      cursor: 0,
      opencode: 0,
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

    if (failures.length === 0) {
      // Advancing the cursor is bookkeeping: callers only read sessions. A
      // failure here (a read-only or moved database, a locked file) must be
      // reported like a provider failure rather than thrown, otherwise it takes
      // down every endpoint that lists projects.
      try {
        scanStateDb.updateLastScannedAt(scanBoundary);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[Sessions] Failed to advance scan_state cursor: ${reason}`);
        failures.push(`scan_state cursor update failed: ${reason}`);

        // If the database file was replaced underneath us the handle is latched
        // read-only forever; drop it so the next request opens a fresh one.
        recoverFromDatabaseError(error);
      }
    } else {
      console.warn(
        `[Sessions] Skipping scan_state cursor advance because ${failures.length} provider sync(s) failed.`,
      );
    }

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
  ): Promise<{ provider: LLMProvider; indexed: boolean; sessionId: string | null }> {
    const resolvedProvider = providerRegistry.resolveProvider(provider);
    const sessionId = await resolvedProvider.sessionSynchronizer.synchronizeFile(filePath);
    return {
      provider,
      indexed: Boolean(sessionId),
      sessionId,
    };
  },
};

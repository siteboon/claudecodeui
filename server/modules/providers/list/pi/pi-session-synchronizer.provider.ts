import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

/**
 * Phase 1 synchronizer placeholder for Pi.
 *
 * Reporting zero processed sessions keeps the shared scan cursor advancing
 * while Pi has no on-disk indexer yet; the JSONL scanner under
 * `getPiSessionDir()` replaces both methods.
 */
export class PiSessionSynchronizer implements IProviderSessionSynchronizer {
  async synchronize(): Promise<number> {
    return 0;
  }

  async synchronizeFile(): Promise<string | null> {
    return null;
  }
}

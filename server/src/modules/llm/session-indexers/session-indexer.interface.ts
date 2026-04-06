import type { LLMProvider } from '@/shared/types/app.js';

/**
 * Contract for provider-specific session indexing logic.
 */
export interface ISessionIndexer {
  readonly provider: LLMProvider;

  /**
   * Scans provider session artifacts and upserts discovered sessions into DB.
   */
  synchronize(lastScanAt: Date | null): Promise<number>;
}

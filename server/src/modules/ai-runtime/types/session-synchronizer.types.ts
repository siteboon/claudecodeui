/**
 * Contract for provider-specific session indexing logic.
 */
export interface IProviderSessionSynchronizerRuntime {
  /**
   * Scans provider session artifacts and upserts discovered sessions into DB.
   */
  synchronize(since?: Date): Promise<number>;

  /**
   * Parses and upserts one provider artifact file without running a full directory scan.
   */
  synchronizeFile(filePath: string): Promise<boolean>;
}

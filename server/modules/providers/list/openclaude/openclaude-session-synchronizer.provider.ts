import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

// OCC session synchronization will be implemented in Phase 7 (session unification).
// For now, stub the interface so the provider is structurally complete.
export class OpenClaudeSessionSynchronizer implements IProviderSessionSynchronizer {
  async synchronize(_since?: Date): Promise<number> {
    return 0;
  }

  async synchronizeFile(_filePath: string): Promise<string | null> {
    return null;
  }
}

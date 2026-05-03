import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

export class OpenClaudeSessionSynchronizer implements IProviderSessionSynchronizer {
  async synchronize(): Promise<number> {
    return 0;
  }

  async synchronizeFile(): Promise<string | null> {
    return null;
  }
}

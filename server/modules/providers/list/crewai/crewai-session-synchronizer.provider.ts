import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

export class CrewAISessionSynchronizer implements IProviderSessionSynchronizer {
  async synchronize(_since?: Date): Promise<number> {
    return 0;
  }

  async synchronizeFile(_filePath: string): Promise<string | null> {
    return null;
  }
}

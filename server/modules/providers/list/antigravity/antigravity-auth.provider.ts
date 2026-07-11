import crossSpawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { buildProviderCliEnv } from '@/shared/utils.js';

const spawnFunction = crossSpawn;

export class AntigravityProviderAuth implements IProviderAuth {
  private checkInstalled(): boolean {
    try {
      const result = spawnFunction.sync('agy', ['--version'], {
        env: buildProviderCliEnv(),
        stdio: 'ignore',
        timeout: 5000,
      });
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    if (!installed) {
      return {
        installed: false,
        provider: 'antigravity',
        authenticated: false,
        email: null,
        method: null,
        error: 'Antigravity CLI is not installed',
      };
    }

    const modelsResult = spawnFunction.sync('agy', ['models'], {
      encoding: 'utf8',
      env: buildProviderCliEnv(),
      timeout: 10_000,
    });
    const authenticated = !modelsResult.error && modelsResult.status === 0;

    return {
      installed,
      provider: 'antigravity',
      authenticated,
      email: authenticated ? 'Authenticated' : null,
      method: authenticated ? 'agy' : null,
      error: authenticated ? undefined : 'Antigravity CLI is not authenticated',
    };
  }
}

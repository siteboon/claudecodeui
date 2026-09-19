import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { runProviderCliCommand } from '@/shared/utils.js';

/** Antigravity installation and authentication probe used by provider routes. */
export class AntigravityProviderAuth implements IProviderAuth {
  /** Checks whether the AGY executable can be invoked without blocking Node.js. */
  private async checkInstalled(): Promise<boolean> {
    const result = await runProviderCliCommand('agy', ['--version'], { timeoutMs: 5_000 });
    return !result.error && result.exitCode === 0;
  }

  /** Reports installation and login state through lightweight AGY probes. */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = await this.checkInstalled();
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

    const modelsResult = await runProviderCliCommand('agy', ['models'], { timeoutMs: 10_000 });
    const authenticated = !modelsResult.error && modelsResult.exitCode === 0;

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

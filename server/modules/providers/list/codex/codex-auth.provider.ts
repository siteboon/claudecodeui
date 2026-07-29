import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

import { resolveCodexCredentials } from './codex-credentials.js';

export class CodexProviderAuth implements IProviderAuth {
  /**
   * Checks whether Codex is available to the server runtime.
   */
  private checkInstalled(): boolean {
    try {
      spawn.sync('codex', ['--version'], { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns Codex SDK availability and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    const credentials = await resolveCodexCredentials();

    return {
      installed,
      provider: 'codex',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }
}

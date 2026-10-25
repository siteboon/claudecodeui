import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

/**
 * Workbench: login state is owned by the official `codex` CLI. This provider
 * never reads auth files or tokens; it only checks that the binary runs.
 */
export class CodexProviderAuth implements IProviderAuth {
  private checkInstalled(): boolean {
    try {
      const result = spawn.sync('codex', ['--version'], { stdio: 'ignore', timeout: 5000 });
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();

    if (!installed) {
      return {
        installed,
        provider: 'codex',
        authenticated: false,
        email: null,
        method: null,
        error: 'Codex CLI is not installed',
      };
    }

    return {
      installed,
      provider: 'codex',
      authenticated: true,
      email: 'Managed by Codex CLI',
      method: 'cli',
    };
  }
}

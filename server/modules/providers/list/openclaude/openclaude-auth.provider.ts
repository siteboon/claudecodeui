import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

export class OpenClaudeProviderAuth implements IProviderAuth {
  private checkInstalled(): boolean {
    const occPath = process.env.OCC_PATH || 'occ';
    try {
      spawn.sync(occPath, ['--version'], { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();

    return {
      installed,
      provider: 'openclaude',
      authenticated: installed,
      email: null,
      method: installed ? 'cli' : null,
      error: installed ? undefined : 'OpenClaude CLI (occ) is not installed or not in PATH',
    };
  }
}

import { execSync } from 'node:child_process';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

export class OpenClaudeProviderAuth implements IProviderAuth {
  async getStatus(): Promise<ProviderAuthStatus> {
    let installed = false;
    try {
      execSync('openclaude --version', { stdio: 'pipe', timeout: 5000 });
      installed = true;
    } catch {
      // binary not found or timed out
    }

    return {
      installed,
      provider: 'openclaude',
      authenticated: installed,
      email: installed ? 'OpenClaude CLI' : null,
      method: installed ? 'cli' : null,
      error: installed ? undefined : 'openclaude CLI is not installed or not on PATH',
    };
  }
}

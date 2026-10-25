import spawn from 'cross-spawn';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

/**
 * Workbench: login state is owned by the official `claude` CLI. This provider
 * never reads credential files, settings env blocks or tokens; it only checks
 * that the binary runs. Users sign in from the terminal tab (`claude /login`).
 */
export class ClaudeProviderAuth implements IProviderAuth {
  private checkInstalled(): boolean {
    const cliPath = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH) ?? 'claude';
    try {
      const result = spawn.sync(cliPath, ['--version'], { stdio: 'ignore', timeout: 5000 });
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
        provider: 'claude',
        authenticated: false,
        email: null,
        method: null,
        error: 'Claude Code CLI is not installed',
      };
    }

    // Login state is managed by the CLI itself and intentionally not inspected.
    return {
      installed,
      provider: 'claude',
      authenticated: true,
      email: 'Managed by Claude CLI',
      method: 'cli',
    };
  }
}

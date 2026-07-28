import spawn from 'cross-spawn';

import {
  readMiniMaxSettingsEnvironment,
  resolveMiniMaxCredential,
} from '@/modules/providers/list/minimax/minimax-config.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

export class MiniMaxProviderAuth implements IProviderAuth {
  private checkInstalled(): boolean {
    const cliPath = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
    try {
      spawn.sync(cliPath, ['--version'], { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    if (!installed) {
      return {
        installed,
        provider: 'minimax',
        authenticated: false,
        email: null,
        method: null,
        error: 'The compatible coding CLI is not installed',
      };
    }

    const settingsEnvironment = await readMiniMaxSettingsEnvironment();
    const credential = resolveMiniMaxCredential(process.env, settingsEnvironment);
    return {
      installed,
      provider: 'minimax',
      authenticated: Boolean(credential),
      email: credential ? 'API Key Auth' : null,
      method: credential ? 'api_key' : null,
      error: credential
        ? undefined
        : 'Configure MINIMAX_API_KEY or a MiniMax endpoint and token in the coding CLI settings.',
    };
  }
}

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { CliVersionProbe, ProviderAuthStatus } from '@/shared/types.js';
import { buildProviderCliEnv, parseCliVersion, probeCliVersion, runProviderCliCommand } from '@/shared/utils.js';

/** Antigravity installation and authentication probe used by provider routes. */
export class AntigravityProviderAuth implements IProviderAuth {
  /** Supplies the explicit CLI-version endpoint with the same executable path as AGY chats. */
  checkInstalled(): CliVersionProbe {
    return probeCliVersion('agy', ['--version'], { env: buildProviderCliEnv() });
  }

  /** Reports installation and login state through lightweight AGY probes. */
  async getStatus(): Promise<ProviderAuthStatus> {
    // Keep routine auth refresh non-blocking; only the explicit CLI endpoint
    // uses the synchronous checkInstalled contract shared by provider adapters.
    const versionResult = await runProviderCliCommand('agy', ['--version'], { timeoutMs: 5_000 });
    const installed = !versionResult.error && versionResult.exitCode === 0;
    const installedVersion = installed ? parseCliVersion(versionResult.stdout) : null;
    if (!installed) {
      return {
        installed: false,
        provider: 'antigravity',
        installedVersion,
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
      installedVersion,
      authenticated,
      email: authenticated ? 'Authenticated' : null,
      method: authenticated ? 'agy' : null,
      error: authenticated ? undefined : 'Antigravity CLI is not authenticated',
    };
  }
}

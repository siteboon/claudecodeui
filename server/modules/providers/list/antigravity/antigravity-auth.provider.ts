import type { CliVersionProbe, IProviderAuth, ProviderAuthStatus } from '@/shared/index.js';
import { parseCliVersion, resolveConfiguredCliExecutable, runProviderCliCommand } from '@/shared/index.js';

import { parseAntigravityModelRows } from './antigravity-models.provider.js';

const antigravityExecutable = () =>
  resolveConfiguredCliExecutable(process.env.AGY_CLI_PATH, 'agy');

/** Used by AntigravityProvider to report installation and usable account status. */
export class AntigravityProviderAuth implements IProviderAuth {
  /** Used by Providers' auth and CLI-version services to probe the configured AGY binary. */
  async checkInstalled(): Promise<CliVersionProbe> {
    const result = await runProviderCliCommand(antigravityExecutable(), ['--version'], { timeoutMs: 5000 });
    return {
      installed: !result.error || (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT',
      exitCode: result.exitCode,
      version: result.exitCode === 0 ? parseCliVersion(result.stdout) : null,
    };
  }

  /** Reports installation and login state through lightweight AGY probes. */
  async getStatus(): Promise<ProviderAuthStatus> {
    const versionResult = await runProviderCliCommand(antigravityExecutable(), ['--version'], { timeoutMs: 5000 });
    const installed = !versionResult.error || (versionResult.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
    const installedVersion = versionResult.exitCode === 0 ? parseCliVersion(versionResult.stdout) : null;
    if (!installed) {
      return {
        installed: false,
        provider: 'antigravity',
        installedVersion,
        authenticated: false,
        email: null,
        method: null,
        error: (versionResult.error as NodeJS.ErrnoException)?.code === 'EACCES'
          ? 'Cannot execute Antigravity CLI. Check AGY_CLI_PATH and the executable permissions.'
          : 'Antigravity CLI is not installed',
      };
    }

    const modelsResult = await runProviderCliCommand(antigravityExecutable(), ['models'], {
      timeoutMs: 20_000,
    });
    const eligibilityFailure = /account ineligible|not eligible for antigravity|eligibility check failed/i.test(
      `${modelsResult.stdout ?? ''}\n${modelsResult.stderr ?? ''}`,
    );
    const authenticated = !modelsResult.error
      && modelsResult.exitCode === 0
      && parseAntigravityModelRows(modelsResult.stdout ?? '').length > 0
      && !eligibilityFailure;

    return {
      installed,
      provider: 'antigravity',
      installedVersion,
      authenticated,
      email: null,
      method: authenticated ? 'agy' : null,
      error: authenticated
        ? undefined
        : eligibilityFailure
          ? 'Antigravity account is not eligible. Verify the account in Antigravity and retry.'
          : modelsResult.error
            ? `Antigravity model probe failed: ${(modelsResult.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'timed out; retry the status check' : modelsResult.error.message}`
            : 'Antigravity CLI is not authenticated',
    };
  }
}

import type { CliVersionProbe, IProviderAuth, ProviderAuthStatus } from '@/shared/index.js';
import { buildProviderCliEnv, probeCliVersion, resolveConfiguredCliExecutable, runProviderCliCommand } from '@/shared/index.js';

const antigravityExecutable = () =>
  resolveConfiguredCliExecutable(process.env.AGY_CLI_PATH, 'agy');

/** Used by AntigravityProvider to report installation and usable account status. */
export class AntigravityProviderAuth implements IProviderAuth {
  /** Used by Providers' auth and CLI-version services to probe the configured AGY binary. */
  checkInstalled(): CliVersionProbe {
    return probeCliVersion(antigravityExecutable(), ['--version'], buildProviderCliEnv());
  }

  /** Reports installation and login state through lightweight AGY probes. */
  async getStatus(): Promise<ProviderAuthStatus> {
    const { installed, version: installedVersion } = this.checkInstalled();
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

    const modelsResult = await runProviderCliCommand(antigravityExecutable(), ['models'], {
      timeoutMs: 10_000,
    });
    const eligibilityFailure = /account ineligible|not eligible for antigravity|eligibility check failed/i.test(
      `${modelsResult.stdout ?? ''}\n${modelsResult.stderr ?? ''}`,
    );
    const authenticated = !modelsResult.error
      && modelsResult.exitCode === 0
      && Boolean(modelsResult.stdout?.trim())
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
          : 'Antigravity CLI is not authenticated',
    };
  }
}

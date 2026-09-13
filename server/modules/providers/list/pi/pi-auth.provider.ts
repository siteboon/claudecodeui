import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

type PiCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
};

/**
 * Providers the curated pi model catalog can address. The credential probe
 * asks pi itself about exactly these, so `authenticated` means "pi can run at
 * least one model the UI offers".
 */
const PI_CHECKED_PROVIDERS = ['anthropic', 'zai-coding-cn', 'openai'] as const;

/** Shape of one `pi auth check --json` result (pi 0.85.1). */
type PiAuthCheckResult = {
  status?: unknown;
  authType?: unknown;
};

export class PiProviderAuth implements IProviderAuth {
  /**
   * Checks whether the pi CLI is available to the server process.
   */
  private checkInstalled(): boolean {
    try {
      const result = spawn.sync('pi', ['--version'], { stdio: 'ignore', timeout: 5000 });
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Returns pi CLI installation and credential status.
   *
   * Unauthenticated is pi's normal first-run state rather than a failure, so no
   * error string is reported for it.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'pi',
      authenticated: credentials.authenticated,
      // pi has no account identity: credentials are a local auth store or an
      // API key, so there is never an email to show.
      email: credentials.email,
      method: credentials.method,
    };
  }

  /**
   * Probes pi's credentials through its own `auth check` contract.
   *
   * pi 0.85.1 resolves typed provider entries through its credential store
   * (including env API keys), so an empty or malformed `auth.json` no longer
   * implies usable credentials — only pi's own resolver can answer that.
   * Refresh behavior is left at pi's default (the same thing a real run does
   * for expired OAuth tokens). The first ready provider wins.
   */
  private checkCredentials(): PiCredentialsStatus {
    for (const provider of PI_CHECKED_PROVIDERS) {
      let result: ReturnType<typeof spawn.sync>;
      try {
        result = spawn.sync(
          'pi',
          ['auth', 'check', '--provider', provider, '--json'],
          { stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000, encoding: 'utf8' },
        );
      } catch {
        continue;
      }

      if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
        continue;
      }

      let parsed: PiAuthCheckResult;
      try {
        parsed = JSON.parse(result.stdout) as PiAuthCheckResult;
      } catch {
        continue;
      }

      if (parsed.status !== 'ready') {
        continue;
      }

      const method = typeof parsed.authType === 'string' && parsed.authType.length > 0
        ? parsed.authType
        : null;
      return { authenticated: true, email: null, method };
    }

    return { authenticated: false, email: null, method: null };
  }
}

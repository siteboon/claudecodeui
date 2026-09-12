import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

type PiCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
};

/** Provider API keys pi reads straight from the environment. */
const PI_ENV_CREDENTIAL_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'ZAI_CODING_CN_API_KEY',
];

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
   * Probes pi's credentials: its own auth store first, then the environment.
   */
  private async checkCredentials(): Promise<PiCredentialsStatus> {
    try {
      const authPath = path.join(os.homedir(), '.pi', 'agent', 'auth.json');
      await access(authPath);
      return { authenticated: true, email: null, method: 'oauth' };
    } catch {
      // No auth store — fall through to the environment keys.
    }

    const envCredential = PI_ENV_CREDENTIAL_KEYS.find((key) => process.env[key]?.trim());
    if (envCredential) {
      return { authenticated: true, email: null, method: 'env' };
    }

    return { authenticated: false, email: null, method: null };
  }
}

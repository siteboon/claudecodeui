import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { OpenCodeProviderModels } from '@/modules/providers/list/opencode/opencode-models.provider.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { CliVersionProbe, ProviderAuthStatus } from '@/shared/types.js';
import { probeCliVersion, readObjectRecord, readOptionalString } from '@/shared/utils.js';

type OpenCodeCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

const OPENCODE_ENV_CREDENTIAL_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
];

export class OpenCodeProviderAuth implements IProviderAuth {
  /**
   * `models` is the OpenCode model picker: a login OpenCode 2.x keeps in its
   * database counts only for a provider the picker offers models of (see
   * `OpenCodeProviderModels.readModelLoginProviderIds`). The OpenCode provider
   * passes its own picker, so both read one listing.
   */
  constructor(private readonly models: OpenCodeProviderModels = new OpenCodeProviderModels()) {}

  /**
   * Checks whether the OpenCode CLI is available to the server process, and
   * which version it is. Unlike the other CLIs it has always needed a clean
   * `--version` exit to count as installed.
   */
  checkInstalled(): CliVersionProbe {
    const probe = probeCliVersion('opencode');
    return { ...probe, installed: probe.exitCode === 0 };
  }

  /**
   * Returns OpenCode CLI installation and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const { installed, version: installedVersion } = this.checkInstalled();
    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'opencode',
      installedVersion,
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * Reads OpenCode's auth store (`auth.json`, and the logins OpenCode 2.x keeps
   * in its database) or falls back to provider API key environment variables.
   */
  private async checkCredentials(): Promise<OpenCodeCredentialsStatus> {
    let authFileFailure: OpenCodeCredentialsStatus | null = null;
    try {
      const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
      const content = await readFile(authPath, 'utf8');
      const auth = readObjectRecord(JSON.parse(content)) ?? {};

      for (const [providerId, providerAuth] of Object.entries(auth)) {
        const providerRecord = readObjectRecord(providerAuth);
        if (!providerRecord) {
          continue;
        }

        const hasCredential = Object.values(providerRecord).some(
          (value) => readOptionalString(value) !== undefined || Boolean(readObjectRecord(value)),
        );
        if (hasCredential) {
          return {
            authenticated: true,
            email: `${providerId} credentials`,
            method: 'credentials_file',
          };
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        authFileFailure = {
          authenticated: false,
          email: null,
          method: null,
          error: error instanceof Error ? error.message : 'Failed to read OpenCode auth',
        };
      }
    }

    // OpenCode 2.x keeps its logins in its database, and reads `auth.json` only once.
    const [databaseProviderId] = await this.models.readModelLoginProviderIds();
    if (databaseProviderId) {
      return {
        authenticated: true,
        email: `${databaseProviderId} credentials`,
        method: 'credentials_db',
      };
    }
    if (authFileFailure) {
      return authFileFailure;
    }

    const envCredential = OPENCODE_ENV_CREDENTIAL_KEYS.find((key) => process.env[key]?.trim());
    if (envCredential) {
      return {
        authenticated: true,
        email: envCredential,
        method: 'environment',
      };
    }

    return {
      authenticated: false,
      email: null,
      method: null,
      error: 'OpenCode not configured',
    };
  }
}

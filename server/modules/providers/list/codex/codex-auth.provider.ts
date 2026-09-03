import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createCliInstallationProbe } from '@/modules/providers/shared/installation/cli-installation-probe.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus, ProviderQuotaData } from '@/shared/types.js';
import { extractEmailFromJwt, readObjectRecord, readOptionalString } from '@/shared/utils.js';

import { fetchCodexQuota } from './codex-quota.provider.js';

type CodexCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

const installationProbe = createCliInstallationProbe({ command: () => 'codex' });

export class CodexProviderAuth implements IProviderAuth {
  /**
   * Checks whether Codex is available to the server runtime.
   */
  private checkInstalled(): Promise<boolean> {
    return installationProbe.isInstalled();
  }

  /**
   * Returns Codex SDK availability and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = await this.checkInstalled();
    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'codex',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * Reads account-level rolling limits through the Codex app-server protocol.
   * Consumer: the provider token-usage service (GET /providers/quota).
   */
  async getQuota(options?: { forceRefresh?: boolean }): Promise<ProviderQuotaData | null> {
    return fetchCodexQuota(options);
  }

  /**
   * Reads Codex auth.json and checks OAuth tokens or an API key fallback.
   */
  private async checkCredentials(): Promise<CodexCredentialsStatus> {
    try {
      const authPath = path.join(os.homedir(), '.codex', 'auth.json');
      const content = await readFile(authPath, 'utf8');
      const auth = readObjectRecord(JSON.parse(content)) ?? {};
      const tokens = readObjectRecord(auth.tokens) ?? {};
      const idToken = readOptionalString(tokens.id_token);
      const accessToken = readOptionalString(tokens.access_token);

      if (idToken || accessToken) {
        return {
          authenticated: true,
          email: idToken ? this.readEmailFromIdToken(idToken) : 'Authenticated',
          method: 'credentials_file',
        };
      }

      if (readOptionalString(auth.OPENAI_API_KEY)) {
        return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
      }

      return { authenticated: false, email: null, method: null, error: 'No valid tokens found' };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {
        authenticated: false,
        email: null,
        method: null,
        error: code === 'ENOENT' ? 'Codex not configured' : error instanceof Error ? error.message : 'Failed to read Codex auth',
      };
    }
  }

  /**
   * Extracts the user email from a Codex id_token when a readable JWT payload exists.
   */
  private readEmailFromIdToken(idToken: string): string {
    return extractEmailFromJwt(idToken) ?? 'Authenticated';
  }
}

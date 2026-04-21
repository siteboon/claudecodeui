import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

type GeminiCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

export class GeminiProviderAuth implements IProviderAuth {
  /**
   * Checks whether the Gemini CLI is available on this host.
   */
  private checkInstalled(): boolean {
    const cliPath = process.env.GEMINI_PATH || 'gemini';
    try {
      spawn.sync(cliPath, ['--version'], { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns Gemini CLI installation and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();

    if (!installed) {
      return {
        installed,
        provider: 'gemini',
        authenticated: false,
        email: null,
        method: null,
        error: 'Gemini CLI is not installed',
      };
    }

    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'gemini',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * Checks Gemini credentials from API key env vars or local OAuth credential files.
   */
  private async checkCredentials(): Promise<GeminiCredentialsStatus> {
    if (process.env.GEMINI_API_KEY?.trim()) {
      return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
    }

    try {
      const credsPath = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
      const content = await readFile(credsPath, 'utf8');
      const creds = readObjectRecord(JSON.parse(content)) ?? {};
      const accessToken = readOptionalString(creds.access_token);

      if (!accessToken) {
        return {
          authenticated: false,
          email: null,
          method: null,
          error: 'No valid tokens found in oauth_creds',
        };
      }

      const refreshToken = readOptionalString(creds.refresh_token);
      const tokenInfo = await this.getTokenInfoEmail(accessToken);
      if (tokenInfo.valid) {
        return {
          authenticated: true,
          email: tokenInfo.email || 'OAuth Session',
          method: 'credentials_file',
        };
      }

      if (!refreshToken) {
        return {
          authenticated: false,
          email: null,
          method: 'credentials_file',
          error: 'Access token invalid and no refresh token found',
        };
      }

      return {
        authenticated: true,
        email: await this.getActiveAccountEmail() || 'OAuth Session',
        method: 'credentials_file',
      };
    } catch {
      return {
        authenticated: false,
        email: null,
        method: null,
        error: 'Gemini CLI not configured',
      };
    }
  }

  /**
   * Validates a Gemini OAuth access token and returns an email when Google reports one.
   */
  private async getTokenInfoEmail(accessToken: string): Promise<{ valid: boolean; email: string | null }> {
    try {
      const tokenRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`);
      if (!tokenRes.ok) {
        return { valid: false, email: null };
      }

      const tokenInfo = readObjectRecord(await tokenRes.json());
      return {
        valid: true,
        email: readOptionalString(tokenInfo?.email) ?? null,
      };
    } catch {
      return { valid: false, email: null };
    }
  }

  /**
   * Reads Gemini's active local Google account as an offline fallback for display.
   */
  private async getActiveAccountEmail(): Promise<string | null> {
    try {
      const accPath = path.join(os.homedir(), '.gemini', 'google_accounts.json');
      const accContent = await readFile(accPath, 'utf8');
      const accounts = readObjectRecord(JSON.parse(accContent));
      return readOptionalString(accounts?.active) ?? null;
    } catch {
      return null;
    }
  }
}

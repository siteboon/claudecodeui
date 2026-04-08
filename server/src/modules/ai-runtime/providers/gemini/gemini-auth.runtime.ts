import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import type { IProviderAuthRuntime, ProviderAuthStatus } from '@/modules/ai-runtime/types/index.js';

type GeminiOauthCreds = {
  access_token?: string;
  refresh_token?: string;
};

/**
 * Reads auth status from env and Gemini OAuth files.
 */
export class GeminiAuthRuntime implements IProviderAuthRuntime {
  async getStatus(): Promise<ProviderAuthStatus> {
    if (process.env.GEMINI_API_KEY?.trim()) {
      return {
        provider: 'gemini',
        authenticated: true,
        email: 'API Key Auth',
        method: 'api_key',
      };
    }

    try {
      const credsPath = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
      const content = await readFile(credsPath, 'utf8');
      const creds = JSON.parse(content) as GeminiOauthCreds;
      if (!creds.access_token) {
        return {
          provider: 'gemini',
          authenticated: false,
          email: null,
          method: null,
          error: 'No valid tokens found in oauth_creds',
        };
      }

      const validated = await this.resolveEmailFromAccessToken(creds.access_token);
      if (validated.email) {
        return {
          provider: 'gemini',
          authenticated: true,
          email: validated.email,
          method: 'oauth',
        };
      }

      if (!validated.tokenValid && !creds.refresh_token) {
        return {
          provider: 'gemini',
          authenticated: false,
          email: null,
          method: null,
          error: 'Access token invalid and no refresh token found',
        };
      }

      const fallbackEmail = await this.readActiveGoogleAccountEmail();
      return {
        provider: 'gemini',
        authenticated: true,
        email: fallbackEmail ?? 'OAuth Session',
        method: 'oauth',
      };
    } catch {
      return {
        provider: 'gemini',
        authenticated: false,
        email: null,
        method: null,
        error: 'Gemini CLI not configured',
      };
    }
  }

  /**
   * Validates token and extracts email via Google's tokeninfo endpoint.
   */
  private async resolveEmailFromAccessToken(
    accessToken: string,
  ): Promise<{ tokenValid: boolean; email: string | null }> {
    try {
      const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`);
      if (!response.ok) {
        return { tokenValid: false, email: null };
      }

      const tokenInfo = await response.json() as { email?: string };
      return {
        tokenValid: true,
        email: tokenInfo.email ?? null,
      };
    } catch {
      return { tokenValid: false, email: null };
    }
  }

  /**
   * Reads active Google account email from ~/.gemini/google_accounts.json.
   */
  private async readActiveGoogleAccountEmail(): Promise<string | null> {
    try {
      const accountsPath = path.join(os.homedir(), '.gemini', 'google_accounts.json');
      const content = await readFile(accountsPath, 'utf8');
      const accounts = JSON.parse(content) as { active?: string };
      return typeof accounts.active === 'string' && accounts.active.trim()
        ? accounts.active
        : null;
    } catch {
      return null;
    }
  }
}

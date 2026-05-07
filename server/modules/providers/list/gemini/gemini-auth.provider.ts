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

type GeminiAuthType =
  | 'oauth-personal'
  | 'gemini-api-key'
  | 'vertex-ai'
  | 'compute-default-credentials'
  | 'gateway'
  | 'cloud-shell'
  | null;

export class GeminiProviderAuth implements IProviderAuth {
  /**
   * Gemini CLI can override its home root via GEMINI_CLI_HOME.
   * Use the same resolution so status checks match runtime behavior.
   */
  private getGeminiCliHome(): string {
    return process.env.GEMINI_CLI_HOME?.trim() || os.homedir();
  }

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
   * Parses dotenv-style key/value pairs.
   */
  private parseEnvFile(content: string): Record<string, string> {
    const parsed: Record<string, string> = {};

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const normalizedLine = line.startsWith('export ')
        ? line.slice('export '.length).trim()
        : line;
      const separatorIndex = normalizedLine.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const key = normalizedLine.slice(0, separatorIndex).trim();
      if (!key) {
        continue;
      }

      let value = normalizedLine.slice(separatorIndex + 1).trim();
      const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''));
      if (quoted) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, '').trim();
      }

      parsed[key] = value;
    }

    return parsed;
  }

  /**
   * Loads user-level auth env in Gemini's "first file found" order.
   */
  private async loadUserLevelAuthEnv(): Promise<Record<string, string>> {
    const geminiCliHome = this.getGeminiCliHome();
    const envCandidates = [
      path.join(geminiCliHome, '.gemini', '.env'),
      path.join(geminiCliHome, '.env'),
    ];

    for (const envPath of envCandidates) {
      try {
        const content = await readFile(envPath, 'utf8');
        return this.parseEnvFile(content);
      } catch {
        // Continue to the next fallback.
      }
    }

    return {};
  }

  /**
   * Reads Gemini's selected auth type from settings.json when available.
   */
  private async readSelectedAuthType(): Promise<GeminiAuthType> {
    try {
      const settingsPath = path.join(this.getGeminiCliHome(), '.gemini', 'settings.json');
      const content = await readFile(settingsPath, 'utf8');
      const settings = readObjectRecord(JSON.parse(content));
      const security = readObjectRecord(settings?.security);
      const auth = readObjectRecord(security?.auth);
      const selectedType = readOptionalString(auth?.selectedType);
      if (!selectedType) {
        return null;
      }

      return selectedType as GeminiAuthType;
    } catch {
      return null;
    }
  }

  /**
   * Checks Gemini credentials from API key env vars or local OAuth credential files.
   */
  private async checkCredentials(): Promise<GeminiCredentialsStatus> {
    if (process.env.GEMINI_API_KEY?.trim()) {
      return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
    }

    const userEnv = await this.loadUserLevelAuthEnv();
    if (readOptionalString(userEnv.GEMINI_API_KEY)) {
      return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
    }

    const selectedType = await this.readSelectedAuthType();
    if (selectedType === 'vertex-ai') {
      const hasGoogleApiKey = Boolean(
        process.env.GOOGLE_API_KEY?.trim()
        || readOptionalString(userEnv.GOOGLE_API_KEY)
      );
      const hasProject = Boolean(
        process.env.GOOGLE_CLOUD_PROJECT?.trim()
        || process.env.GOOGLE_CLOUD_PROJECT_ID?.trim()
        || readOptionalString(userEnv.GOOGLE_CLOUD_PROJECT)
        || readOptionalString(userEnv.GOOGLE_CLOUD_PROJECT_ID)
      );
      const hasLocation = Boolean(
        process.env.GOOGLE_CLOUD_LOCATION?.trim()
        || readOptionalString(userEnv.GOOGLE_CLOUD_LOCATION)
      );
      const hasServiceAccount = Boolean(
        process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
        || readOptionalString(userEnv.GOOGLE_APPLICATION_CREDENTIALS)
      );

      if (hasGoogleApiKey || hasServiceAccount || (hasProject && hasLocation)) {
        return { authenticated: true, email: 'Vertex AI Auth', method: 'vertex_ai' };
      }

      return {
        authenticated: false,
        email: null,
        method: 'vertex_ai',
        error: 'Gemini is set to Vertex AI, but required env vars are missing',
      };
    }

    try {
      const credsPath = path.join(this.getGeminiCliHome(), '.gemini', 'oauth_creds.json');
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
      if (selectedType === 'gemini-api-key') {
        return {
          authenticated: false,
          email: null,
          method: 'api_key',
          error: 'Gemini is set to "Use Gemini API key", but GEMINI_API_KEY is unavailable',
        };
      }

      if (selectedType === 'oauth-personal') {
        return {
          authenticated: false,
          email: null,
          method: 'credentials_file',
          error: 'Gemini is set to Google sign-in, but no cached OAuth credentials were found',
        };
      }

      // If no explicit auth type was selected, surface the generic "not configured" error.
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
      const accPath = path.join(this.getGeminiCliHome(), '.gemini', 'google_accounts.json');
      const accContent = await readFile(accPath, 'utf8');
      const accounts = readObjectRecord(JSON.parse(accContent));
      return readOptionalString(accounts?.active) ?? null;
    } catch {
      return null;
    }
  }
}

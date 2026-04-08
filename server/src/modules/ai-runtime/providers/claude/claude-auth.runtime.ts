import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import type { IProviderAuthRuntime, ProviderAuthStatus } from '@/modules/ai-runtime/types/index.js';

type ClaudeCredentialsFile = {
  email?: string;
  user?: string;
  claudeAiOauth?: {
    accessToken?: string;
    expiresAt?: number | string;
  };
};

/**
 * Reads auth status for Claude from env/settings and OAuth credentials.
 */
export class ClaudeAuthRuntime implements IProviderAuthRuntime {
  async getStatus(): Promise<ProviderAuthStatus> {
    try {
      if (process.env.ANTHROPIC_API_KEY?.trim()) {
        return {
          provider: 'claude',
          authenticated: true,
          email: 'API Key Auth',
          method: 'api_key',
        };
      }

      const settingsEnv = await this.loadClaudeSettingsEnv();
      if (settingsEnv.ANTHROPIC_API_KEY?.trim()) {
        return {
          provider: 'claude',
          authenticated: true,
          email: 'API Key Auth',
          method: 'api_key',
        };
      }

      if (settingsEnv.ANTHROPIC_AUTH_TOKEN?.trim()) {
        return {
          provider: 'claude',
          authenticated: true,
          email: 'Configured via settings.json',
          method: 'api_key',
        };
      }

      const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');
      const content = await readFile(credentialsPath, 'utf8');
      const credentials = JSON.parse(content) as ClaudeCredentialsFile;
      const oauth = credentials.claudeAiOauth;
      const accessToken = oauth?.accessToken;

      if (accessToken && !this.isExpired(oauth?.expiresAt)) {
        return {
          provider: 'claude',
          authenticated: true,
          email: credentials.email ?? credentials.user ?? null,
          method: 'credentials_file',
        };
      }

      return {
        provider: 'claude',
        authenticated: false,
        email: null,
        method: null,
        error: 'Not authenticated',
      };
    } catch {
      return {
        provider: 'claude',
        authenticated: false,
        email: null,
        method: null,
        error: 'Not authenticated',
      };
    }
  }

  /**
   * Reads optional env values from ~/.claude/settings.json.
   */
  private async loadClaudeSettingsEnv(): Promise<Record<string, string>> {
    try {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      const content = await readFile(settingsPath, 'utf8');
      const settings = JSON.parse(content) as { env?: unknown };
      if (!settings.env || typeof settings.env !== 'object') {
        return {};
      }

      return Object.fromEntries(
        Object.entries(settings.env as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );
    } catch {
      return {};
    }
  }

  /**
   * Returns true when an OAuth expiration timestamp is in the past.
   */
  private isExpired(expiresAt: number | string | undefined): boolean {
    if (expiresAt === undefined) {
      return false;
    }

    if (typeof expiresAt === 'number') {
      return Date.now() >= expiresAt;
    }

    const numeric = Number.parseInt(expiresAt, 10);
    return Number.isFinite(numeric) ? Date.now() >= numeric : false;
  }
}

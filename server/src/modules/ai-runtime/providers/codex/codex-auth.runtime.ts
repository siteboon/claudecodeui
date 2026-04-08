import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import type { IProviderAuthRuntime, ProviderAuthStatus } from '@/modules/ai-runtime/types/index.js';

type CodexAuthFile = {
  OPENAI_API_KEY?: string;
  tokens?: {
    id_token?: string;
    access_token?: string;
  };
};

/**
 * Reads auth status from ~/.codex/auth.json.
 */
export class CodexAuthRuntime implements IProviderAuthRuntime {
  async getStatus(): Promise<ProviderAuthStatus> {
    try {
      const authPath = path.join(os.homedir(), '.codex', 'auth.json');
      const content = await readFile(authPath, 'utf8');
      const auth = JSON.parse(content) as CodexAuthFile;
      const tokens = auth.tokens ?? {};

      if (tokens.id_token || tokens.access_token) {
        return {
          provider: 'codex',
          authenticated: true,
          email: this.extractEmail(tokens.id_token),
          method: 'token_file',
        };
      }

      if (auth.OPENAI_API_KEY?.trim()) {
        return {
          provider: 'codex',
          authenticated: true,
          email: 'API Key Auth',
          method: 'api_key',
        };
      }

      return {
        provider: 'codex',
        authenticated: false,
        email: null,
        method: null,
        error: 'No valid tokens found',
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      return {
        provider: 'codex',
        authenticated: false,
        email: null,
        method: null,
        error: code === 'ENOENT'
          ? 'Codex not configured'
          : (error instanceof Error ? error.message : 'Failed to read Codex auth state'),
      };
    }
  }

  /**
   * Best-effort id_token email extraction from JWT payload.
   */
  private extractEmail(idToken: string | undefined): string {
    if (!idToken) {
      return 'Authenticated';
    }

    try {
      const parts = idToken.split('.');
      if (parts.length < 2) {
        return 'Authenticated';
      }

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
        email?: string;
        user?: string;
      };
      return payload.email ?? payload.user ?? 'Authenticated';
    } catch {
      return 'Authenticated';
    }
  }
}

import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

type KiroCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

const KIRO_BIN = process.env.KIRO_PATH ?? 'kiro-cli';

export class KiroProviderAuth implements IProviderAuth {
  /**
   * Checks whether the Kiro CLI is installed and on PATH.
   */
  private checkInstalled(): boolean {
    try {
      const result = spawn.sync(KIRO_BIN, ['--version'], { stdio: 'ignore', timeout: 5000 });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Returns Kiro CLI installation and IdC/BuilderId login status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();

    if (!installed) {
      return {
        installed,
        provider: 'kiro',
        authenticated: false,
        email: null,
        method: null,
        error: 'Kiro CLI is not installed',
      };
    }

    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'kiro',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * Reads the Kiro AWS SSO cache token and resolves the user email via whoami.
   *
   * The token JSON has fields {accessToken, refreshToken, expiresAt: ISO8601,
   * authMethod: 'IdC' | 'BuilderId', region}. There is no JWT/email payload, so
   * the email is fetched from `kiro-cli whoami` when a valid token exists.
   */
  private async checkCredentials(): Promise<KiroCredentialsStatus> {
    try {
      const tokenPath = path.join(os.homedir(), '.aws', 'sso', 'cache', 'kiro-auth-token.json');
      const content = await readFile(tokenPath, 'utf8');
      const token = readObjectRecord(JSON.parse(content)) ?? {};
      const expiresAt = readOptionalString(token.expiresAt);
      const authMethod = readOptionalString(token.authMethod) ?? 'sso';

      if (!expiresAt) {
        return { authenticated: false, email: null, method: null, error: 'Token has no expiresAt' };
      }

      const expiryMs = Date.parse(expiresAt);
      if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
        return {
          authenticated: false,
          email: null,
          method: authMethod,
          error: 'OAuth token has expired',
        };
      }

      const email = await this.readEmailFromWhoami();
      return {
        authenticated: true,
        email: email ?? 'Authenticated',
        method: authMethod,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {
        authenticated: false,
        email: null,
        method: null,
        error:
          code === 'ENOENT'
            ? 'Kiro not configured'
            : error instanceof Error
              ? error.message
              : 'Failed to read Kiro auth',
      };
    }
  }

  /**
   * Runs `kiro-cli whoami` to extract the signed-in email.
   *
   * Stdout shape (verified against kiro-cli 2.3.0):
   *   Logged in with IAM Identity Center (https://...)
   *   Email: someone@example.com
   */
  private readEmailFromWhoami(): Promise<string | null> {
    return new Promise((resolve) => {
      let processCompleted = false;
      let childProcess: ReturnType<typeof spawn> | undefined;

      const timeout = setTimeout(() => {
        if (!processCompleted) {
          processCompleted = true;
          childProcess?.kill();
          resolve(null);
        }
      }, 5000);

      try {
        childProcess = spawn(KIRO_BIN, ['whoami']);
      } catch {
        clearTimeout(timeout);
        processCompleted = true;
        resolve(null);
        return;
      }

      let stdout = '';
      childProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      childProcess.on('close', () => {
        if (processCompleted) {
          return;
        }
        processCompleted = true;
        clearTimeout(timeout);
        const match = stdout.match(/Email:\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
        resolve(match?.[1] ?? null);
      });

      childProcess.on('error', () => {
        if (processCompleted) {
          return;
        }
        processCompleted = true;
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }
}

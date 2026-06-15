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
   * Resolves login state from `kiro-cli whoami`, which is the source of truth
   * across CLI versions.
   *
   * `whoami` is authoritative because the on-disk token location is not stable:
   * kiro-cli <= 2.3.0 wrote `~/.aws/sso/cache/kiro-auth-token.json`, but later
   * versions (verified on 2.7.0) write hashed-filename token files instead, so
   * keying auth off that single path reports a logged-in user as expired. The
   * token file is now only a best-effort hint used to enrich the method label
   * and surface an explicit "expired" error; it never overrides whoami.
   */
  private async checkCredentials(): Promise<KiroCredentialsStatus> {
    const whoami = await this.readWhoami();
    const tokenHint = await this.readTokenHint();

    if (whoami.loggedIn) {
      return {
        authenticated: true,
        email: whoami.email ?? 'Authenticated',
        method: whoami.method ?? tokenHint.method ?? 'sso',
      };
    }

    // whoami says not logged in: prefer a precise "expired" error when the
    // stale token file still explains why, otherwise a generic message.
    return {
      authenticated: false,
      email: null,
      method: whoami.method ?? tokenHint.method,
      error: tokenHint.expired ? 'OAuth token has expired' : 'Not authenticated',
    };
  }

  /**
   * Best-effort read of the legacy SSO cache token for method/expiry hints.
   *
   * Returns empty hints when the file is absent (expected on newer CLIs) so a
   * missing file never forces a not-authenticated result on its own.
   */
  private async readTokenHint(): Promise<{ method: string | null; expired: boolean }> {
    try {
      const tokenPath = path.join(os.homedir(), '.aws', 'sso', 'cache', 'kiro-auth-token.json');
      const content = await readFile(tokenPath, 'utf8');
      const token = readObjectRecord(JSON.parse(content)) ?? {};
      const method = readOptionalString(token.authMethod) ?? null;
      const expiresAt = readOptionalString(token.expiresAt);
      const expiryMs = expiresAt ? Date.parse(expiresAt) : NaN;
      const expired = Number.isFinite(expiryMs) ? expiryMs <= Date.now() : false;
      return { method, expired };
    } catch {
      return { method: null, expired: false };
    }
  }

  /**
   * Runs `kiro-cli whoami` and parses login state, email, and auth method.
   *
   * Uses the plain (default) output format for cross-version compatibility
   * (the `--format json` flag does not exist on older CLIs). Stdout shapes:
   *   Logged in with IAM Identity Center (https://...)   -> method 'IdC'
   *   Logged in with Builder ID                          -> method 'BuilderId'
   *   Email: someone@example.com
   *   Not logged in                                      -> loggedIn false
   *
   * `whoami` exits 0 in both states, so login is determined from the text, not
   * the exit code.
   */
  private readWhoami(): Promise<{ loggedIn: boolean; email: string | null; method: string | null }> {
    return new Promise((resolve) => {
      let processCompleted = false;
      let childProcess: ReturnType<typeof spawn> | undefined;

      const finish = (value: { loggedIn: boolean; email: string | null; method: string | null }) => {
        if (processCompleted) {
          return;
        }
        processCompleted = true;
        clearTimeout(timeout);
        resolve(value);
      };

      const timeout = setTimeout(() => {
        childProcess?.kill();
        finish({ loggedIn: false, email: null, method: null });
      }, 5000);

      try {
        childProcess = spawn(KIRO_BIN, ['whoami']);
      } catch {
        finish({ loggedIn: false, email: null, method: null });
        return;
      }

      let stdout = '';
      childProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      childProcess.on('close', () => {
        const emailMatch = stdout.match(/Email:\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
        const loggedIn = /logged in with/i.test(stdout) || emailMatch !== null;
        let method: string | null = null;
        if (/identity center/i.test(stdout)) {
          method = 'IdC';
        } else if (/builder\s*id/i.test(stdout)) {
          method = 'BuilderId';
        } else if (loggedIn) {
          method = 'sso';
        }
        finish({ loggedIn, email: emailMatch?.[1] ?? null, method });
      });

      childProcess.on('error', () => {
        finish({ loggedIn: false, email: null, method: null });
      });
    });
  }
}

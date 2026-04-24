import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus, ProviderUsageSnapshot, UsageWindow } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

type CodexCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

type CodexOAuth = {
  accessToken: string;
  accountId: string | null;
  idToken: string | null;
};

type CodexTokenSource =
  | { kind: 'oauth'; oauth: CodexOAuth }
  | { kind: 'api_key' }
  | { kind: 'none' };

const USAGE_CACHE_TTL_MS = 15 * 60 * 1000;

let usageCache: ProviderUsageSnapshot | null = null;

export class CodexProviderAuth implements IProviderAuth {
  /**
   * Checks whether Codex is available to the server runtime.
   */
  private checkInstalled(): boolean {
    try {
      spawn.sync('codex', ['--version'], { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns Codex SDK availability and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
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
   * Returns a cached or freshly fetched identity + rate-limit snapshot for
   * Codex. Uses the `wham/usage` backend endpoint, which returns everything
   * in one GET — no extra quota consumed beyond the request itself.
   */
  async getUsage(options: { force?: boolean } = {}): Promise<ProviderUsageSnapshot> {
    if (!options.force && usageCache && Date.now() - usageCache.fetchedAt < USAGE_CACHE_TTL_MS) {
      return usageCache;
    }

    const source = await this.readTokenSource();

    if (source.kind === 'none') {
      return this.emptySnapshot({ method: null, error: 'Not authenticated' });
    }

    if (source.kind === 'api_key') {
      return this.emptySnapshot({ method: 'api_key' });
    }

    try {
      const snapshot = await this.fetchUsage(source.oauth);
      usageCache = snapshot;
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch Codex usage';
      if (usageCache) {
        return { ...usageCache, stale: true, error: message };
      }
      // Network/endpoint failure — degrade to id_token-only identity so the
      // footer can still show an email even when the usage endpoint is down.
      const email = source.oauth.idToken ? this.readEmailFromIdToken(source.oauth.idToken) : null;
      return this.emptySnapshot({ method: 'oauth', email, error: message });
    }
  }

  private emptySnapshot(
    overrides: Partial<Omit<ProviderUsageSnapshot, 'provider' | 'fiveHour' | 'sevenDay' | 'fetchedAt'>>,
  ): ProviderUsageSnapshot {
    return {
      provider: 'codex',
      email: null,
      displayName: null,
      planType: null,
      method: null,
      fiveHour: null,
      sevenDay: null,
      fetchedAt: Date.now(),
      ...overrides,
    };
  }

  private async readTokenSource(): Promise<CodexTokenSource> {
    try {
      const authPath = path.join(os.homedir(), '.codex', 'auth.json');
      const content = await readFile(authPath, 'utf8');
      const auth = readObjectRecord(JSON.parse(content)) ?? {};
      const tokens = readObjectRecord(auth.tokens) ?? {};
      const accessToken = readOptionalString(tokens.access_token);
      const accountId = readOptionalString(tokens.account_id);
      const idToken = readOptionalString(tokens.id_token);

      if (accessToken) {
        return { kind: 'oauth', oauth: { accessToken, accountId: accountId ?? null, idToken: idToken ?? null } };
      }

      if (readOptionalString(auth.OPENAI_API_KEY)) {
        return { kind: 'api_key' };
      }

      return { kind: 'none' };
    } catch {
      return { kind: 'none' };
    }
  }

  private async fetchUsage(oauth: CodexOAuth): Promise<ProviderUsageSnapshot> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${oauth.accessToken}`,
    };
    if (oauth.accountId) {
      headers['chatgpt-account-id'] = oauth.accountId;
    }

    const res = await fetch('https://chatgpt.com/backend-api/wham/usage', { headers });
    if (!res.ok) {
      throw new Error(`Codex usage fetch failed: ${res.status}`);
    }

    const body = readObjectRecord(await res.json()) ?? {};
    const rateLimit = readObjectRecord(body.rate_limit);
    const primary = readObjectRecord(rateLimit?.primary_window);
    const secondary = readObjectRecord(rateLimit?.secondary_window);

    const readWindow = (window: Record<string, unknown> | null): UsageWindow => {
      if (!window) return null;
      const usedPercent = Number(window.used_percent);
      const resetAt = Number(window.reset_at);
      if (!Number.isFinite(usedPercent) || !Number.isFinite(resetAt)) return null;
      return { utilization: usedPercent / 100, resetsAt: resetAt };
    };

    const email = readOptionalString(body.email)
      ?? (oauth.idToken ? this.readEmailFromIdToken(oauth.idToken) : null);

    return {
      provider: 'codex',
      email,
      displayName: null,
      planType: readOptionalString(body.plan_type),
      method: 'oauth',
      fiveHour: readWindow(primary),
      sevenDay: readWindow(secondary),
      fetchedAt: Date.now(),
    };
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
    try {
      const parts = idToken.split('.');
      if (parts.length >= 2) {
        const payload = readObjectRecord(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
        return readOptionalString(payload?.email) ?? readOptionalString(payload?.user) ?? 'Authenticated';
      }
    } catch {
      // Fall back to a generic authenticated marker if the token payload is not readable.
    }

    return 'Authenticated';
  }
}

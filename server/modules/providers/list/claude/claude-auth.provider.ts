import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus, ProviderUsageSnapshot, UsageWindow } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

type ClaudeCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

type ClaudeOAuth = {
  accessToken: string;
  expiresAt?: number;
};

type ClaudeTokenSource =
  | { kind: 'oauth'; oauth: ClaudeOAuth; expired: boolean }
  | { kind: 'api_key' }
  | { kind: 'none' };

const USAGE_CACHE_TTL_MS = 15 * 60 * 1000;

let usageCache: ProviderUsageSnapshot | null = null;

export class ClaudeProviderAuth implements IProviderAuth {
  /**
   * Checks whether the Claude Code CLI is available on this host.
   */
  private checkInstalled(): boolean {
      const cliPath = process.env.CLAUDE_CLI_PATH || 'claude';
      try {
        spawn.sync(cliPath, ['--version'], { stdio: 'ignore', timeout: 5000 });
        return true;
      } catch {
        return false;
      }
  }

  /**
   * Returns Claude installation and credential status using Claude Code's auth priority.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();

    if (!installed) {
      return {
        installed,
        provider: 'claude',
        authenticated: false,
        email: null,
        method: null,
        error: 'Claude Code CLI is not installed',
      };
    }

    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'claude',
      authenticated: credentials.authenticated,
      email: credentials.authenticated ? credentials.email || 'Authenticated' : credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * Returns a cached or freshly fetched rate-limit + identity snapshot for the
   * Claude provider. Consumes ~23 Haiku tokens per refresh (one profile GET
   * plus a max_tokens:1 probe against /v1/messages to read rate-limit headers).
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

    if (source.expired) {
      if (usageCache) {
        return { ...usageCache, stale: true };
      }
      return this.emptySnapshot({ method: 'oauth', error: 'OAuth token expired' });
    }

    try {
      const [profile, rateLimit] = await Promise.all([
        this.fetchProfile(source.oauth.accessToken),
        this.probeRateLimits(source.oauth.accessToken),
      ]);

      const snapshot: ProviderUsageSnapshot = {
        provider: 'claude',
        email: profile.email,
        displayName: profile.displayName,
        planType: profile.planType,
        method: 'oauth',
        fiveHour: rateLimit.fiveHour,
        sevenDay: rateLimit.sevenDay,
        fetchedAt: Date.now(),
      };
      usageCache = snapshot;
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch Claude usage';
      if (usageCache) {
        return { ...usageCache, stale: true, error: message };
      }
      return this.emptySnapshot({ method: 'oauth', error: message });
    }
  }

  private emptySnapshot(
    overrides: Partial<Omit<ProviderUsageSnapshot, 'provider' | 'fiveHour' | 'sevenDay' | 'fetchedAt'>>,
  ): ProviderUsageSnapshot {
    return {
      provider: 'claude',
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

  /**
   * Resolves the active Claude auth source using the same priority as Claude Code:
   * env API key → settings.json API key / auth token → OAuth credentials file.
   * The mirrored priority matters because usage bars report whichever pool
   * Claude Code itself is billing against.
   */
  private async readTokenSource(): Promise<ClaudeTokenSource> {
    if (process.env.ANTHROPIC_API_KEY?.trim()) {
      return { kind: 'api_key' };
    }

    const settingsEnv = await this.loadSettingsEnv();
    if (readOptionalString(settingsEnv.ANTHROPIC_API_KEY)) {
      return { kind: 'api_key' };
    }

    if (readOptionalString(settingsEnv.ANTHROPIC_AUTH_TOKEN)) {
      return { kind: 'api_key' };
    }

    const oauth = await this.readOAuth();
    if (oauth) {
      const expired = typeof oauth.expiresAt === 'number' && Date.now() >= oauth.expiresAt;
      return { kind: 'oauth', oauth, expired };
    }

    return { kind: 'none' };
  }

  private async readOAuth(): Promise<ClaudeOAuth | null> {
    try {
      const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
      const content = await readFile(credPath, 'utf8');
      const creds = readObjectRecord(JSON.parse(content)) ?? {};
      const oauth = readObjectRecord(creds.claudeAiOauth);
      const accessToken = readOptionalString(oauth?.accessToken);
      if (!accessToken) return null;
      const expiresAt = typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : undefined;
      return { accessToken, expiresAt };
    } catch {
      return null;
    }
  }

  private async fetchProfile(
    accessToken: string,
  ): Promise<{ email: string | null; displayName: string | null; planType: string | null }> {
    const res = await fetch('https://api.anthropic.com/api/oauth/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Profile fetch failed: ${res.status}`);
    }
    const body = readObjectRecord(await res.json()) ?? {};
    const account = readObjectRecord(body.account);
    const organization = readObjectRecord(body.organization);
    return {
      email: readOptionalString(account?.email),
      displayName: readOptionalString(account?.display_name) ?? readOptionalString(account?.full_name),
      planType:
        readOptionalString(organization?.organization_type)?.replace(/^claude_/, '') ?? null,
    };
  }

  private async probeRateLimits(
    accessToken: string,
  ): Promise<{ fiveHour: UsageWindow; sevenDay: UsageWindow }> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        system: "You are Claude Code, Anthropic's official CLI for Claude.",
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });

    if (!res.ok && res.status !== 200) {
      throw new Error(`Rate-limit probe failed: ${res.status}`);
    }

    const readWindow = (prefix: '5h' | '7d'): UsageWindow => {
      const utilRaw = res.headers.get(`anthropic-ratelimit-unified-${prefix}-utilization`);
      const resetRaw = res.headers.get(`anthropic-ratelimit-unified-${prefix}-reset`);
      if (utilRaw === null || resetRaw === null) return null;
      const utilization = Number(utilRaw);
      const resetsAt = Number(resetRaw);
      if (!Number.isFinite(utilization) || !Number.isFinite(resetsAt)) return null;
      return { utilization, resetsAt };
    };

    return {
      fiveHour: readWindow('5h'),
      sevenDay: readWindow('7d'),
    };
  }

  /**
   * Reads Claude settings env values that the CLI can use even when the server process env is empty.
   */
  private async loadSettingsEnv(): Promise<Record<string, unknown>> {
    try {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      const content = await readFile(settingsPath, 'utf8');
      const settings = readObjectRecord(JSON.parse(content));
      return readObjectRecord(settings?.env) ?? {};
    } catch {
      return {};
    }
  }

  /**
   * Checks Claude credentials in the same priority order used by Claude Code.
   */
  private async checkCredentials(): Promise<ClaudeCredentialsStatus> {
    if (process.env.ANTHROPIC_API_KEY?.trim()) {
      return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
    }

    const settingsEnv = await this.loadSettingsEnv();
    if (readOptionalString(settingsEnv.ANTHROPIC_API_KEY)) {
      return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
    }

    if (readOptionalString(settingsEnv.ANTHROPIC_AUTH_TOKEN)) {
      return { authenticated: true, email: 'Configured via settings.json', method: 'api_key' };
    }

    const oauth = await this.readOAuth();
    if (oauth) {
      const { expiresAt, accessToken } = oauth;
      if (!expiresAt || Date.now() < expiresAt) {
        return {
          authenticated: true,
          email: null,
          method: 'credentials_file',
        };
      }

      return {
        authenticated: false,
        email: null,
        method: 'credentials_file',
        error: 'OAuth token has expired. Please re-authenticate with claude login',
      };
    }

    return { authenticated: false, email: null, method: null };
  }
}

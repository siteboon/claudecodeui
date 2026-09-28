import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus, ProviderAuthSubscriptionOverride } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

type ClaudeCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
  subscriptionOverride?: ProviderAuthSubscriptionOverride;
};

/**
 * An API-key style credential found in the env or settings.json, plus the
 * user-facing label the settings UI has always shown for it. The labels are
 * kept verbatim so existing consumers of `email` see no change.
 */
type ClaudeApiKeyCredential = Pick<ProviderAuthSubscriptionOverride, 'variable' | 'source'> & {
  label: string;
};

const hasErrorCode = (error: unknown, code: string): boolean => (
  error instanceof Error && 'code' in error && error.code === code
);

export class ClaudeProviderAuth implements IProviderAuth {
  /**
   * Checks whether the Claude Code CLI is available on this host.
   */
  private checkInstalled(): boolean {
    // cross-spawn resolves shims and PATHEXT itself, so the bare command is a
    // usable fallback here even where the SDK's raw spawn could not use it.
    const cliPath = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH) ?? 'claude';
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
      ...(credentials.subscriptionOverride ? { subscriptionOverride: credentials.subscriptionOverride } : {}),
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
   * Finds an API-key style credential in the same order Claude Code checks them:
   * process env first (auth token, then API key), then the settings.json env block.
   */
  private findApiKeyCredential(settingsEnv: Record<string, unknown>): ClaudeApiKeyCredential | null {
    if (process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
      return { variable: 'ANTHROPIC_AUTH_TOKEN', source: 'process_env', label: 'Auth Token' };
    }

    if (process.env.ANTHROPIC_API_KEY?.trim()) {
      return { variable: 'ANTHROPIC_API_KEY', source: 'process_env', label: 'API Key Auth' };
    }

    if (readOptionalString(settingsEnv.ANTHROPIC_API_KEY)) {
      return { variable: 'ANTHROPIC_API_KEY', source: 'settings_file', label: 'API Key Auth' };
    }

    if (readOptionalString(settingsEnv.ANTHROPIC_AUTH_TOKEN)) {
      return { variable: 'ANTHROPIC_AUTH_TOKEN', source: 'settings_file', label: 'Configured via settings.json' };
    }

    return null;
  }

  /**
   * Checks Claude credentials in the same priority order used by Claude Code.
   */
  private async checkCredentials(): Promise<ClaudeCredentialsStatus> {
    const settingsEnv = await this.loadSettingsEnv();

    const apiKey = this.findApiKeyCredential(settingsEnv);
    if (apiKey) {
      const status: ClaudeCredentialsStatus = { authenticated: true, email: apiKey.label, method: 'api_key' };

      // The key wins, but Claude Code says nothing when it does so while a
      // `claude /login` subscription is also signed in — every request is then
      // billed pay-as-you-go to the key (issue #568). Surface the bypassed
      // login so the settings page can warn about it; an expired or missing
      // login is not being bypassed, so it stays silent.
      const subscription = await this.readCredentialsFile();
      if (subscription.authenticated) {
        status.subscriptionOverride = {
          variable: apiKey.variable,
          source: apiKey.source,
          subscriptionEmail: subscription.email,
        };
      }

      return status;
    }

    if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
      return { authenticated: true, email: 'OAuth Token (long-lived)', method: 'environment' };
    }

    if (readOptionalString(settingsEnv.CLAUDE_CODE_OAUTH_TOKEN)) {
      return { authenticated: true, email: 'OAuth Token (long-lived)', method: 'environment' };
    }

    return this.readCredentialsFile();
  }

  /**
   * Reads the `claude /login` OAuth session from ~/.claude/.credentials.json and
   * reports whether it is still usable. Shared by the fallback path (when no
   * env credential exists) and by the API-key path (to detect a bypassed login).
   */
  private async readCredentialsFile(): Promise<ClaudeCredentialsStatus> {
    const missingCredentialsError = 'Claude CLI is not authenticated. Run claude /login or configure ANTHROPIC_API_KEY.';

    try {
      const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
      const content = await readFile(credPath, 'utf8');
      const creds = readObjectRecord(JSON.parse(content)) ?? {};
      const oauth = readObjectRecord(creds.claudeAiOauth);
      const accessToken = readOptionalString(oauth?.accessToken);

      if (accessToken) {
        const expiresAt = typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : undefined;
        const email = readOptionalString(creds.email) ?? readOptionalString(creds.user) ?? null;
        if (!expiresAt || Date.now() < expiresAt) {
          return {
            authenticated: true,
            email,
            method: 'credentials_file',
          };
        }

        // `accessToken` is short-lived (hours). Claude Code renews it silently
        // from `refreshToken` on the next CLI invocation, so an expired access
        // token alongside a live refresh token is still a working login. Before
        // this check, a still-signed-in account read as "login has expired"
        // until something else happened to run the CLI — which is why opening
        // the Shell tab and coming back made Settings flip to Connected.
        const refreshToken = readOptionalString(oauth?.refreshToken);
        const refreshTokenExpiresAt = typeof oauth?.refreshTokenExpiresAt === 'number'
          ? oauth.refreshTokenExpiresAt
          : undefined;
        if (refreshToken && (!refreshTokenExpiresAt || Date.now() < refreshTokenExpiresAt)) {
          return {
            authenticated: true,
            email,
            method: 'credentials_file',
          };
        }

        return {
          authenticated: false,
          email: null,
          method: null,
          error: 'Claude login has expired. Run claude /login again.',
        };
      }

      return {
        authenticated: false,
        email: null,
        method: null,
        error: missingCredentialsError,
      };
    } catch (error) {
      let errorMessage = 'Unable to read Claude credentials. Run claude /login again.';

      if (hasErrorCode(error, 'ENOENT')) {
        errorMessage = missingCredentialsError;
      } else if (error instanceof SyntaxError) {
        errorMessage = 'Claude credentials are unreadable. Run claude /login again.';
      }

      return {
        authenticated: false,
        email: null,
        method: null,
        error: errorMessage,
      };
    }
  }
}

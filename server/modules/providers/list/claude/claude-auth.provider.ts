import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

type ClaudeCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

const hasErrorCode = (error: unknown, code: string): boolean => (
  error instanceof Error && 'code' in error && error.code === code
);

export class ClaudeProviderAuth implements IProviderAuth {
  /**
   * Checks whether the Claude Code CLI is available on this host.
   */
  private checkInstalled(): boolean {
    const cliPath = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
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
    const missingCredentialsError = 'Claude CLI is not authenticated. Run claude /login or configure ANTHROPIC_API_KEY.';

    if (process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
      return { authenticated: true, email: 'Auth Token', method: 'api_key' };
    }

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

    // Fall back to a plaintext credentials file if one exists (older Claude
    // Code versions, or platforms where OAuth creds aren't OS-keychain backed).
    const fileCredentials = await this.readCredentialsFile();
    if (fileCredentials) {
      return fileCredentials;
    }

    // Claude Code stores OAuth credentials in a macOS Keychain entry whose
    // service name is derived from CLAUDE_CONFIG_DIR (a different, hashed
    // service name per profile) rather than a file we can read directly.
    // That derivation isn't a stable contract we should reimplement, so defer
    // to the CLI's own `claude auth status`, which already resolves it
    // correctly (file, keychain, or otherwise) for whichever CLAUDE_CONFIG_DIR
    // is active in this process's environment.
    return this.checkCliAuthStatus(missingCredentialsError);
  }

  /**
   * Reads the plaintext OAuth credentials file, when Claude Code uses one.
   * Returns null (rather than an "unauthenticated" result) when the file is
   * simply absent, so the caller can fall back to `claude auth status`.
   */
  private async readCredentialsFile(): Promise<ClaudeCredentialsStatus | null> {
    try {
      const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
      const content = await readFile(credPath, 'utf8');
      const creds = readObjectRecord(JSON.parse(content)) ?? {};
      const oauth = readObjectRecord(creds.claudeAiOauth);
      const accessToken = readOptionalString(oauth?.accessToken);

      if (!accessToken) {
        return null;
      }

      const expiresAt = typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : undefined;
      const email = readOptionalString(creds.email) ?? readOptionalString(creds.user) ?? null;
      if (!expiresAt || Date.now() < expiresAt) {
        return { authenticated: true, email, method: 'credentials_file' };
      }

      return {
        authenticated: false,
        email: null,
        method: null,
        error: 'Claude login has expired. Run claude /login again.',
      };
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return null;
      }

      return {
        authenticated: false,
        email: null,
        method: null,
        error: error instanceof SyntaxError
          ? 'Claude credentials are unreadable. Run claude /login again.'
          : 'Unable to read Claude credentials. Run claude /login again.',
      };
    }
  }

  /**
   * Resolves OAuth login state via `claude auth status --json`, inheriting
   * this process's environment (including CLAUDE_CONFIG_DIR) so it reports
   * the profile actually in use rather than always the default one.
   */
  private async checkCliAuthStatus(missingCredentialsError: string): Promise<ClaudeCredentialsStatus> {
    const cliPath = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);

    let result;
    try {
      result = spawn.sync(cliPath, ['auth', 'status', '--json'], {
        timeout: 10000,
        encoding: 'utf8',
        env: process.env,
      });
    } catch {
      return {
        authenticated: false,
        email: null,
        method: null,
        error: 'Unable to check Claude authentication status. Run claude /login again.',
      };
    }

    const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
    if (!stdout) {
      return { authenticated: false, email: null, method: null, error: missingCredentialsError };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = readObjectRecord(JSON.parse(stdout)) ?? {};
    } catch {
      return {
        authenticated: false,
        email: null,
        method: null,
        error: 'Unable to parse Claude authentication status. Run claude /login again.',
      };
    }

    if (parsed.loggedIn !== true) {
      return { authenticated: false, email: null, method: null, error: missingCredentialsError };
    }

    const orgName = readOptionalString(parsed.orgName);
    const email = readOptionalString(parsed.email) ?? (orgName ? `Authenticated (${orgName})` : null);
    const authMethod = readOptionalString(parsed.authMethod);

    return {
      authenticated: true,
      email,
      method: authMethod === 'claude.ai' ? 'oauth' : (readOptionalString(parsed.apiProvider) ?? 'api_key'),
    };
  }
}

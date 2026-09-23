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

type ClaudeCloudProvider = {
  switchEnvKey: string;
  label: string;
  projectEnvKey?: string;
};

// Third-party providers Claude Code sends requests to instead of the Anthropic
// API, in the order the current CLI (2.1.280) checks their switches when picking
// one. Labels are the CLI's own display names. The older CLI bundled with the
// Agent SDK (2.1.165) has no CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD switch.
const CLAUDE_CLOUD_PROVIDERS: ClaudeCloudProvider[] = [
  { switchEnvKey: 'CLAUDE_CODE_USE_BEDROCK', label: 'Amazon Bedrock' },
  { switchEnvKey: 'CLAUDE_CODE_USE_FOUNDRY', label: 'Microsoft Foundry' },
  { switchEnvKey: 'CLAUDE_CODE_USE_ANTHROPIC_AWS', label: 'Claude Platform on AWS' },
  { switchEnvKey: 'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD', label: 'Claude Platform on Google Cloud' },
  { switchEnvKey: 'CLAUDE_CODE_USE_MANTLE', label: 'Amazon Bedrock (Mantle)' },
  { switchEnvKey: 'CLAUDE_CODE_USE_VERTEX', label: 'Google Vertex AI', projectEnvKey: 'ANTHROPIC_VERTEX_PROJECT_ID' },
];

const hasErrorCode = (error: unknown, code: string): boolean => (
  error instanceof Error && 'code' in error && error.code === code
);

// Same rule the CLI applies to its boolean env switches: only "1", "true",
// "yes" or "on" (trimmed, any case) turn one on, so "0" or "false" leave it off.
const isEnvSwitchOn = (value: unknown): boolean => {
  if (!value) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

// The CLI copies settings.json `env` over its process env at startup, so a key
// set there wins over the same key inherited from this server's environment.
// Like the CLI, a settings value that is not a string, number or boolean (e.g.
// null) is dropped and the process env value stays in effect. An empty string
// is still applied, so "" in settings switches a key off.
const readCliEnvValue = (settingsEnv: Record<string, unknown>, key: string): unknown => {
  const settingsValue = settingsEnv[key];
  const isAppliedByCli = typeof settingsValue === 'string'
    || typeof settingsValue === 'number'
    || typeof settingsValue === 'boolean';
  return isAppliedByCli ? settingsValue : process.env[key];
};

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
    const settingsEnv = await this.loadSettingsEnv();

    // With a cloud provider switched on, the CLI authenticates with that cloud's
    // own credentials (e.g. gcloud ADC for Vertex) and ignores the Anthropic keys
    // and login checked below. Like those checks, this only looks at what is
    // configured: cloud credentials can come from a metadata server with no local
    // file, and the Vertex project can be resolved from them when no ID is set.
    const cloudProvider = CLAUDE_CLOUD_PROVIDERS.find(({ switchEnvKey }) => (
      isEnvSwitchOn(readCliEnvValue(settingsEnv, switchEnvKey))
    ));
    if (cloudProvider) {
      const projectId = cloudProvider.projectEnvKey
        ? readOptionalString(readCliEnvValue(settingsEnv, cloudProvider.projectEnvKey))
        : undefined;
      return {
        authenticated: true,
        email: projectId ? `${cloudProvider.label} (${projectId})` : cloudProvider.label,
        method: 'cloud_provider',
      };
    }

    if (process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
      return { authenticated: true, email: 'Auth Token', method: 'api_key' };
    }

    if (process.env.ANTHROPIC_API_KEY?.trim()) {
      return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
    }

    if (readOptionalString(settingsEnv.ANTHROPIC_API_KEY)) {
      return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
    }

    if (readOptionalString(settingsEnv.ANTHROPIC_AUTH_TOKEN)) {
      return { authenticated: true, email: 'Configured via settings.json', method: 'api_key' };
    }

    if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
      return { authenticated: true, email: 'OAuth Token (long-lived)', method: 'environment' };
    }

    if (readOptionalString(settingsEnv.CLAUDE_CODE_OAUTH_TOKEN)) {
      return { authenticated: true, email: 'OAuth Token (long-lived)', method: 'environment' };
    }

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

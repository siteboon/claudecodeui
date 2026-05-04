import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';
import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

type CodexCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error: string | null;
};

const AUTHENTICATED_EMAIL = 'Authenticated';
const API_KEY_EMAIL = 'API Key Auth';

const readEmailFromIdToken = (idToken: string): string => {
  try {
    const parts = idToken.split('.');
    if (parts.length >= 2) {
      const payload = readObjectRecord(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
      return readOptionalString(payload?.email) ?? readOptionalString(payload?.user) ?? AUTHENTICATED_EMAIL;
    }
  } catch {
    // Ignore malformed token payloads and fall back to a generic label.
  }

  return AUTHENTICATED_EMAIL;
};

const readAuthJsonStatus = async (codexHome: string): Promise<CodexCredentialsStatus | null> => {
  const authPath = path.join(codexHome, 'auth.json');
  const content = await readFile(authPath, 'utf8');
  const auth = readObjectRecord(JSON.parse(content)) ?? {};
  const tokens = readObjectRecord(auth.tokens) ?? {};
  const idToken = readOptionalString(tokens.id_token);
  const accessToken = readOptionalString(tokens.access_token);

  if (idToken || accessToken) {
    return {
      authenticated: true,
      email: idToken ? readEmailFromIdToken(idToken) : AUTHENTICATED_EMAIL,
      method: 'credentials_file',
      error: null,
    };
  }

  if (readOptionalString(auth.OPENAI_API_KEY)) {
    return {
      authenticated: true,
      email: API_KEY_EMAIL,
      method: 'api_key',
      error: null,
    };
  }

  return null;
};

const readConfigTomlStatus = async (
  codexHome: string,
  env: NodeJS.ProcessEnv,
): Promise<CodexCredentialsStatus | null> => {
  const configPath = path.join(codexHome, 'config.toml');
  const content = await readFile(configPath, 'utf8');
  const config = readObjectRecord(TOML.parse(content)) ?? {};
  const providerName = readOptionalString(config.model_provider);
  const providers = readObjectRecord(config.model_providers) ?? {};
  const providerConfig = providerName ? readObjectRecord(providers[providerName]) : null;
  const envKey = readOptionalString(providerConfig?.env_key);

  if (envKey && readOptionalString(env[envKey])) {
    return {
      authenticated: true,
      email: API_KEY_EMAIL,
      method: 'api_key',
      error: null,
    };
  }

  return null;
};

export async function checkStatus(): Promise<CodexCredentialsStatus> {
  const codexHome = path.join(os.homedir(), '.codex');

  try {
    const authStatus = await readAuthJsonStatus(codexHome);
    if (authStatus) {
      return authStatus;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      return {
        authenticated: false,
        email: null,
        method: null,
        error: error instanceof Error ? error.message : 'Failed to read Codex auth',
      };
    }
  }

  try {
    const configStatus = await readConfigTomlStatus(codexHome, process.env);
    if (configStatus) {
      return configStatus;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      return {
        authenticated: false,
        email: null,
        method: null,
        error: error instanceof Error ? error.message : 'Failed to read Codex config',
      };
    }
  }

  return {
    authenticated: false,
    email: null,
    method: null,
    error: 'Codex not configured',
  };
}

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
   * Reads Codex auth status from either auth.json or config.toml env_key-based setups.
   */
  private async checkCredentials(): Promise<CodexCredentialsStatus> {
    return checkStatus();
  }
}

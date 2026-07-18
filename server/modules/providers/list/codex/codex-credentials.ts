import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

export type CodexCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
  env?: Record<string, string>;
};

type EnvFile = Record<string, string>;

const resolveCodexHome = (): string => (
  readOptionalString(process.env.CODEX_HOME) ?? path.join(os.homedir(), '.codex')
);

const parseEnvLine = (rawLine: string): [string, string] | null => {
  const trimmedLine = rawLine.trim();
  if (!trimmedLine || trimmedLine.startsWith('#')) {
    return null;
  }

  const line = trimmedLine.startsWith('export ')
    ? trimmedLine.slice('export '.length).trimStart()
    : trimmedLine;
  const separatorIndex = line.indexOf('=');
  if (separatorIndex <= 0) {
    return null;
  }

  const key = line.slice(0, separatorIndex).trim();
  let value = line.slice(separatorIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return key ? [key, value] : null;
};

const readEnvFile = async (envPath: string): Promise<EnvFile> => {
  const content = await readFile(envPath, 'utf8');
  const values: EnvFile = {};

  for (const line of content.split('\n')) {
    const entry = parseEnvLine(line);
    if (entry) {
      values[entry[0]] = entry[1];
    }
  }

  return values;
};

const readEmailFromIdToken = (idToken: string): string => {
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
};

const readOfficialCredentials = async (codexHome: string): Promise<CodexCredentialsStatus | null> => {
  try {
    const authPath = path.join(codexHome, 'auth.json');
    const content = await readFile(authPath, 'utf8');
    const auth = readObjectRecord(JSON.parse(content)) ?? {};
    const tokens = readObjectRecord(auth.tokens) ?? {};
    const idToken = readOptionalString(tokens.id_token);
    const accessToken = readOptionalString(tokens.access_token);

    if (idToken || accessToken) {
      return {
        authenticated: true,
        email: idToken ? readEmailFromIdToken(idToken) : 'Authenticated',
        method: 'credentials_file',
      };
    }

    if (readOptionalString(auth.OPENAI_API_KEY)) {
      return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
    }

    return { authenticated: false, email: null, method: null, error: 'No valid tokens found' };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null;
    }

    return {
      authenticated: false,
      email: null,
      method: null,
      error: error instanceof Error ? error.message : 'Failed to read Codex auth',
    };
  }
};

const readCustomProviderCredentials = async (codexHome: string): Promise<CodexCredentialsStatus> => {
  let config: Record<string, unknown>;
  try {
    const rawConfig = await readFile(path.join(codexHome, 'config.toml'), 'utf8');
    config = readObjectRecord(TOML.parse(rawConfig)) ?? {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      authenticated: false,
      email: null,
      method: null,
      error: code === 'ENOENT' ? 'Codex not configured' : error instanceof Error ? error.message : 'Failed to read Codex config',
    };
  }

  const providerName = readOptionalString(config.model_provider);
  if (!providerName) {
    return { authenticated: false, email: null, method: null, error: 'Codex model_provider missing' };
  }

  const providers = readObjectRecord(config.model_providers) ?? {};
  const provider = readObjectRecord(providers[providerName]);
  const envKey = readOptionalString(provider?.env_key);
  if (!envKey) {
    return {
      authenticated: false,
      email: null,
      method: null,
      error: `Codex provider ${providerName} env_key missing`,
    };
  }

  const processEnvValue = readOptionalString(process.env[envKey]);
  if (processEnvValue) {
    return {
      authenticated: true,
      email: `${providerName} custom provider`,
      method: 'custom_provider_env',
      env: { [envKey]: processEnvValue },
    };
  }

  try {
    const envFile = await readEnvFile(path.join(codexHome, '.env'));
    const envFileValue = readOptionalString(envFile[envKey]);
    if (envFileValue) {
      return {
        authenticated: true,
        email: `${providerName} custom provider`,
        method: 'custom_provider_env_file',
        env: { [envKey]: envFileValue },
      };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      return {
        authenticated: false,
        email: null,
        method: null,
        error: error instanceof Error ? error.message : 'Failed to read Codex .env',
      };
    }
  }

  return {
    authenticated: false,
    email: null,
    method: null,
    error: `Codex provider credential ${envKey} missing`,
  };
};

export async function resolveCodexCredentials(): Promise<CodexCredentialsStatus> {
  const codexHome = resolveCodexHome();
  const officialCredentials = await readOfficialCredentials(codexHome);
  if (officialCredentials?.authenticated) {
    return officialCredentials;
  }

  const customProviderCredentials = await readCustomProviderCredentials(codexHome);
  if (customProviderCredentials.authenticated) {
    return customProviderCredentials;
  }

  if (customProviderCredentials.error !== 'Codex not configured') {
    return customProviderCredentials;
  }

  return officialCredentials ?? customProviderCredentials;
}

export function buildCodexCliEnvironment(credentials: CodexCredentialsStatus): Record<string, string> | undefined {
  if (!credentials.env || Object.keys(credentials.env).length === 0) {
    return undefined;
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return {
    ...env,
    ...credentials.env,
  };
}

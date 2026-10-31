import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type { CodexOptions } from '@openai/codex-sdk';

import { appConfigDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

type Connection = { provider: string; baseUrl: string; apiKey: string };
type Store = Pick<typeof appConfigDb, 'get' | 'set'>;
const CONFIG_KEY = 'codex_api_connection';
// This launcher contains no credentials. Quoted environment expansions keep URL/key data out of shell code.
const SHELL_LAUNCHER = `#!/bin/sh
exec "$CLOUDCLI_CODEX_EXECUTABLE" \\
  -c "model_provider=$CLOUDCLI_CODEX_PROVIDER_TOML" \\
  -c "model_providers.$CLOUDCLI_CODEX_PROVIDER.name=\\\"CloudCLI API\\\"" \\
  -c "model_providers.$CLOUDCLI_CODEX_PROVIDER.base_url=$CLOUDCLI_CODEX_BASE_URL_TOML" \\
  -c "model_providers.$CLOUDCLI_CODEX_PROVIDER.wire_api=\\\"responses\\\"" \\
  -c "model_providers.$CLOUDCLI_CODEX_PROVIDER.env_key=\\\"CODEX_API_KEY\\\"" \\
  -c "model_providers.$CLOUDCLI_CODEX_PROVIDER.requires_openai_auth=false" "$@"
`;

function validateProvider(value: string): string {
  const provider = value.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(provider) || provider === 'openai') {
    throw new AppError('Use a custom provider ID: start with a letter, then letters, digits, underscores or hyphens (up to 64 characters). The built-in openai ID is reserved.', {
      code: 'INVALID_CODEX_PROVIDER', statusCode: 400,
    });
  }
  return provider;
}

/** Used by the provider routes, auth adapter and runtime to share app-owned API settings. */
export function createCodexApiConnectionService(store: Store = appConfigDb) {
  const read = (): Connection | null => {
    const raw = store.get(CONFIG_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object'
      || !('baseUrl' in value) || typeof value.baseUrl !== 'string'
      || !('apiKey' in value) || typeof value.apiKey !== 'string'
      || !value.baseUrl || !value.apiKey) {
      throw new Error('Stored Codex API connection is invalid.');
    }
    // Preserve connections saved before provider IDs became configurable.
    const provider = 'provider' in value && typeof value.provider === 'string' ? value.provider : 'custom-api';
    return { provider: validateProvider(provider), baseUrl: value.baseUrl, apiKey: value.apiKey };
  };
  const getPublic = () => {
    const connection = read();
    return { provider: connection?.provider ?? 'custom-api', baseUrl: connection?.baseUrl ?? '', hasApiKey: Boolean(connection) };
  };

  return {
    getPublic,
    save(input: { provider?: string; baseUrl: string; apiKey?: string }) {
      const existing = read();
      const provider = validateProvider(input.provider ?? existing?.provider ?? 'custom-api');
      let url: URL;
      try {
        url = new URL(input.baseUrl.trim());
      } catch {
        throw new AppError('Base URL must be a valid HTTP(S) URL.', {
          code: 'INVALID_CODEX_BASE_URL', statusCode: 400,
        });
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new AppError('Base URL must use HTTP(S) without credentials, query or fragment.', {
          code: 'INVALID_CODEX_BASE_URL', statusCode: 400,
        });
      }
      const apiKey = input.apiKey?.trim() || existing?.apiKey;
      if (!apiKey || /[\r\n]/.test(apiKey)) {
        throw new AppError('An API key is required.', { code: 'INVALID_CODEX_API_KEY', statusCode: 400 });
      }
      store.set(CONFIG_KEY, JSON.stringify({ provider, baseUrl: url.href.replace(/\/+$/, ''), apiKey }));
      return getPublic();
    },
    clear() {
      store.set(CONFIG_KEY, '');
      return getPublic();
    },
    /** Used by the websocket terminal to configure Codex without changing user config or session storage. */
    getShellEnvironment(currentPath: string | undefined): Record<string, string> | undefined {
      const connection = read();
      if (!connection || process.platform === 'win32') return undefined;
      const executable = process.env.CLOUDCLI_CODEX_PATH
        || createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js');
      const directory = path.join(os.homedir(), '.cloudcli', 'codex-shell', 'bin');
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const launcher = path.join(directory, 'codex');
      // Atomic replacement also repairs a missing launcher; neither its contents nor filename include secrets.
      const temporary = `${launcher}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, SHELL_LAUNCHER, { mode: 0o700 });
      fs.renameSync(temporary, launcher);
      return {
        PATH: `${directory}${path.delimiter}${currentPath ?? ''}`,
        CODEX_API_KEY: connection.apiKey,
        CLOUDCLI_CODEX_EXECUTABLE: executable,
        CLOUDCLI_CODEX_PROVIDER: connection.provider,
        CLOUDCLI_CODEX_PROVIDER_TOML: JSON.stringify(connection.provider),
        CLOUDCLI_CODEX_BASE_URL_TOML: JSON.stringify(connection.baseUrl),
      };
    },
    getSdkOptions(): CodexOptions | undefined {
      const connection = read();
      if (!connection) return undefined;
      // Explicit provider and env-key overrides avoid inheriting ~/.codex/config.toml's provider/auth.
      return {
        apiKey: connection.apiKey,
        config: {
          model_provider: connection.provider,
          model_providers: {
            [connection.provider]: {
              name: 'CloudCLI API',
              base_url: connection.baseUrl,
              wire_api: 'responses',
              env_key: 'CODEX_API_KEY',
              requires_openai_auth: false,
            },
          },
        },
      };
    },
  };
}

/** Used by Codex auth/runtime and the authenticated provider configuration routes. */
export const codexApiConnectionService = createCodexApiConnectionService();

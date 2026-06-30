import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

export class HermesProviderAuth implements IProviderAuth {
  private checkInstalled(): boolean {
    const cliPath = process.env.HERMES_CLI_PATH || 'hermes acp';
    const [command, ...args] = cliPath.trim().split(/\s+/);
    try {
      const result = spawn.sync(command || 'hermes', [...args, '--version'], { stdio: 'ignore', timeout: 5000 });
      return result.error ? false : result.status === 0 || result.status === null;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    if (!installed) {
      return {
        provider: 'hermes',
        installed: false,
        authenticated: false,
        email: null,
        method: null,
        error: 'Hermes ACP is not installed',
      };
    }

    const credentials = await this.checkCredentials();
    return {
      provider: 'hermes',
      installed,
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : 'Hermes credentials were not found',
    };
  }

  private async checkCredentials(): Promise<{ authenticated: boolean; email: string | null; method: string | null }> {
    if (this.hasKnownProviderEnv(process.env)) {
      return { authenticated: true, email: 'API Key Auth', method: 'env' };
    }

    const hermesHome = path.join(os.homedir(), '.hermes');
    try {
      const authJson = readObjectRecord(JSON.parse(await readFile(path.join(hermesHome, 'auth.json'), 'utf8')));
      if (
        readOptionalString(authJson?.apiKey)
        || readOptionalString(authJson?.api_key)
        || readOptionalString(authJson?.token)
        || readOptionalString(authJson?.access_token)
        || readOptionalString(authJson?.refresh_token)
      ) {
        return {
          authenticated: true,
          email: readOptionalString(authJson?.email) ?? 'Hermes Auth',
          method: 'credentials_file',
        };
      }
    } catch {
      // Fall through to dotenv check.
    }

    try {
      const envContent = await readFile(path.join(hermesHome, '.env'), 'utf8');
      if (this.hasKnownProviderEnv(this.parseEnvFile(envContent))) {
        return { authenticated: true, email: 'API Key Auth', method: 'env_file' };
      }
    } catch {
      // Fall through.
    }

    try {
      const configContent = await readFile(path.join(hermesHome, 'config.yaml'), 'utf8');
      if (/^\s*api_key\s*:\s*["']?[^"'#\s]+/m.test(configContent)) {
        return { authenticated: true, email: 'Hermes Config', method: 'config_file' };
      }
    } catch {
      // Fall through.
    }

    return { authenticated: false, email: null, method: null };
  }

  private parseEnvFile(content: string): Record<string, string> {
    const parsed: Record<string, string> = {};
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && value) {
        parsed[key] = value;
      }
    }
    return parsed;
  }

  private hasKnownProviderEnv(env: Record<string, string | undefined>): boolean {
    const keys = [
      'HERMES_API_KEY',
      'NOUS_API_KEY',
      'OPENROUTER_API_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GOOGLE_API_KEY',
      'GEMINI_API_KEY',
      'GLM_API_KEY',
      'KIMI_API_KEY',
      'MINIMAX_API_KEY',
      'MINIMAX_CN_API_KEY',
      'HF_TOKEN',
      'NVIDIA_API_KEY',
      'ARCEEAI_API_KEY',
      'OLLAMA_API_KEY',
      'KILOCODE_API_KEY',
      'GITHUB_TOKEN',
    ];
    return keys.some((key) => Boolean(env[key]?.trim()));
  }
}

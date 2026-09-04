import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

const COMMAND_CODE_BINARY = 'command-code';

type CommandCodeStatusPayload = {
  authenticated?: unknown;
  version?: unknown;
  user?: unknown;
  model?: unknown;
  context_window?: unknown;
};

/**
 * Parses the single JSON line emitted by `command-code status --json`.
 *
 * The payload is deliberately treated as forward-compatible: only the fields
 * this status check reads are narrowed, and unknown extra fields are ignored.
 */
const parseStatusPayload = (raw: unknown): CommandCodeStatusPayload | null => {
  if (typeof raw !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed as CommandCodeStatusPayload;
  } catch {
    return null;
  }
};

/**
 * Checks whether the Command Code CLI is installed and authenticated.
 *
 * Command Code authenticates against a Command Code account (`cmd login`), and
 * its `status --json` subcommand reports that state as one JSON line:
 * `{"authenticated":true,"version":"1.45.0","user":"...","model":"..."}`.
 *
 * The on-disk credential file under `~/.commandcode` is a private, versioned
 * shape (api key + user id), so this adapter deliberately reads only the CLI's
 * public status contract rather than hand-parsing it.
 */
export class CommandCodeProviderAuth implements IProviderAuth {
  /**
   * Checks whether the Command Code CLI is available without blocking the
   * event loop. Resolves after at most five seconds.
   */
  private checkInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      let child: ReturnType<typeof spawn.spawn>;
      try {
        child = spawn(COMMAND_CODE_BINARY, ['--version'], {
          stdio: 'ignore',
        });
      } catch {
        resolve(false);
        return;
      }

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        resolve(false);
      }, 5000);

      child.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code === 0);
      });
    });
  }

  /**
   * Runs `command-code status --json` and resolves the status.
   *
   * `authenticated:false` in the JSON body wins over any exit code when the two
   * conflict, because the body is the CLI's explicit answer to "am I logged in".
   */
  private checkCredentials(): Promise<{ authenticated: boolean; email: string | null; method: string | null; error?: string }> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let child: ReturnType<typeof spawn.spawn>;

      try {
        child = spawn(COMMAND_CODE_BINARY, ['status', '--json'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NO_COLOR: '1' },
        });
      } catch {
        resolve({
          authenticated: false,
          email: null,
          method: null,
          error: 'Unable to run command-code status. Run command-code /login again.',
        });
        return;
      }

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({
          authenticated: false,
          email: null,
          method: null,
          error: 'command-code status timed out.',
        });
      }, 8000);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', () => {
        clearTimeout(timeout);
        resolve({
          authenticated: false,
          email: null,
          method: null,
          error: 'Unable to run command-code status. Run command-code /login again.',
        });
      });

      child.on('close', () => {
        clearTimeout(timeout);
        const payload = parseStatusPayload(stdout.trim());
        const authenticated = payload?.authenticated === true;
        if (authenticated) {
          const user = typeof payload?.user === 'string' && payload.user.trim() ? payload.user : undefined;
          resolve({
            authenticated: true,
            email: user || 'Authenticated',
            method: 'account',
          });
          return;
        }

        const detail = stderr.trim() || (payload ? 'Command Code is not authenticated.' : 'command-code status returned an unreadable response.');
        resolve({
          authenticated: false,
          email: null,
          method: null,
          error: detail,
        });
      });
    });
  }

  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = await this.checkInstalled();

    if (!installed) {
      return {
        installed,
        provider: 'command-code',
        authenticated: false,
        email: null,
        method: null,
        error: 'Command Code CLI is not installed. Install it with: npm i -g command-code',
      };
    }

    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'command-code',
      authenticated: credentials.authenticated,
      email: credentials.authenticated ? credentials.email || 'Authenticated' : credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }
}

export const getCommandCodeHomePath = (): string => path.join(os.homedir(), '.commandcode');

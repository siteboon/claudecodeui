import crossSpawn from 'cross-spawn';

import { resolveAgyBinary } from '@/modules/providers/list/antigravity/antigravity-runtime.provider.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { CliVersionProbe, ProviderAuthStatus } from '@/shared/types.js';
import { probeCliVersion } from '@/shared/utils.js';

const PROVIDER = 'antigravity';
const MODELS_TIMEOUT_MS = 25_000;

/**
 * Auth adapter for the Antigravity CLI.
 *
 * agy keeps its Google OAuth token on disk and has no `status` subcommand, so
 * "logged in" is decided by asking the CLI for its model catalog: `agy models`
 * performs the authenticated call and fails when the stored token is missing
 * or expired.
 */
export class AntigravityProviderAuth implements IProviderAuth {
  checkInstalled(): CliVersionProbe {
    return probeCliVersion(resolveAgyBinary());
  }

  async getStatus(): Promise<ProviderAuthStatus> {
    const { installed, version: installedVersion } = this.checkInstalled();

    if (!installed) {
      return {
        installed,
        provider: PROVIDER,
        installedVersion,
        authenticated: false,
        email: null,
        method: null,
        error: 'Antigravity CLI (agy) is not installed',
      };
    }

    const probe = await this.probeLogin();

    return {
      installed,
      provider: PROVIDER,
      installedVersion,
      authenticated: probe.authenticated,
      email: null,
      method: probe.authenticated ? 'cli' : null,
      error: probe.authenticated ? undefined : probe.error,
    };
  }

  private probeLogin(): Promise<{ authenticated: boolean; error?: string }> {
    return new Promise((resolve) => {
      let settled = false;
      let child: ReturnType<typeof crossSpawn> | undefined;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          child?.kill();
          resolve({ authenticated: false, error: 'agy models timed out' });
        }
      }, MODELS_TIMEOUT_MS);

      try {
        child = crossSpawn(resolveAgyBinary(), ['models'], { windowsHide: true });
      } catch {
        clearTimeout(timeout);
        resolve({ authenticated: false, error: 'Antigravity CLI not found' });
        return;
      }

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve({ authenticated: false, error: 'Antigravity CLI not found' });
      });
      child.on('close', (code: number | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (code === 0 && stdout.trim()) {
          resolve({ authenticated: true });
          return;
        }
        resolve({
          authenticated: false,
          error: (stderr || stdout).trim().slice(0, 500) || 'Not logged in to Antigravity',
        });
      });
    });
  }
}

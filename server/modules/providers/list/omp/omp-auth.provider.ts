import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import crossSpawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

const spawnFn = process.platform === 'win32' ? crossSpawn : spawn;

// Env keys that would let omp run even without a persisted agent.db credential.
const OMP_CREDENTIAL_ENV_KEYS = ['PI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

/**
 * Auth status for omp (P7). `installed` = async `omp --version` (never blocks
 * the event loop, per the Kiro PR's async conversion). `authenticated` =
 * `~/.omp/agent/agent.db` `auth_credentials` row count > 0 (readonly), with an
 * env-key fallback so a configured-but-no-db setup isn't reported as false.
 */
export class OmpProviderAuth implements IProviderAuth {
  private checkInstalled(): Promise<boolean> {
    // Read OMP_PATH at call time so it stays overridable (e.g. in tests).
    const bin = process.env.OMP_PATH ?? 'omp';
    return new Promise((resolve) => {
      let settled = false;
      let child: ReturnType<typeof spawnFn> | undefined;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const timeout = setTimeout(() => { child?.kill(); finish(false); }, 5000);
      try {
        child = spawnFn(bin, ['--version'], { stdio: 'ignore' });
      } catch {
        finish(false);
        return;
      }
      child.on('close', (code) => finish(code === 0));
      child.on('error', () => finish(false));
    });
  }

  private checkAuthenticated(): { authenticated: boolean; error?: string } {
    const dbPath = path.join(os.homedir(), '.omp', 'agent', 'agent.db');
    let db: Database.Database | undefined;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
      // ponytail: counts all credentials, including any disabled ones — "has
      // credentials configured" is the signal the UI needs; tighten with a
      // `disabled_cause IS NULL` filter if the pane must show only usable creds.
      const row = db.prepare('SELECT COUNT(*) AS count FROM auth_credentials').get() as { count: number } | undefined;
      if ((row?.count ?? 0) > 0) {
        return { authenticated: true };
      }
    } catch {
      // agent.db or the table is absent — fall through to the env-key fallback
      // rather than hard-failing to false.
    } finally {
      try { db?.close(); } catch { /* already closed */ }
    }

    const hasEnvKey = OMP_CREDENTIAL_ENV_KEYS.some((key) => (process.env[key] ?? '').trim().length > 0);
    return hasEnvKey ? { authenticated: true } : { authenticated: false, error: 'No omp credentials found' };
  }

  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = await this.checkInstalled();
    if (!installed) {
      return { installed, provider: 'omp', authenticated: false, email: null, method: null, error: 'omp is not installed' };
    }
    const { authenticated, error } = this.checkAuthenticated();
    return {
      installed,
      provider: 'omp',
      authenticated,
      email: null,
      method: authenticated ? 'agent' : null,
      error: authenticated ? undefined : (error ?? 'Not authenticated'),
    };
  }
}

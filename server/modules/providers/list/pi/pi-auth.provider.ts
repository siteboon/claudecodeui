/**
 * PiProviderAuth - reports Pi installation and authentication status.
 *
 * Installation is determined by running the Pi executable with `--version`.
 * Authentication is determined by launching an RPC probe through
 * {@link PiRpcClient} - which injects the same runtime flags (including
 * `--no-extensions`) - and checking that at least one model is available.
 *
 * Normal "not installed" / "not authenticated" states return without throwing.
 */
import spawn from 'cross-spawn';
import type { RpcClientOptions } from '@earendil-works/pi-coding-agent';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

import { PiPaths } from './pi-paths.provider.js';
import { PiRpcClient } from './pi-rpc-client.provider.js';

const VERSION_TIMEOUT_MS = 5000;
const PROBE_GRACE_MS = 5000;

/** Minimal probe surface the auth check depends on. */
interface AuthProbeClient {
  start(): Promise<void>;
  getAvailableModels(): Promise<unknown[]>;
  close(graceMs: number): Promise<void>;
}

interface PiAuthDeps {
  paths: Pick<PiPaths, 'getCliPath'>;
  spawnSync: typeof spawn.sync;
  createRpcClient: (options: RpcClientOptions) => AuthProbeClient;
}

const defaultDeps: PiAuthDeps = {
  paths: new PiPaths(),
  spawnSync: spawn.sync,
  createRpcClient: (options) => new PiRpcClient(options),
};

export class PiAuthProvider implements IProviderAuth {
  private readonly deps: PiAuthDeps;

  constructor(deps: Partial<PiAuthDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    if (!installed) {
      return {
        installed: false,
        provider: 'pi',
        authenticated: false,
        email: null,
        method: null,
        error: 'Pi CLI not installed',
      };
    }

    const authenticated = await this.probeAuthenticated();
    return {
      installed: true,
      provider: 'pi',
      authenticated,
      email: null,
      method: authenticated ? 'rpc_probe' : null,
      error: authenticated ? undefined : 'Not authenticated',
    };
  }

  /** True when `pi --version` exits successfully. */
  private checkInstalled(): boolean {
    try {
      const cliPath = this.deps.paths.getCliPath();
      const result = this.deps.spawnSync(cliPath, ['--version'], {
        stdio: 'ignore',
        timeout: VERSION_TIMEOUT_MS,
      });
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Launches an RPC probe using the same flags as the runtime (PiRpcClient
   * injects `--no-extensions`) and reports authenticated when at least one
   * model is returned. Any failure is treated as "not authenticated".
   */
  private async probeAuthenticated(): Promise<boolean> {
    // cliPath is intentionally omitted: PiRpcClient defaults to the JS entry
    // (dist/cli.js) via PiPaths.getRpcCliEntry(). Passing getCliPath() here
    // would spawn `node pi` and crash.
    const client = this.deps.createRpcClient({});
    try {
      await client.start();
      const models = await client.getAvailableModels();
      return models.length >= 1;
    } catch {
      return false;
    } finally {
      try {
        await client.close(PROBE_GRACE_MS);
      } catch {
        // ignore close failures during probe teardown
      }
    }
  }
}

/**
 * PiProvider - assembles the Pi integration's eight facets behind one
 * registry-owned object (see AbstractProvider / IProvider).
 *
 * Facets that left an injection seam are wired here to a real PiRpcClient:
 * - models: `withProbe` spawns a PiRpcClient, runs the catalog probe, then
 *   closes it with a bounded grace window.
 * - auth: uses its default PiRpcClient wiring.
 * The runtime already defaults to the real PiRpcClient factory (with onClose).
 */
import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import type {
  IProviderAuth,
  IProviderMcp,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSkills,
  IProviderSessions,
} from '@/shared/interfaces.js';

import { PiAuthProvider } from './pi-auth.provider.js';
import {
  PiModelsProvider,
  type PiModelsProbe,
  type PiModelsRpc,
} from './pi-models.provider.js';
import { PiMcpProvider } from './pi-mcp.provider.js';
import { PiRpcClient } from './pi-rpc-client.provider.js';
import { piRuntime } from './pi-runtime.provider.js';
import { PiSessionSynchronizer } from './pi-session-synchronizer.provider.js';
import { PiSessionsProvider } from './pi-sessions.provider.js';
import { PiSkillsProvider } from './pi-skills.provider.js';

const MODELS_PROBE_GRACE_MS = 5000;

/**
 * Real {@link PiModelsRpc}: spawns a PiRpcClient probe, runs the supplied
 * catalog function, and always closes the probe afterwards.
 */
const piModelsRpc: PiModelsRpc = {
  async withProbe(fn) {
    const client = new PiRpcClient();
    await client.start();
    try {
      return await fn(client as unknown as PiModelsProbe);
    } finally {
      try {
        await client.close(MODELS_PROBE_GRACE_MS);
      } catch {
        // ignore close failures during probe teardown
      }
    }
  },
};

export class PiProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = piRuntime;
  readonly models: IProviderModels = new PiModelsProvider(piModelsRpc);
  readonly mcp: IProviderMcp = new PiMcpProvider();
  readonly auth: IProviderAuth = new PiAuthProvider();
  readonly skills: IProviderSkills = new PiSkillsProvider();
  readonly sessions: IProviderSessions = new PiSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new PiSessionSynchronizer();

  constructor() {
    super('pi');
  }
}

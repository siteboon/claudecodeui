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

/**
 * Placeholder that fails loudly until the real adapter lands.
 */
function notImplemented(): never {
  throw new Error('not implemented');
}

/**
 * Registration stub for the `pi` provider.
 *
 * Only the registry identity is real today: the synchronizer reports zero
 * sessions so the shared scan cursor is not poisoned, and every other facet
 * throws until the runtime/model/MCP/auth/skill/session adapters replace them.
 */
export class PiProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = {
    run: () => notImplemented(),
    abort: () => notImplemented(),
  };

  readonly models: IProviderModels = {
    getSupportedModels: () => notImplemented(),
    getCurrentActiveModel: () => notImplemented(),
  };

  readonly mcp: IProviderMcp = {
    listServers: () => notImplemented(),
    listServersForScope: () => notImplemented(),
    upsertServer: () => notImplemented(),
    removeServer: () => notImplemented(),
  };

  readonly auth: IProviderAuth = {
    getStatus: () => notImplemented(),
  };

  readonly skills: IProviderSkills = {
    listSkills: () => notImplemented(),
    addSkills: () => notImplemented(),
    removeSkill: () => notImplemented(),
  };

  readonly sessions: IProviderSessions = {
    normalizeMessage: () => notImplemented(),
    fetchHistory: () => notImplemented(),
  };

  readonly sessionSynchronizer: IProviderSessionSynchronizer = {
    synchronize: async () => 0,
    synchronizeFile: async () => null,
  };

  constructor() {
    super('pi');
  }
}

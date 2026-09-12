import { PiProviderAuth } from '@/modules/providers/list/pi/pi-auth.provider.js';
import { PiMcpProvider } from '@/modules/providers/list/pi/pi-mcp.provider.js';
import { PiProviderModels } from '@/modules/providers/list/pi/pi-models.provider.js';
import { PiSessionSynchronizer } from '@/modules/providers/list/pi/pi-session-synchronizer.provider.js';
import { PiSessionsProvider } from '@/modules/providers/list/pi/pi-sessions.provider.js';
import { PiSkillsProvider } from '@/modules/providers/list/pi/pi-skills.provider.js';
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
import { AppError } from '@/shared/utils.js';

/**
 * Phase 1 runtime placeholder for Pi.
 *
 * The real adapter spawns `pi -p --mode json` and streams its JSON events onto
 * the normalized writer. Until it lands, every run fails with a typed
 * `NOT_SUPPORTED` error instead of a raw crash, and abort reports "nothing was
 * running" so an in-flight cancel stays a no-op rather than an exception.
 */
const piRuntime: IProviderRuntime = {
  async run(): Promise<unknown> {
    throw new AppError('Pi runtime is not implemented yet.', {
      code: 'NOT_SUPPORTED',
    });
  },
  abort: () => false,
};

/**
 * Registration for the `pi` provider.
 *
 * All seven facets are instantiable today; the runtime, session, and MCP
 * adapters are deliberately inert placeholders that the runtime, sessions, and
 * MCP tasks replace with real spawn/parse/config implementations.
 */
export class PiProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = piRuntime;
  readonly models: IProviderModels = new PiProviderModels();
  readonly mcp = new PiMcpProvider();
  readonly auth: IProviderAuth = new PiProviderAuth();
  readonly skills: IProviderSkills = new PiSkillsProvider();
  readonly sessions: IProviderSessions = new PiSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new PiSessionSynchronizer();

  constructor() {
    super('pi');
  }
}

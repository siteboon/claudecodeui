import { PiProviderAuth } from '@/modules/providers/list/pi/pi-auth.provider.js';
import { PiMcpProvider } from '@/modules/providers/list/pi/pi-mcp.provider.js';
import { PiProviderModels } from '@/modules/providers/list/pi/pi-models.provider.js';
import { piRuntime } from '@/modules/providers/list/pi/pi-runtime.provider.js';
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

/**
 * Registration for the `pi` provider.
 *
 * All seven facets are instantiable today; the session and MCP adapters are
 * deliberately inert placeholders that the sessions and MCP tasks replace
 * with real config implementations.
 */
export class PiProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = piRuntime;
  readonly models: IProviderModels = new PiProviderModels();
  readonly mcp: IProviderMcp = new PiMcpProvider();
  readonly auth: IProviderAuth = new PiProviderAuth();
  readonly skills: IProviderSkills = new PiSkillsProvider();
  readonly sessions: IProviderSessions = new PiSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new PiSessionSynchronizer();

  constructor() {
    super('pi');
  }
}

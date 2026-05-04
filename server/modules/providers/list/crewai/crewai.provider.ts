import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { CrewAIProviderAuth } from '@/modules/providers/list/crewai/crewai-auth.provider.js';
import { CrewAIMcpProvider } from '@/modules/providers/list/crewai/crewai-mcp.provider.js';
import { CrewAISessionSynchronizer } from '@/modules/providers/list/crewai/crewai-session-synchronizer.provider.js';
import { CrewAISessionsProvider } from '@/modules/providers/list/crewai/crewai-sessions.provider.js';
import type { IProviderAuth, IProviderSessionSynchronizer, IProviderSessions } from '@/shared/interfaces.js';

export class CrewAIProvider extends AbstractProvider {
  readonly mcp = new CrewAIMcpProvider();
  readonly auth: IProviderAuth = new CrewAIProviderAuth();
  readonly sessions: IProviderSessions = new CrewAISessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new CrewAISessionSynchronizer();

  constructor() {
    super('crewai');
  }
}

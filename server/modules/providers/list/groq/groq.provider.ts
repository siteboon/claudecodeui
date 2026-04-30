import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { GroqProviderAuth } from '@/modules/providers/list/groq/groq-auth.provider.js';
import { GroqMcpProvider } from '@/modules/providers/list/groq/groq-mcp.provider.js';
import { GroqSessionSynchronizer } from '@/modules/providers/list/groq/groq-session-synchronizer.provider.js';
import { GroqSessionsProvider } from '@/modules/providers/list/groq/groq-sessions.provider.js';
import type { IProviderAuth, IProviderSessionSynchronizer, IProviderSessions } from '@/shared/interfaces.js';

export class GroqProvider extends AbstractProvider {
  readonly mcp = new GroqMcpProvider();
  readonly auth: IProviderAuth = new GroqProviderAuth();
  readonly sessions: IProviderSessions = new GroqSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new GroqSessionSynchronizer();

  constructor() {
    super('groq');
  }
}

import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { KiroProviderAuth } from '@/modules/providers/list/kiro/kiro-auth.provider.js';
import { KiroMcpProvider } from '@/modules/providers/list/kiro/kiro-mcp.provider.js';
import { KiroSessionSynchronizer } from '@/modules/providers/list/kiro/kiro-session-synchronizer.provider.js';
import { KiroSessionsProvider } from '@/modules/providers/list/kiro/kiro-sessions.provider.js';
import type { IProviderAuth, IProviderSessionSynchronizer, IProviderSessions } from '@/shared/interfaces.js';

export class KiroProvider extends AbstractProvider {
  readonly mcp = new KiroMcpProvider();
  readonly auth: IProviderAuth = new KiroProviderAuth();
  readonly sessions: IProviderSessions = new KiroSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new KiroSessionSynchronizer();

  constructor() {
    super('kiro');
  }
}

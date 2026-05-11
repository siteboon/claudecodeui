import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { CursorProviderAuth } from '@/modules/providers/list/cursor/cursor-auth.provider.js';
import { CursorMcpProvider } from '@/modules/providers/list/cursor/cursor-mcp.provider.js';
import { CursorSessionSynchronizer } from '@/modules/providers/list/cursor/cursor-session-synchronizer.provider.js';
import { CursorSessionsProvider } from '@/modules/providers/list/cursor/cursor-sessions.provider.js';
import type { IProviderAuth, IProviderSessionSynchronizer, IProviderSessions } from '@/shared/interfaces.js';

export class CursorProvider extends AbstractProvider {
  readonly mcp = new CursorMcpProvider();
  readonly auth: IProviderAuth = new CursorProviderAuth();
  readonly sessions: IProviderSessions = new CursorSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new CursorSessionSynchronizer();

  constructor() {
    super('cursor');
  }
}

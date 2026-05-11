import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { CodexProviderAuth } from '@/modules/providers/list/codex/codex-auth.provider.js';
import { CodexMcpProvider } from '@/modules/providers/list/codex/codex-mcp.provider.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import type { IProviderAuth, IProviderSessionSynchronizer, IProviderSessions } from '@/shared/interfaces.js';

export class CodexProvider extends AbstractProvider {
  readonly mcp = new CodexMcpProvider();
  readonly auth: IProviderAuth = new CodexProviderAuth();
  readonly sessions: IProviderSessions = new CodexSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new CodexSessionSynchronizer();

  constructor() {
    super('codex');
  }
}

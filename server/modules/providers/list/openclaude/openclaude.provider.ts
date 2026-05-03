import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { OpenClaudeProviderAuth } from '@/modules/providers/list/openclaude/openclaude-auth.provider.js';
import { OpenClaudeMcpProvider } from '@/modules/providers/list/openclaude/openclaude-mcp.provider.js';
import { OpenClaudeSessionSynchronizer } from '@/modules/providers/list/openclaude/openclaude-session-synchronizer.provider.js';
import { OpenClaudeSessionsProvider } from '@/modules/providers/list/openclaude/openclaude-sessions.provider.js';
import type { IProviderAuth, IProviderSessionSynchronizer, IProviderSessions } from '@/shared/interfaces.js';

export class OpenClaudeProvider extends AbstractProvider {
  readonly mcp = new OpenClaudeMcpProvider();
  readonly auth: IProviderAuth = new OpenClaudeProviderAuth();
  readonly sessions: IProviderSessions = new OpenClaudeSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new OpenClaudeSessionSynchronizer();

  constructor() {
    super('openclaude');
  }
}

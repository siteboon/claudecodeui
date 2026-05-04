import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { ClaudeProviderAuth } from '@/modules/providers/list/claude/claude-auth.provider.js';
import { ClaudeMcpProvider } from '@/modules/providers/list/claude/claude-mcp.provider.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import type { IProviderAuth, IProviderSessionSynchronizer, IProviderSessions } from '@/shared/interfaces.js';

export class ClaudeProvider extends AbstractProvider {
  readonly mcp = new ClaudeMcpProvider();
  readonly auth: IProviderAuth = new ClaudeProviderAuth();
  readonly sessions: IProviderSessions = new ClaudeSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new ClaudeSessionSynchronizer();

  constructor() {
    super('claude');
  }
}

import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { ClaudeProviderAuth } from '@/modules/providers/list/claude/claude-auth.provider.js';
import { ClaudeMcpProvider } from '@/modules/providers/list/claude/claude-mcp.provider.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import type { IProviderAuth, IProviderSessions } from '@/shared/interfaces.js';

export class ClaudeProvider extends AbstractProvider {
  readonly mcp = new ClaudeMcpProvider();
  readonly auth: IProviderAuth = new ClaudeProviderAuth();
  readonly sessions: IProviderSessions = new ClaudeSessionsProvider();

  constructor() {
    super('claude');
  }
}

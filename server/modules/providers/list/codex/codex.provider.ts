import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { CodexProviderAuth } from '@/modules/providers/list/codex/codex-auth.provider.js';
import { CodexMcpProvider } from '@/modules/providers/list/codex/codex-mcp.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import type { IProviderAuth, IProviderSessions } from '@/shared/interfaces.js';

export class CodexProvider extends AbstractProvider {
  readonly mcp = new CodexMcpProvider();
  readonly auth: IProviderAuth = new CodexProviderAuth();
  readonly sessions: IProviderSessions = new CodexSessionsProvider();

  constructor() {
    super('codex');
  }
}

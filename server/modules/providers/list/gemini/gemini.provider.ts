import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { GeminiProviderAuth } from '@/modules/providers/list/gemini/gemini-auth.provider.js';
import { GeminiMcpProvider } from '@/modules/providers/list/gemini/gemini-mcp.provider.js';
import { GeminiSessionsProvider } from '@/modules/providers/list/gemini/gemini-sessions.provider.js';
import type { IProviderAuth, IProviderSessions } from '@/shared/interfaces.js';

export class GeminiProvider extends AbstractProvider {
  readonly mcp = new GeminiMcpProvider();
  readonly auth: IProviderAuth = new GeminiProviderAuth();
  readonly sessions: IProviderSessions = new GeminiSessionsProvider();

  constructor() {
    super('gemini');
  }
}

import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { CodexMcpProvider } from '@/modules/providers/list/codex/codex-mcp.provider.js';

export class CodexProvider extends AbstractProvider {
  readonly mcp = new CodexMcpProvider();

  constructor() {
    super('codex');
  }
}

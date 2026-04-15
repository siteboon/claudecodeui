import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { ClaudeMcpProvider } from '@/modules/providers/list/claude/claude-mcp.provider.js';

export class ClaudeProvider extends AbstractProvider {
  readonly mcp = new ClaudeMcpProvider();

  constructor() {
    super('claude');
  }
}

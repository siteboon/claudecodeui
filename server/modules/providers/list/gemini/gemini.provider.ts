import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { GeminiMcpProvider } from '@/modules/providers/list/gemini/gemini-mcp.provider.js';

export class GeminiProvider extends AbstractProvider {
  readonly mcp = new GeminiMcpProvider();

  constructor() {
    super('gemini');
  }
}

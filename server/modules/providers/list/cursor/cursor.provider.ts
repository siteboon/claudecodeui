import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { CursorMcpProvider } from '@/modules/providers/list/cursor/cursor-mcp.provider.js';

export class CursorProvider extends AbstractProvider {
  readonly mcp = new CursorMcpProvider();

  constructor() {
    super('cursor');
  }
}

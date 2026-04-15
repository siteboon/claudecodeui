import type { IProvider, IProviderMcpRuntime } from '@/shared/interfaces.js';
import type { LLMProvider } from '@/shared/types.js';

/**
 * Shared MCP-only provider base.
 */
export abstract class AbstractProvider implements IProvider {
  readonly id: LLMProvider;
  abstract readonly mcp: IProviderMcpRuntime;

  protected constructor(id: LLMProvider) {
    this.id = id;
  }
}

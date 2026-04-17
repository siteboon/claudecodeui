import type { IProvider, IProviderMcpRuntime } from '@/shared/interfaces.js';
import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  NormalizedMessage,
} from '@/shared/types.js';

/**
 * Shared provider base.
 *
 * Concrete providers must implement message normalization and history loading
 * because both behaviors depend on each provider's native SDK/CLI event format.
 */
export abstract class AbstractProvider implements IProvider {
  readonly id: LLMProvider;
  abstract readonly mcp: IProviderMcpRuntime;

  protected constructor(id: LLMProvider) {
    this.id = id;
  }

  abstract normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[];

  abstract fetchHistory(
    sessionId: string,
    options?: FetchHistoryOptions,
  ): Promise<FetchHistoryResult>;
}

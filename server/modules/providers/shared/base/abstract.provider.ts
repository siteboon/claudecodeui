import type { IProvider, IProviderAuthRuntime, IProviderMcpRuntime } from '@/shared/interfaces.js';
import type {
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  NormalizedMessage,
} from '@/shared/types.js';

/**
 * Shared provider base.
 *
 * Concrete providers must expose auth/MCP runtimes and implement message
 * normalization/history loading because those behaviors depend on native
 * SDK/CLI formats.
 */
export abstract class AbstractProvider implements IProvider {
  readonly id: LLMProvider;
  abstract readonly mcp: IProviderMcpRuntime;
  abstract readonly auth: IProviderAuthRuntime;

  protected constructor(id: LLMProvider) {
    this.id = id;
  }

  abstract normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[];

  abstract fetchHistory(
    sessionId: string,
    options?: FetchHistoryOptions,
  ): Promise<FetchHistoryResult>;
}

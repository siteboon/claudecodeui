import { providerRuntimeRegistry } from '@/modules/providers/provider-runtime.registry.js';
import type {
  IProviderRuntime,
  ProviderPermissionDecision,
  ProviderRunFunction,
  ProviderRuntimeWriter,
} from '@/shared/interfaces.js';
import type { AnyRecord, LLMProvider } from '@/shared/types.js';

type ProviderRuntimeRegistryGateway = {
  hasRuntime(provider: string): boolean;
  listRuntimes(): IProviderRuntime[];
  resolveRuntime(provider: string): IProviderRuntime;
};

/**
 * Creates the application-facing provider runtime dispatcher.
 *
 * Consumers dispatch by provider id and never import concrete SDK/CLI files.
 * Tests can supply a small registry fake without starting real provider tools.
 */
export function createProviderRuntimeService(
  runtimeRegistry: ProviderRuntimeRegistryGateway = providerRuntimeRegistry,
) {
  const run = (
    provider: LLMProvider,
    command: string,
    options: AnyRecord,
    writer: ProviderRuntimeWriter,
  ): Promise<unknown> => runtimeRegistry.resolveRuntime(provider).run(command, options, writer);

  return {
    run,

    hasRuntime(provider: string): boolean {
      return runtimeRegistry.hasRuntime(provider);
    },

    getRunner(provider: LLMProvider): ProviderRunFunction {
      return (command, options, writer) => run(provider, command, options, writer);
    },

    async abort(provider: LLMProvider, sessionId: string): Promise<boolean> {
      return Boolean(await runtimeRegistry.resolveRuntime(provider).abort(sessionId));
    },

    resolveToolApproval(requestId: string, decision: ProviderPermissionDecision): void {
      for (const runtime of runtimeRegistry.listRuntimes()) {
        runtime.permissions?.resolve(requestId, decision);
      }
    },

    getPendingApprovalsForSession(sessionId: string): unknown[] {
      return runtimeRegistry.listRuntimes().flatMap(
        (runtime) => runtime.permissions?.listPending(sessionId) ?? [],
      );
    },
  };
}

export const providerRuntimeService = createProviderRuntimeService();

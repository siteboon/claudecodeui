import { askClaudeSideQuestionFromHistory } from '@/modules/providers/list/claude/claude-side-question.provider.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import type { IProvider } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  LLMProvider,
  NormalizedMessage,
  ProviderPermissionDecision,
  ProviderRunFunction,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
  SideQuestionOutcome,
  SideQuestionRequest,
  SideQuestionSink,
} from '@/shared/types.js';

type ProviderRuntimeServiceDependencies = {
  listProviders(): IProvider[];
  resolveProvider(provider: string): IProvider;
  resolveProviderSessionId(sessionId: string | null | undefined): string | null;
  resolveResumeModel(
    provider: LLMProvider,
    sessionId: string | undefined,
    requestedModel?: string | null,
  ): Promise<string | undefined>;
  getProviderModels: typeof providerModelsService.getProviderModels;
  /**
   * The session's whole text history, for the side-question history
   * fallback. Default fetches every page; a side question reads the whole
   * conversation, not just the first window of it.
   */
  fetchSessionHistory(appSessionId: string): Promise<NormalizedMessage[]>;
  /**
   * Builds the SDK query for a side-question fork/history run. Production
   * leaves this unset so each path uses the SDK's own; tests supply a
   * scripted stream.
   */
  createQuery?: ProviderRuntimeContext['createQuery'];
};

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error ?? 'The side question failed for an unknown reason.');
}

const defaultDependencies: ProviderRuntimeServiceDependencies = {
  listProviders: () => providerRegistry.listProviders(),
  resolveProvider: (provider) => providerRegistry.resolveProvider(provider),
  resolveProviderSessionId: (sessionId) => sessionsService.resolveProviderSessionId(sessionId),
  resolveResumeModel: (provider, sessionId, requestedModel) =>
    providerModelsService.resolveResumeModel(provider, sessionId, requestedModel),
  getProviderModels: (provider) => providerModelsService.getProviderModels(provider),
  fetchSessionHistory: async (appSessionId) => {
    const history = await sessionsService.fetchHistory(appSessionId, { limit: null });
    return history.messages;
  },
};

/**
 * Creates the application-facing provider runtime dispatcher.
 *
 * The provider registry owns each concrete runtime. This service supplies the
 * registry-backed model/session lookups at execution time so runtime adapters
 * never import services that resolve back through the registry.
 */
export function createProviderRuntimeService(
  dependencyOverrides: Partial<ProviderRuntimeServiceDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  const createRuntimeContext = (
    provider: IProvider,
  ): ProviderRuntimeContext => ({
    resolveProviderSessionId: dependencies.resolveProviderSessionId,
    resolveResumeModel: (sessionId, requestedModel) =>
      dependencies.resolveResumeModel(provider.id, sessionId, requestedModel),
    getProviderModels: async () => dependencies.getProviderModels(provider.id),
    normalizeMessage: (raw, sessionId) => provider.sessions.normalizeMessage(raw, sessionId),
    async isProviderInstalled() {
      try {
        return (await provider.auth.getStatus()).installed;
      } catch {
        // Preserve the runtime's original error when installation probing fails.
        return true;
      }
    },
  });

  const run = (
    providerName: LLMProvider,
    command: string,
    options: AnyRecord,
    writer: ProviderRuntimeWriter,
  ): Promise<unknown> => {
    const provider = dependencies.resolveProvider(providerName);
    return provider.runtime.run(command, options, writer, createRuntimeContext(provider));
  };

  return {
    run,

    hasRuntime(providerName: string): boolean {
      try {
        return Boolean(dependencies.resolveProvider(providerName).runtime);
      } catch {
        return false;
      }
    },

    getRunner(provider: LLMProvider): ProviderRunFunction {
      return (command, options, writer) => run(provider, command, options, writer);
    },

    async abort(providerName: LLMProvider, sessionId: string): Promise<boolean> {
      return Boolean(await dependencies.resolveProvider(providerName).runtime.abort(sessionId));
    },

    async stopBackgroundTask(providerName: LLMProvider, sessionId: string, taskId: string): Promise<boolean> {
      // A runtime that never holds background work has no task to stop.
      const { runtime } = dependencies.resolveProvider(providerName);
      return Boolean(await runtime.stopBackgroundTask?.(sessionId, taskId));
    },

    hasBackgroundWork(sessionId: string): boolean {
      return dependencies.listProviders().some((provider) =>
        (provider.runtime.listBackgroundWork?.() ?? []).some((entry) => entry.sessionId === sessionId));
    },

    resolveToolApproval(requestId: string, decision: ProviderPermissionDecision): void {
      for (const provider of dependencies.listProviders()) {
        provider.runtime.permissions?.resolve(requestId, decision);
      }
    },

    getPendingApprovalsForSession(sessionId: string): unknown[] {
      return dependencies.listProviders().flatMap(
        (provider) => provider.runtime.permissions?.listPending(sessionId) ?? [],
      );
    },

    async askSideQuestion(
      providerName: LLMProvider,
      request: SideQuestionRequest,
      sink: SideQuestionSink,
    ): Promise<SideQuestionOutcome> {
      let provider: IProvider;
      try {
        provider = dependencies.resolveProvider(providerName);
      } catch (error) {
        return { status: 'error', error: errorMessage(error), answer: '' };
      }

      const context: ProviderRuntimeContext = {
        ...createRuntimeContext(provider),
        createQuery: dependencies.createQuery,
      };

      if (provider.runtime.askSideQuestion) {
        try {
          return await provider.runtime.askSideQuestion(request, sink, context);
        } catch (error) {
          return { status: 'error', error: errorMessage(error), answer: '' };
        }
      }

      // No native fork: fall back to Claude reading the session's own history.
      let history: NormalizedMessage[];
      try {
        history = await dependencies.fetchSessionHistory(request.appSessionId);
      } catch (error) {
        return { status: 'error', error: errorMessage(error), answer: '' };
      }

      try {
        return await askClaudeSideQuestionFromHistory(request, history, sink, {
          createQuery: dependencies.createQuery,
        });
      } catch (error) {
        return { status: 'error', error: errorMessage(error), answer: '' };
      }
    },
  };
}

export const providerRuntimeService = createProviderRuntimeService();

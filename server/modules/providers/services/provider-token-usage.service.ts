import { sessionsDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { IProvider } from '@/shared/interfaces.js';
import type { AnyRecord, ProviderQuotaData, ProviderTokenUsageResult } from '@/shared/types.js';
export { summarizeClaudeTokenUsage } from './claude-usage.js';
import { AppError } from '@/shared/utils.js';

type SessionRow = NonNullable<ReturnType<typeof sessionsDb.getSessionById>>;

type ProviderTokenUsageServiceDependencies = {
  getSessionById: (sessionId: string) => SessionRow | null | undefined;
  resolveProvider: (provider: string) => Pick<IProvider, 'sessions' | 'auth'>;
  isProviderSessionSuperseded: (providerSessionId: string, provider: string) => boolean;
};

const defaultDependencies: ProviderTokenUsageServiceDependencies = {
  getSessionById: (sessionId) => sessionsDb.getSessionById(sessionId),
  resolveProvider: (provider) => providerRegistry.resolveProvider(provider),
  isProviderSessionSuperseded: (providerSessionId, provider) => {
    try {
      return sessionsDb.isProviderSessionSuperseded(providerSessionId, provider);
    } catch {
      // No database context (unit tests, early startup): treat as live so the
      // provider facet still answers.
      return false;
    }
  },
};

/**
 * Builds the explicit "this provider cannot report usage" answer for session
 * rows whose provider adapter does not implement the optional
 * `IProviderSessions.getTokenUsage` facet (Cursor today).
 */
function createUnsupportedTokenUsage(provider: string): ProviderTokenUsageResult {
  return {
    used: 0,
    total: 0,
    inputTokens: 0,
    outputTokens: 0,
    breakdown: { input: 0, output: 0 },
    unsupported: true,
    message: `Token usage tracking not available for ${provider} sessions`,
  };
}

/**
 * Creates the provider token-usage service used by the provider routes.
 *
 * Pure dispatcher: it resolves the app-facing session row, maps it to the
 * provider-native session identity, and hands the read to the owning
 * provider's sessions/auth facet. Every provider-specific storage detail
 * (transcript layouts, SQLite schemas, context windows) lives in the provider
 * adapters; the provider test suite supplies isolated session/registry
 * dependencies so dispatch can be exercised without touching real data.
 */
export function createProviderTokenUsageService(
  dependencyOverrides: Partial<ProviderTokenUsageServiceDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  return {
    /**
     * Resolves the provider adapter from one app-facing session id and
     * returns the latest usage snapshot for that provider.
     */
    async getSessionTokenUsage(sessionId: string): Promise<ProviderTokenUsageResult> {
      const session = dependencies.getSessionById(sessionId);
      if (!session) {
        throw new AppError(`Session "${sessionId}" was not found.`, {
          code: 'SESSION_NOT_FOUND',
          statusCode: 404,
        });
      }

      // The fallback covers rows whose provider id was never recorded, and for
      // a session discovered from disk the app id *is* its provider id. That
      // stops being true the moment an edit rewinds the conversation off a
      // thread: until the replacement run announces its own id, the fallback
      // would resolve the retired transcript and report the discarded
      // conversation's usage against an empty one.
      if (
        !session.provider_session_id
        && dependencies.isProviderSessionSuperseded(sessionId, session.provider)
      ) {
        return {
          used: 0,
          inputTokens: 0,
          outputTokens: 0,
          breakdown: { input: 0, output: 0 },
        };
      }

      const provider = dependencies.resolveProvider(session.provider);
      if (!provider.sessions.getTokenUsage) {
        return createUnsupportedTokenUsage(session.provider);
      }

      return provider.sessions.getTokenUsage({
        appSessionId: sessionId,
        nativeSessionId: session.provider_session_id || sessionId,
        jsonlPath: session.jsonl_path ?? null,
        projectPath: session.project_path ?? null,
      });
    },

    /**
     * Retrieves account-level quota status (5-hour and weekly limits) for
     * providers that expose the optional auth facet method, null otherwise.
     */
    async getProviderQuota(
      provider: string,
      options?: { forceRefresh?: boolean },
    ): Promise<ProviderQuotaData | null> {
      return dependencies.resolveProvider(provider).auth.getQuota?.(options) ?? null;
    },
  };
}

/**
 * Used by the provider routes to serve token usage from only an app session id.
 */
export const providerTokenUsageService = createProviderTokenUsageService();


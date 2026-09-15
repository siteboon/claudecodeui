/**
 * Supported providers with account-level quota reporting capabilities.
 *
 * Used by CommandResultModal to determine whether to render the quota card.
 */
export type QuotaProvider = 'antigravity' | 'codex' | 'zcode';

const QUOTA_PROVIDERS = new Set<string>(['antigravity', 'codex', 'zcode']);

/**
 * Resolves whether a provider supports account-level quota reporting.
 *
 * Used by CommandResultModal in the chat module.
 */
export function resolveQuotaProvider(provider: string | undefined): QuotaProvider | null {
  return provider && QUOTA_PROVIDERS.has(provider) ? provider as QuotaProvider : null;
}

/**
 * Builds the backend URL to query account quota for a supported provider.
 *
 * Used by CommandResultModal in the chat module.
 */
export function buildProviderQuotaUrl(provider: QuotaProvider, forceRefresh = false): string {
  const searchParams = new URLSearchParams({ provider });
  if (forceRefresh) {
    searchParams.set('refresh', 'true');
  }
  return `/api/providers/quota?${searchParams.toString()}`;
}

/**
 * Determines whether a quota group corresponds to the active session model.
 *
 * Rules:
 * 1. If provider only has 1 quota group (e.g. Codex, ZCode), it represents the active session.
 * 2. If provider has multiple groups (e.g. Antigravity), matches against model name semantics.
 */
export function resolveIsActiveQuotaGroup(
  currentModel: string | undefined,
  group: { name: string; description?: string },
  totalGroupsCount: number,
): boolean {
  if (totalGroupsCount <= 1) {
    return true;
  }

  const groupText = `${group.name} ${group.description || ''}`.toLowerCase();
  const normalizedModel = (currentModel || '').toLowerCase();

  if (normalizedModel.includes('gemini')) {
    return groupText.includes('gemini');
  }
  if (normalizedModel.includes('claude')) {
    return groupText.includes('claude');
  }
  if (normalizedModel.includes('gpt')) {
    return groupText.includes('gpt');
  }
  if (normalizedModel.includes('glm')) {
    return groupText.includes('glm') || groupText.includes('zcode');
  }

  return Boolean(normalizedModel && groupText.includes(normalizedModel));
}

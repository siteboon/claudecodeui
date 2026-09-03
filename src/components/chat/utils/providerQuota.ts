export type QuotaProvider = 'antigravity' | 'codex';

const QUOTA_PROVIDERS = new Set<string>(['antigravity', 'codex']);

export function resolveQuotaProvider(provider: string | undefined): QuotaProvider | null {
  return provider && QUOTA_PROVIDERS.has(provider) ? provider as QuotaProvider : null;
}

export function buildProviderQuotaUrl(provider: QuotaProvider, forceRefresh = false): string {
  const searchParams = new URLSearchParams({ provider });
  if (forceRefresh) {
    searchParams.set('refresh', 'true');
  }
  return `/api/providers/quota?${searchParams.toString()}`;
}

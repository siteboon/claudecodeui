import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider } from '@/shared/types';

/**
 * The backend-owned answer to "what can this provider actually do".
 *
 * Only the fields consumers outside chat need are declared; the matrix itself
 * is larger and lives in `provider-capabilities.service.ts`.
 */
type ProviderCapabilityRow = {
  provider: LLMProvider;
  supportsSessionForking?: boolean;
};

/**
 * Cached at module scope because the matrix is static for the life of the
 * server process and more than one part of the UI asks for it. Without this,
 * opening the sidebar would refetch it on every mount.
 */
let cachedCapabilities: Partial<Record<LLMProvider, ProviderCapabilityRow>> | null = null;
let inFlightRequest: Promise<Partial<Record<LLMProvider, ProviderCapabilityRow>>> | null = null;

async function loadCapabilities(): Promise<Partial<Record<LLMProvider, ProviderCapabilityRow>>> {
  if (cachedCapabilities) {
    return cachedCapabilities;
  }
  if (inFlightRequest) {
    return inFlightRequest;
  }

  inFlightRequest = (async () => {
    try {
      const response = await api.providers.capabilities();
      const body = (await response.json()) as { success?: boolean; data?: { providers?: ProviderCapabilityRow[] } };
      const rows = body.success && Array.isArray(body.data?.providers) ? body.data.providers : [];
      const byProvider: Partial<Record<LLMProvider, ProviderCapabilityRow>> = {};
      for (const row of rows) {
        byProvider[row.provider] = row;
      }
      cachedCapabilities = byProvider;
      return byProvider;
    } catch (error) {
      console.error('Error loading provider capabilities:', error);
      // Not cached: a transient failure should not disable affordances for the
      // rest of the session.
      return {};
    } finally {
      inFlightRequest = null;
    }
  })();

  return inFlightRequest;
}

/**
 * Reports which providers can branch a session's transcript.
 *
 * Empty until the matrix loads, so an affordance is never offered and then
 * withdrawn.
 */
export function useSessionForkingProviders(): Set<LLMProvider> {
  const [providers, setProviders] = useState<Set<LLMProvider>>(() => new Set());

  useEffect(() => {
    let cancelled = false;

    void loadCapabilities().then((capabilities) => {
      if (cancelled) return;
      const forkable = new Set<LLMProvider>();
      for (const row of Object.values(capabilities)) {
        if (row?.supportsSessionForking) {
          forkable.add(row.provider);
        }
      }
      setProviders(forkable);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return providers;
}

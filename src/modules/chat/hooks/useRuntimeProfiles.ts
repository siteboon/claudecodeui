import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider, ProviderRuntimeProfileSummary } from '@/shared/types';

const PROVIDERS: readonly LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode'];
const storageKey = (provider: LLMProvider): string => `runtime-profile:${provider}`;

type RuntimeProfilesApiResponse = {
  success?: boolean;
  data?: { profiles?: ProviderRuntimeProfileSummary[] };
};

const readStoredSelections = (): Record<LLMProvider, string> => PROVIDERS.reduce(
  (selections, provider) => {
    selections[provider] = localStorage.getItem(storageKey(provider)) || 'default';
    return selections;
  },
  {} as Record<LLMProvider, string>,
);

/** Loads public profile names and remembers one new-chat default per provider. */
export function useRuntimeProfiles(provider: LLMProvider) {
  // Only ids and display metadata reach the browser; executable paths and env
  // values stay in the backend's operator-owned configuration.
  const [profiles, setProfiles] = useState<ProviderRuntimeProfileSummary[]>([]);
  // A separate choice per provider prevents switching models/providers from
  // accidentally applying (for example) a Codex account profile to Claude.
  const [selectedByProvider, setSelectedByProvider] = useState<Record<LLMProvider, string>>(
    readStoredSelections,
  );
  // Discovery failures must remain distinguishable from an empty profile list.
  const [error, setError] = useState<string | null>(null);
  // The new-chat view uses loading to prevent duplicate retry requests.
  const [loading, setLoading] = useState(true);
  // A retry starts a fresh effect and cancels stale responses from its predecessor.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        const response = await api.providers.runtimeProfiles();
        const body = (await response.json()) as RuntimeProfilesApiResponse;
        if (cancelled) return;
        if (response.ok === false || !body.success || !Array.isArray(body.data?.profiles)) {
          throw new Error('Could not load CLI environments.');
        }
        setProfiles(body.data.profiles);
        setSelectedByProvider((current) => {
          const next = { ...current };
          for (const targetProvider of PROVIDERS) {
            const available = body.data?.profiles?.some(
              (profile) => profile.provider === targetProvider && profile.id === next[targetProvider],
            );
            if (!available) {
              next[targetProvider] = 'default';
              localStorage.setItem(storageKey(targetProvider), 'default');
            }
          }
          return next;
        });
      } catch {
        if (!cancelled) setError('Could not load CLI environments.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const providerProfiles = useMemo(
    () => profiles.filter((profile) => profile.provider === provider),
    [profiles, provider],
  );
  const selectedRuntimeProfileId = selectedByProvider[provider] || 'default';

  const selectRuntimeProfile = useCallback((profileId: string) => {
    setSelectedByProvider((current) => ({ ...current, [provider]: profileId }));
    localStorage.setItem(storageKey(provider), profileId);
  }, [provider]);

  return { providerProfiles, selectedRuntimeProfileId, selectRuntimeProfile, error, loading, retry };
}

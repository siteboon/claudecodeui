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

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await api.providers.runtimeProfiles();
        const body = (await response.json()) as RuntimeProfilesApiResponse;
        if (cancelled || !body.success || !Array.isArray(body.data?.profiles)) {
          return;
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
      } catch (error) {
        console.error('Error loading runtime profiles:', error);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const providerProfiles = useMemo(
    () => profiles.filter((profile) => profile.provider === provider),
    [profiles, provider],
  );
  const selectedRuntimeProfileId = selectedByProvider[provider] || 'default';

  const selectRuntimeProfile = useCallback((profileId: string) => {
    setSelectedByProvider((current) => ({ ...current, [provider]: profileId }));
    localStorage.setItem(storageKey(provider), profileId);
  }, [provider]);

  return { providerProfiles, selectedRuntimeProfileId, selectRuntimeProfile };
}

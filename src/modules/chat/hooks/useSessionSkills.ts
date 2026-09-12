import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider, ProviderSkill } from '@/shared/types';

type UseSessionSkillsArgs = {
  provider: LLMProvider;
  /** Workspace whose project-scoped skills join the global ones. */
  projectPath: string | null;
  /** Only fetches while the info panel is open. */
  enabled: boolean;
};

/**
 * The skills visible to one provider, for the panel's sources section.
 *
 * Read through the existing skills endpoint (the same one the skills manager
 * uses) — no parallel data path. Like the panel's other REST reads, a closed
 * panel never polls; the list refreshes when it (re)opens or the
 * provider/workspace changes.
 */
export function useSessionSkills({ provider, projectPath, enabled }: UseSessionSkillsArgs) {
  const [skills, setSkills] = useState<ProviderSkill[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setSkills([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const response = await api.providers.skills(provider, {
          workspacePath: projectPath ?? undefined,
        });
        if (!response.ok) {
          if (!cancelled) setSkills([]);
          return;
        }
        const payload = (await response.json()) as { data?: { skills?: ProviderSkill[] } };
        if (!cancelled) setSkills(payload.data?.skills ?? []);
      } catch {
        if (!cancelled) setSkills([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, provider, projectPath]);

  return { skills, loading };
}

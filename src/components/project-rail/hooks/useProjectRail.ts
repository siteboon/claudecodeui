import { useMemo } from 'react';
import type { Project, SessionStatus } from '../../../types/app';
import type { AdditionalSessionsByProject } from '../../sidebar/types/types';
import { getAllSessions } from '../../sidebar/utils/utils';
import type { ProjectRailItemData } from '../types/types';

function abbreviate(name: string): string {
  const clean = name.replace(/^[@.]/, '');
  const words = clean.split(/[-_\s/]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

type UseProjectRailArgs = {
  projects: Project[];
  statusMap: Map<string, SessionStatus>;
  additionalSessions: AdditionalSessionsByProject;
  excludeSessionId?: string | null;
};

export function useProjectRail({
  projects,
  statusMap,
  additionalSessions,
  excludeSessionId,
}: UseProjectRailArgs): {
  railItems: ProjectRailItemData[];
  totalAttentionCount: number;
} {
  return useMemo(() => {
    // Dedupe attention counts across projects — the backend groups sessions
    // by .jsonl cwd, so overlapping project paths (repo + worktree, etc.)
    // can surface the same session id in multiple buckets.
    const countedForAttention = new Set<string>();
    let totalAttention = 0;

    const items: ProjectRailItemData[] = projects.map((project) => {
      const sessions = getAllSessions(project, additionalSessions);
      let attn = 0;

      for (const s of sessions) {
        if (excludeSessionId && s.id === excludeSessionId) continue;
        if (countedForAttention.has(s.id)) continue;
        const st = statusMap.get(s.id);
        if (st === 'waiting' || st === 'error') {
          countedForAttention.add(s.id);
          attn++;
        }
      }

      totalAttention += attn;

      return {
        name: project.name,
        displayName: project.displayName || project.name,
        abbreviation: abbreviate(project.displayName || project.name),
        attentionCount: attn,
        sessionCount: sessions.length,
      };
    });

    // Only show projects that have sessions
    const filtered = items.filter((item) => item.sessionCount > 0);

    return { railItems: filtered, totalAttentionCount: totalAttention };
  }, [projects, statusMap, additionalSessions, excludeSessionId]);
}

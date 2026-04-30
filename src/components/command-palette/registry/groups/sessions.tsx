import { useMemo } from 'react';
import { MessageSquare } from 'lucide-react';

import { useSessionsSource } from '../../sources/useSessionsSource';
import { useSessionMessageSearch } from '../../sources/useSessionMessageSearch';
import type { GroupConfig } from '../types';

export const sessionsGroup: GroupConfig = {
  id: 'sessions',
  heading: 'Sessions',
  modes: ['mixed'],
  requiresProject: true,
  useItems: (ctx) => {
    const { items: sessions } = useSessionsSource(ctx.projectId, ctx.enabled);
    const { items: messageMatches } = useSessionMessageSearch(
      ctx.projectId,
      ctx.query,
      ctx.enabled,
    );

    type Row = { id: string; label: string; provider?: string; snippet?: string };
    return useMemo(() => {
      const byId = new Map<string, Row>();
      for (const s of sessions) {
        byId.set(s.id, { id: s.id, label: s.label, provider: s.provider });
      }
      for (const m of messageMatches) {
        const existing = byId.get(m.sessionId);
        if (existing) {
          existing.snippet = m.snippet;
        } else {
          byId.set(m.sessionId, {
            id: m.sessionId,
            label: m.label,
            provider: m.provider,
            snippet: m.snippet,
          });
        }
      }
      return Array.from(byId.values()).map((s) => ({
        key: `session-${s.id}`,
        value: `${s.label} ${s.snippet ?? ''}`.trim(),
        onSelect: () => ctx.run(() => ctx.navigate(`/session/${s.id}`)),
        node: (
          <>
            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{s.label}</span>
              {s.snippet && (
                <span className="truncate text-xs text-muted-foreground">{s.snippet}</span>
              )}
            </div>
            {s.provider && (
              <span className="text-xs text-muted-foreground">{s.provider}</span>
            )}
          </>
        ),
      }));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessions, messageMatches]);
  },
};

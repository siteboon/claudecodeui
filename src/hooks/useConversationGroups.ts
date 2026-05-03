import type { SessionWithProvider } from '../components/sidebar/types/types';

export type DateGroup = 'pinned' | 'today' | 'yesterday' | 'previous7days' | 'previous30days' | string;

export interface GroupedConversations {
  group: DateGroup;
  label: string;
  sessions: SessionWithProvider[];
}

function getSessionDate(session: SessionWithProvider): Date {
  const raw = session.lastActivity || session.createdAt || session.created_at;
  return raw ? new Date(raw) : new Date(0);
}

function getGroupLabel(group: DateGroup): string {
  switch (group) {
    case 'pinned': return 'Pinned';
    case 'today': return 'Today';
    case 'yesterday': return 'Yesterday';
    case 'previous7days': return 'Previous 7 Days';
    case 'previous30days': return 'Previous 30 Days';
    default: return group;
  }
}

const GROUP_ORDER: Record<string, number> = {
  pinned: 0,
  today: 1,
  yesterday: 2,
  previous7days: 3,
  previous30days: 4,
};

export function groupConversationsByDate(
  sessions: SessionWithProvider[],
  pinnedIds?: Set<string>,
): GroupedConversations[] {
  if (sessions.length === 0) return [];

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const weekAgo = new Date(today.getTime() - 7 * 86_400_000);
  const monthAgo = new Date(today.getTime() - 30 * 86_400_000);

  const groups = new Map<DateGroup, SessionWithProvider[]>();

  const sorted = [...sessions].sort(
    (a, b) => getSessionDate(b).getTime() - getSessionDate(a).getTime(),
  );

  for (const session of sorted) {
    if (pinnedIds?.has(session.id)) {
      if (!groups.has('pinned')) groups.set('pinned', []);
      groups.get('pinned')!.push(session);
      continue;
    }

    const date = getSessionDate(session);
    let group: DateGroup;

    if (date >= today) {
      group = 'today';
    } else if (date >= yesterday) {
      group = 'yesterday';
    } else if (date >= weekAgo) {
      group = 'previous7days';
    } else if (date >= monthAgo) {
      group = 'previous30days';
    } else {
      group = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(date);
    }

    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(session);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => {
      const oa = GROUP_ORDER[a] ?? 100;
      const ob = GROUP_ORDER[b] ?? 100;
      if (oa !== ob) return oa - ob;
      return 0;
    })
    .map(([group, groupSessions]) => ({
      group,
      label: getGroupLabel(group),
      sessions: groupSessions,
    }));
}

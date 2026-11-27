import type { TFunction } from 'i18next';

import type { RecentConversationListItem, SidebarProjectListProps } from '@/shared/types';
import { getSessionName, getSessionTime } from '@/modules/sidebar/utils/sidebarProjectFormatting';

/** A session still counts as active for this long after it was last used. */
const RECENT_ACTIVITY_WINDOW_MS = 60 * 60 * 1000;

/**
 * Each admitted session's place in the Active list for this page load, higher
 * first. Rows join as they become active but only leave on a reload, and keep
 * their rank, so the list never reorders or shrinks under the pointer.
 */
const rankBySessionId = new Map<string, number>();
let nextRank = 0;

/** Sessions running, waiting on the user or used within the last hour, across every project, newest to join first. */
export function getActiveConversations(
  { projects, getProjectSessions, activeSessions, attentionSessionIds, currentTime }: SidebarProjectListProps,
  t: TFunction,
): RecentConversationListItem[] {
  const now = currentTime.getTime();
  const rows = projects.flatMap((project) => getProjectSessions(project).map((session) => ({
    project,
    session,
    lastActivity: getSessionTime(session),
  })));

  const isActive = ({ session, lastActivity }: (typeof rows)[number]) => activeSessions.has(session.id)
    || attentionSessionIds.has(session.id)
    || now - new Date(lastActivity).getTime() < RECENT_ACTIVITY_WINDOW_MS;

  // A batch that joins together (the whole list on page load) is ranked once by
  // activity, oldest first, so its most recent session lands on top.
  rows
    .filter((row) => !rankBySessionId.has(row.session.id) && isActive(row))
    .sort((a, b) => a.lastActivity.localeCompare(b.lastActivity))
    .forEach(({ session }) => rankBySessionId.set(session.id, nextRank++));

  const rank = (sessionId: string) => rankBySessionId.get(sessionId) ?? -1;
  return rows
    .filter(({ session }) => rankBySessionId.has(session.id))
    .sort((a, b) => rank(b.session.id) - rank(a.session.id))
    .map(({ project, session, lastActivity }) => ({
      sessionId: session.id,
      provider: session.__provider,
      projectId: project.projectId,
      projectDisplayName: project.displayName,
      sessionTitle: getSessionName(session, t),
      lastActivity,
    }));
}

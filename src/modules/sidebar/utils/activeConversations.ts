import type { TFunction } from 'i18next';

import type { RecentConversationListItem, SidebarProjectListProps } from '@/shared/types';
import { getSessionName, getSessionTime } from '@/modules/sidebar/utils/sidebarProjectFormatting';

/** A session still counts as active for this long after it was last used. */
const RECENT_ACTIVITY_WINDOW_MS = 60 * 60 * 1000;

/**
 * When each session joined the Active list during this page load. Rows join as
 * they become active but only leave on a reload, and keep the order they joined
 * in, so the list never reorders or shrinks under the pointer.
 */
const joinedAtBySessionId = new Map<string, number>();

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

  for (const { session, lastActivity } of rows) {
    const isActive = activeSessions.has(session.id)
      || attentionSessionIds.has(session.id)
      || now - new Date(lastActivity).getTime() < RECENT_ACTIVITY_WINDOW_MS;
    if (isActive && !joinedAtBySessionId.has(session.id)) {
      joinedAtBySessionId.set(session.id, now);
    }
  }

  const joinedAt = (sessionId: string) => joinedAtBySessionId.get(sessionId) ?? 0;
  return rows
    .filter(({ session }) => joinedAtBySessionId.has(session.id))
    // Rows that joined together (on page load) fall back to their last activity.
    .sort((a, b) => joinedAt(b.session.id) - joinedAt(a.session.id) || b.lastActivity.localeCompare(a.lastActivity))
    .map(({ project, session, lastActivity }) => ({
      sessionId: session.id,
      provider: session.__provider,
      projectId: project.projectId,
      projectDisplayName: project.displayName,
      sessionTitle: getSessionName(session, t),
      lastActivity,
    }));
}

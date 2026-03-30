import type {
  WorkspaceGroups,
  WorkspaceRecord,
  WorkspaceSession,
} from '@/components/refactored/sidebar/types';

const parseTimestamp = (timestamp: string | null | undefined): number => {
  if (!timestamp) {
    return 0;
  }

  // SQLite CURRENT_TIMESTAMP is UTC but does not include timezone metadata.
  // Convert it to an explicit UTC ISO-like string before parsing.
  const sqliteUtcPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  const normalizedTimestamp = sqliteUtcPattern.test(timestamp)
    ? `${timestamp.replace(' ', 'T')}Z`
    : timestamp;

  const parsed = new Date(normalizedTimestamp).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

export const sortSessionsByLastActivity = (
  sessions: WorkspaceSession[],
): WorkspaceSession[] =>
  [...sessions].sort((left, right) => {
    const timestampDiff =
      parseTimestamp(right.lastActivity) - parseTimestamp(left.lastActivity);

    if (timestampDiff !== 0) {
      return timestampDiff;
    }

    return right.sessionId.localeCompare(left.sessionId);
  });

export const sortWorkspacesByLastActivity = (
  workspaces: WorkspaceRecord[],
): WorkspaceRecord[] =>
  [...workspaces].sort((left, right) => {
    const timestampDiff =
      parseTimestamp(right.lastActivity) - parseTimestamp(left.lastActivity);

    if (timestampDiff !== 0) {
      return timestampDiff;
    }

    return left.workspaceDisplayName.localeCompare(right.workspaceDisplayName);
  });

export const splitWorkspacesByStarred = (
  workspaces: WorkspaceRecord[],
): WorkspaceGroups => {
  const starred = workspaces.filter((workspace) => workspace.isStarred);
  const unstarred = workspaces.filter((workspace) => !workspace.isStarred);

  return {
    starred: sortWorkspacesByLastActivity(starred),
    unstarred: sortWorkspacesByLastActivity(unstarred),
  };
};

export const getWorkspaceDisplayName = (workspace: WorkspaceRecord): string =>
  workspace.workspaceCustomName ||
  workspace.workspaceDisplayName ||
  workspace.workspaceOriginalPath;

export const getSessionDisplayName = (session: WorkspaceSession): string =>
  session.customName || session.summary || session.sessionId || 'Untitled Session';

export const formatRelativeTime = (timestamp: string | null | undefined): string => {
  if (!timestamp) {
    return '--';
  }

  const parsedTime = parseTimestamp(timestamp);
  if (!Number.isFinite(parsedTime)) {
    return '--';
  }

  const diffMs = Math.max(0, Date.now() - parsedTime);
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffMinutes < 1) {
    return '1m';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  if (diffDays < 30) {
    return `${diffDays}d`;
  }

  if (diffDays < 365) {
    return `${diffMonths}mo`;
  }

  return `${diffYears}y`;
};

export const isRecentActivity = (timestamp: string | null | undefined): boolean => {
  if (!timestamp) {
    return false;
  }

  const parsedTime = parseTimestamp(timestamp);
  if (!Number.isFinite(parsedTime)) {
    return false;
  }

  const diffMs = Math.max(0, Date.now() - parsedTime);
  return diffMs <= 10 * 60 * 1000;
};

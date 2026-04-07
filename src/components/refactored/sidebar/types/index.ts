import type { SessionProvider } from '@/types/app';

export type SearchMode = 'projects' | 'conversations';

export type WorkspaceSession = {
  sessionId: string;
  id: string;
  provider: SessionProvider;
  customName: string | null;
  summary: string;
  workspacePath: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
};

export type WorkspaceRecord = {
  workspaceId: string;
  workspaceOriginalPath: string;
  workspaceCustomName: string | null;
  workspaceDisplayName: string;
  isStarred: boolean;
  lastActivity: string | null;
  sessions: WorkspaceSession[];
};

export type WorkspaceDeleteTarget = {
  workspaceId: string;
  workspacePath: string;
  workspaceName: string;
  sessionCount: number;
};

export type SessionDeleteTarget = {
  sessionId: string;
  sessionName: string;
  workspacePath: string;
};

export type WorkspaceGroups = {
  starred: WorkspaceRecord[];
  unstarred: WorkspaceRecord[];
};

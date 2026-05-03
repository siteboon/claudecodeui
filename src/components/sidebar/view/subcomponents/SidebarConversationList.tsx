import { useMemo, useState, type MouseEvent } from 'react';
import type { TFunction } from 'i18next';
import type { Project, LLMProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { groupConversationsByDate } from '../../../../hooks/useConversationGroups';
import ConversationGroup from './ConversationGroup';
import ConversationContextMenu from './ConversationContextMenu';

type SessionWithProject = SessionWithProvider & { __parentProjectId: string };

export type SidebarConversationListProps = {
  projects: Project[];
  getProjectSessions: (project: Project) => SessionWithProvider[];
  selectedSessionId: string | null;
  onSessionClick: (session: SessionWithProvider, projectId: string) => void;
  onDeleteSession: (
    projectId: string,
    sessionId: string,
    title: string,
    provider: LLMProvider,
  ) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  t: TFunction;
};

export default function SidebarConversationList({
  projects,
  getProjectSessions,
  selectedSessionId,
  onSessionClick,
  onDeleteSession,
  onStartEditingSession,
  t,
}: SidebarConversationListProps) {
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('cloudcli-pinned-sessions');
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number };
    session: SessionWithProject;
  } | null>(null);

  const allSessions = useMemo(() => {
    const sessions: SessionWithProject[] = [];
    for (const project of projects) {
      for (const session of getProjectSessions(project)) {
        sessions.push({ ...session, __parentProjectId: project.projectId });
      }
    }
    return sessions;
  }, [projects, getProjectSessions]);

  const groups = useMemo(
    () => groupConversationsByDate(allSessions, pinnedIds.size > 0 ? pinnedIds : undefined),
    [allSessions, pinnedIds],
  );

  const handleSessionClick = (session: SessionWithProvider) => {
    const s = session as SessionWithProject;
    onSessionClick(session, s.__parentProjectId);
  };

  const handleMenuOpen = (e: MouseEvent, session: SessionWithProvider) => {
    e.preventDefault();
    setContextMenu({
      position: { x: e.clientX, y: e.clientY },
      session: session as SessionWithProject,
    });
  };

  const togglePin = (sessionId: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      localStorage.setItem('cloudcli-pinned-sessions', JSON.stringify([...next]));
      return next;
    });
  };

  if (allSessions.length === 0) {
    return (
      <div className="px-4 py-12 text-center md:py-8">
        <p className="text-sm text-muted-foreground">
          {t('sidebar:conversations.empty', { defaultValue: 'No conversations yet' })}
        </p>
      </div>
    );
  }

  return (
    <div className="pb-safe-area-inset-bottom md:space-y-1">
      {groups.map((group) => (
        <ConversationGroup
          key={group.group}
          label={group.label}
          sessions={group.sessions}
          selectedSessionId={selectedSessionId}
          onSessionClick={handleSessionClick}
          onMenuOpen={handleMenuOpen}
        />
      ))}

      {contextMenu && (
        <ConversationContextMenu
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
          onRename={() => {
            const s = contextMenu.session;
            onStartEditingSession(s.id, s.summary || s.title || s.id);
            setContextMenu(null);
          }}
          onPin={() => {
            togglePin(contextMenu.session.id);
            setContextMenu(null);
          }}
          onDelete={() => {
            const s = contextMenu.session;
            onDeleteSession(s.__parentProjectId, s.id, s.summary || s.title || s.id, s.__provider);
            setContextMenu(null);
          }}
        />
      )}
    </div>
  );
}

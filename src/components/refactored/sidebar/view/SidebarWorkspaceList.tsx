import type { WorkspaceRecord } from '@/components/refactored/sidebar/types';
import { SidebarWorkspaceItem } from '@/components/refactored/sidebar/view/SidebarWorkspaceItem';

type SidebarWorkspaceListProps = {
  workspacesCount: number;
  searchFilter: string;
  starredWorkspaces: WorkspaceRecord[];
  unstarredWorkspaces: WorkspaceRecord[];
  expandedWorkspaces: Set<string>;
  selectedSessionId: string | null;
  editingWorkspacePath: string | null;
  editingWorkspaceName: string;
  isSavingWorkspaceName: boolean;
  editingSessionId: string | null;
  editingSessionName: string;
  isSavingSessionName: boolean;
  onEditingWorkspaceNameChange: (name: string) => void;
  onEditingSessionNameChange: (name: string) => void;
  onToggleWorkspace: (workspacePath: string) => void;
  onToggleWorkspaceStar: (workspacePath: string) => void;
  onStartWorkspaceRename: (workspace: WorkspaceRecord) => void;
  onCancelWorkspaceRename: () => void;
  onSaveWorkspaceRename: () => void;
  onStartSessionRename: (session: WorkspaceRecord['sessions'][number]) => void;
  onCancelSessionRename: () => void;
  onSaveSessionRename: () => void;
  onDeleteWorkspace: (workspace: WorkspaceRecord) => void;
  onSessionSelect: (workspacePath: string, sessionId: string) => void;
  onSessionDelete: (workspacePath: string, sessionId: string) => void;
  onNewSession: () => void;
};

const SectionHeading = ({ title }: { title: string }) => (
  <div className="px-3 pb-1 pt-2">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
  </div>
);

const EmptyState = ({ title, description }: { title: string; description: string }) => (
  <div className="px-4 py-8 text-center">
    <h3 className="mb-2 text-sm font-medium text-foreground">{title}</h3>
    <p className="text-xs text-muted-foreground">{description}</p>
  </div>
);

/**
 * Component layer (The Face)
 * Displays Starred and regular workspace sections with shared item rendering.
 */
export function SidebarWorkspaceList({
  workspacesCount,
  searchFilter,
  starredWorkspaces,
  unstarredWorkspaces,
  expandedWorkspaces,
  selectedSessionId,
  editingWorkspacePath,
  editingWorkspaceName,
  isSavingWorkspaceName,
  editingSessionId,
  editingSessionName,
  isSavingSessionName,
  onEditingWorkspaceNameChange,
  onEditingSessionNameChange,
  onToggleWorkspace,
  onToggleWorkspaceStar,
  onStartWorkspaceRename,
  onCancelWorkspaceRename,
  onSaveWorkspaceRename,
  onStartSessionRename,
  onCancelSessionRename,
  onSaveSessionRename,
  onDeleteWorkspace,
  onSessionSelect,
  onSessionDelete,
  onNewSession,
}: SidebarWorkspaceListProps) {
  const visibleWorkspaceCount = starredWorkspaces.length + unstarredWorkspaces.length;

  if (workspacesCount === 0) {
    return (
      <EmptyState
        title="No workspaces yet"
        description="Create a project to start adding sessions."
      />
    );
  }

  if (visibleWorkspaceCount === 0) {
    return (
      <EmptyState
        title="No matches found"
        description={`No results for "${searchFilter}".`}
      />
    );
  }

  return (
    <div className="pb-safe-area-inset-bottom md:space-y-1">
      {starredWorkspaces.length > 0 && (
        <>
          <SectionHeading title="Starred" />
          {starredWorkspaces.map((workspace) => (
            <SidebarWorkspaceItem
              key={workspace.workspaceOriginalPath}
              workspace={workspace}
              isExpanded={expandedWorkspaces.has(workspace.workspaceOriginalPath)}
              selectedSessionId={selectedSessionId}
              editingWorkspacePath={editingWorkspacePath}
              editingWorkspaceName={editingWorkspaceName}
              isSavingWorkspaceName={isSavingWorkspaceName}
              editingSessionId={editingSessionId}
              editingSessionName={editingSessionName}
              isSavingSessionName={isSavingSessionName}
              onEditingWorkspaceNameChange={onEditingWorkspaceNameChange}
              onEditingSessionNameChange={onEditingSessionNameChange}
              onToggleWorkspace={onToggleWorkspace}
              onToggleWorkspaceStar={onToggleWorkspaceStar}
              onStartWorkspaceRename={onStartWorkspaceRename}
              onCancelWorkspaceRename={onCancelWorkspaceRename}
              onSaveWorkspaceRename={onSaveWorkspaceRename}
              onStartSessionRename={onStartSessionRename}
              onCancelSessionRename={onCancelSessionRename}
              onSaveSessionRename={onSaveSessionRename}
              onDeleteWorkspace={onDeleteWorkspace}
              onSessionSelect={onSessionSelect}
              onSessionDelete={onSessionDelete}
              onNewSession={onNewSession}
            />
          ))}
        </>
      )}

      {unstarredWorkspaces.length > 0 && (
        <>
          <SectionHeading title="Projects" />
          {unstarredWorkspaces.map((workspace) => (
            <SidebarWorkspaceItem
              key={workspace.workspaceOriginalPath}
              workspace={workspace}
              isExpanded={expandedWorkspaces.has(workspace.workspaceOriginalPath)}
              selectedSessionId={selectedSessionId}
              editingWorkspacePath={editingWorkspacePath}
              editingWorkspaceName={editingWorkspaceName}
              isSavingWorkspaceName={isSavingWorkspaceName}
              editingSessionId={editingSessionId}
              editingSessionName={editingSessionName}
              isSavingSessionName={isSavingSessionName}
              onEditingWorkspaceNameChange={onEditingWorkspaceNameChange}
              onEditingSessionNameChange={onEditingSessionNameChange}
              onToggleWorkspace={onToggleWorkspace}
              onToggleWorkspaceStar={onToggleWorkspaceStar}
              onStartWorkspaceRename={onStartWorkspaceRename}
              onCancelWorkspaceRename={onCancelWorkspaceRename}
              onSaveWorkspaceRename={onSaveWorkspaceRename}
              onStartSessionRename={onStartSessionRename}
              onCancelSessionRename={onCancelSessionRename}
              onSaveSessionRename={onSaveSessionRename}
              onDeleteWorkspace={onDeleteWorkspace}
              onSessionSelect={onSessionSelect}
              onSessionDelete={onSessionDelete}
              onNewSession={onNewSession}
            />
          ))}
        </>
      )}
    </div>
  );
}

import {
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  Folder,
  FolderOpen,
  Plus,
  Star,
  Trash2,
  X,
} from 'lucide-react';

import { SidebarSessionItem } from '@/components/refactored/sidebar/view/SidebarSessionItem';
import type { WorkspaceRecord } from '@/components/refactored/sidebar/types';
import { getWorkspaceDisplayName } from '@/components/refactored/sidebar/utils/workspaceTransforms';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/view/ui';

type SidebarWorkspaceItemProps = {
  workspace: WorkspaceRecord;
  isExpanded: boolean;
  selectedSessionId: string | null;
  editingWorkspacePath: string | null;
  editingWorkspaceName: string;
  isSavingWorkspaceName: boolean;
  editingSessionId: string | null;
  editingSessionName: string;
  isSavingSessionName: boolean;
  onEditingWorkspaceNameChange: (name: string) => void;
  onEditingSessionNameChange: (name: string) => void;
  onToggleWorkspace: (workspaceId: string, workspacePath: string) => void;
  onToggleWorkspaceStar: (workspaceId: string) => void;
  onStartWorkspaceRename: (workspace: WorkspaceRecord) => void;
  onCancelWorkspaceRename: () => void;
  onSaveWorkspaceRename: () => void;
  onStartSessionRename: (session: WorkspaceRecord['sessions'][number]) => void;
  onCancelSessionRename: () => void;
  onSaveSessionRename: () => void;
  onDeleteWorkspace: (workspace: WorkspaceRecord) => void;
  onSessionSelect: (workspacePath: string, sessionId: string) => void;
  onSessionDelete: (workspacePath: string, sessionId: string) => void;
  onNewSession: (workspaceId: string) => void;
};

export function SidebarWorkspaceItem({
  workspace,
  isExpanded,
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
}: SidebarWorkspaceItemProps) {
  const isEditing = editingWorkspacePath === workspace.workspaceOriginalPath;
  const hasSelectedSession = workspace.sessions.some(
    (session) => session.sessionId === selectedSessionId,
  );
  const workspaceName = getWorkspaceDisplayName(workspace);
  const sessionCountLabel = `${workspace.sessions.length} session${
    workspace.sessions.length === 1 ? '' : 's'
  }`;

  const handleSaveRename = () => {
    if (!isSavingWorkspaceName) {
      onSaveWorkspaceRename();
    }
  };

  return (
    <div className="md:space-y-1">
      <div className="group md:group">
        <div className="md:hidden">
          <div
            className={cn(
              'mx-3 my-1 rounded-lg border bg-card p-3 transition-all duration-150 active:scale-[0.98]',
              hasSelectedSession && 'border-primary/20 bg-primary/5',
              workspace.isStarred &&
                !hasSelectedSession &&
                'border-yellow-200/30 bg-yellow-50/50 dark:border-yellow-800/30 dark:bg-yellow-900/5',
            )}
            onClick={() => onToggleWorkspace(workspace.workspaceId, workspace.workspaceOriginalPath)}
          >
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                    isExpanded ? 'bg-primary/10' : 'bg-muted',
                  )}
                >
                  {isExpanded ? (
                    <FolderOpen className="h-4 w-4 text-primary" />
                  ) : (
                    <Folder className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingWorkspaceName}
                      onChange={(event) => onEditingWorkspaceNameChange(event.target.value)}
                      className="w-full rounded-lg border-2 border-primary/40 bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-all duration-200 focus:border-primary focus:shadow-md focus:outline-none"
                      placeholder="Workspace name"
                      autoFocus
                      autoComplete="off"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          handleSaveRename();
                        }

                        if (event.key === 'Escape') {
                          onCancelWorkspaceRename();
                        }
                      }}
                      style={{
                        fontSize: '16px',
                        WebkitAppearance: 'none',
                        borderRadius: '8px',
                      }}
                    />
                  ) : (
                    <>
                      <h3 className="truncate text-sm font-medium text-foreground">{workspaceName}</h3>
                      <p className="text-xs text-muted-foreground">{sessionCountLabel}</p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {isEditing ? (
                  <>
                    <button
                      className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500 shadow-sm transition-all duration-150 active:scale-90 active:shadow-none dark:bg-green-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleSaveRename();
                      }}
                    >
                      <Check className="h-4 w-4 text-white" />
                    </button>
                    <button
                      className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-500 shadow-sm transition-all duration-150 active:scale-90 active:shadow-none dark:bg-gray-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancelWorkspaceRename();
                      }}
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-lg border transition-all duration-150 active:scale-90',
                        workspace.isStarred
                          ? 'border-yellow-200 bg-yellow-500/10 dark:border-yellow-800 dark:bg-yellow-900/30'
                          : 'border-gray-200 bg-gray-500/10 dark:border-gray-800 dark:bg-gray-900/30',
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleWorkspaceStar(workspace.workspaceId);
                      }}
                      title={workspace.isStarred ? 'Remove from Starred' : 'Add to Starred'}
                    >
                      <Star
                        className={cn(
                          'h-4 w-4 transition-colors',
                          workspace.isStarred
                            ? 'fill-current text-yellow-600 dark:text-yellow-400'
                            : 'text-gray-600 dark:text-gray-400',
                        )}
                      />
                    </button>

                    <button
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-red-500/10 active:scale-90 dark:border-red-800 dark:bg-red-900/30"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteWorkspace(workspace);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                    </button>

                    <button
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 active:scale-90 dark:border-primary/30 dark:bg-primary/20"
                      onClick={(event) => {
                        event.stopPropagation();
                        onStartWorkspaceRename(workspace);
                      }}
                    >
                      <Edit3 className="h-4 w-4 text-primary" />
                    </button>

                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/30">
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          className={cn(
            'hidden h-auto w-full justify-between p-2 font-normal hover:bg-accent/50 md:flex',
            hasSelectedSession && 'bg-accent text-accent-foreground',
            workspace.isStarred &&
              !hasSelectedSession &&
              'bg-yellow-50/50 hover:bg-yellow-100/50 dark:bg-yellow-900/10 dark:hover:bg-yellow-900/20',
          )}
          onClick={() => onToggleWorkspace(workspace.workspaceId, workspace.workspaceOriginalPath)}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {isExpanded ? (
              <FolderOpen className="h-4 w-4 flex-shrink-0 text-primary" />
            ) : (
              <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1 text-left">
              {isEditing ? (
                <div className="space-y-1">
                  <input
                    type="text"
                    value={editingWorkspaceName}
                    onChange={(event) => onEditingWorkspaceNameChange(event.target.value)}
                    className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:ring-2 focus:ring-primary/20"
                    placeholder="Workspace name"
                    autoFocus
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        handleSaveRename();
                      }
                      if (event.key === 'Escape') {
                        onCancelWorkspaceRename();
                      }
                    }}
                  />
                  <div className="truncate text-xs text-muted-foreground" title={workspace.workspaceOriginalPath}>
                    {workspace.workspaceOriginalPath}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="truncate text-sm font-semibold text-foreground" title={workspaceName}>
                    {workspaceName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {workspace.sessions.length}
                    <span className="ml-1 opacity-60" title={workspace.workspaceOriginalPath}>
                      {' - '}
                      {workspace.workspaceOriginalPath.length > 25
                        ? `...${workspace.workspaceOriginalPath.slice(-22)}`
                        : workspace.workspaceOriginalPath}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1">
            {isEditing ? (
              <>
                <div
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-green-600 transition-colors hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-900/20"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleSaveRename();
                  }}
                >
                  <Check className="h-3 w-3" />
                </div>
                <div
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:hover:bg-gray-800"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelWorkspaceRename();
                  }}
                >
                  <X className="h-3 w-3" />
                </div>
              </>
            ) : (
              <>
                <div
                  className={cn(
                    'touch:opacity-100 flex h-8 w-8 cursor-pointer items-center justify-center rounded opacity-0 transition-all duration-200 group-hover:opacity-100',
                    workspace.isStarred ? 'opacity-100 hover:bg-yellow-50 dark:hover:bg-yellow-900/20' : 'hover:bg-accent',
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleWorkspaceStar(workspace.workspaceId);
                  }}
                  title={workspace.isStarred ? 'Remove from Starred' : 'Add to Starred'}
                >
                  <Star
                    className={cn(
                      'h-3 w-3 transition-colors',
                      workspace.isStarred
                        ? 'fill-current text-yellow-600 dark:text-yellow-400'
                        : 'text-muted-foreground',
                    )}
                  />
                </div>
                <div
                  className="touch:opacity-100 flex h-8 w-8 cursor-pointer items-center justify-center rounded opacity-0 transition-all duration-200 hover:bg-accent group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartWorkspaceRename(workspace);
                  }}
                  title="Rename workspace"
                >
                  <Edit3 className="h-3 w-3" />
                </div>
                <div
                  className="touch:opacity-100 flex h-8 w-8 cursor-pointer items-center justify-center rounded opacity-0 transition-all duration-200 hover:bg-red-50 group-hover:opacity-100 dark:hover:bg-red-900/20"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteWorkspace(workspace);
                  }}
                  title="Delete workspace"
                >
                  <Trash2 className="h-3 w-3 text-red-600 dark:text-red-400" />
                </div>
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                )}
              </>
            )}
          </div>
        </Button>
      </div>

      {isExpanded && (
        <div className="ml-3 space-y-1 border-l border-border pl-3">
          {workspace.sessions.length === 0 ? (
            <div className="px-3 py-2 text-left">
              <p className="text-xs text-muted-foreground">No sessions yet</p>
            </div>
          ) : (
            workspace.sessions.map((session) => (
              <SidebarSessionItem
                key={session.sessionId}
                session={session}
                isSelected={session.sessionId === selectedSessionId}
                isEditing={editingSessionId === session.sessionId}
                editingSessionName={editingSessionName}
                isSavingSessionName={isSavingSessionName}
                onEditingSessionNameChange={onEditingSessionNameChange}
                onStartEdit={() => onStartSessionRename(session)}
                onCancelEdit={onCancelSessionRename}
                onSaveEdit={onSaveSessionRename}
                onSelect={() =>
                  onSessionSelect(workspace.workspaceOriginalPath, session.sessionId)
                }
                onDelete={() =>
                  onSessionDelete(workspace.workspaceOriginalPath, session.sessionId)
                }
              />
            ))
          )}

          <div className="px-3 pb-2 md:hidden">
            <button
              className="flex h-8 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"
              onClick={(event) => {
                event.stopPropagation();
                onNewSession(workspace.workspaceId);
              }}
            >
              <Plus className="h-3 w-3" />
              New Session
            </button>
          </div>

          <Button
            variant="default"
            size="sm"
            className="mt-1 hidden h-8 w-full justify-start gap-2 bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 md:flex"
            onClick={() => onNewSession(workspace.workspaceId)}
          >
            <Plus className="h-3 w-3" />
            New Session
          </Button>
        </div>
      )}
    </div>
  );
}

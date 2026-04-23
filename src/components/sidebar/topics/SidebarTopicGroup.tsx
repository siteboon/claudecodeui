import { useMemo, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../lib/utils';
import type { LLMProvider, Project, ProjectSession } from '../../../types/app';
import type { MCPServerStatus, SessionWithProvider } from '../types/types';
import SidebarProjectItem from '../view/subcomponents/SidebarProjectItem';

import TopicChip from './TopicChip';
import type { Topic, TopicStorageAPI } from './useTopicStorage';

export interface SidebarTopicGroupProps {
  project: Project;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isExpanded: boolean;
  isDeleting: boolean;
  isStarred: boolean;
  editingProject: string | null;
  editingName: string;
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  topicsApi: TopicStorageAPI;
  onEditingNameChange: (value: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectName: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onLoadMoreSessions: (project: Project) => void;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  t: TFunction;
}

function TopicChipDroppable({
  topic,
  isActive,
  onClick,
  onContextMenu,
  allLabel,
}: {
  topic: Topic | null;
  isActive: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  allLabel: string;
}) {
  const droppableId = topic ? `topic:${topic.id}` : 'topic:__all__';
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: { type: 'topic', topicId: topic?.id ?? null },
  });
  return (
    <TopicChip
      label={topic ? topic.name : allLabel}
      color={topic ? topic.color : null}
      isActive={isActive}
      isDropTarget={isOver}
      onClick={onClick}
      onContextMenu={onContextMenu}
      dropRef={setNodeRef}
      dataTopicId={topic?.id}
    />
  );
}

/**
 * Additive wrapper around SidebarProjectItem.
 * Adds a horizontal Topic chip row as a sibling element and filters the
 * sessions passed to SidebarProjectItem by the active topic for this repo.
 *
 * Drag a session to a topic chip to assign. Drag to "All" to unassign.
 * The drag sources (sessions) wire themselves via dnd-kit useDraggable
 * inside SidebarSessionItem and participate in the DndContext that
 * SidebarProjectTree provides at the top level.
 */
export default function SidebarTopicGroup(props: SidebarTopicGroupProps) {
  const { project, sessions, topicsApi, isExpanded, t, ...rest } = props;
  const repoKey = project.repoGroup || project.name;
  const activeTopicId = topicsApi.activeTopicByRepo[repoKey] ?? null;

  const [isCreating, setIsCreating] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');

  const filteredSessions = useMemo(() => {
    if (!activeTopicId) return sessions;
    return sessions.filter((s) => topicsApi.assignments[s.id] === activeTopicId);
  }, [sessions, activeTopicId, topicsApi.assignments]);

  // Only show chip row when expanded AND project has sessions (chips are pointless otherwise)
  const showChips = isExpanded && sessions.length > 0;

  const handleCreateTopic = () => {
    const name = newTopicName.trim();
    if (!name) {
      setIsCreating(false);
      return;
    }
    const topic = topicsApi.createTopic(name);
    topicsApi.setActiveTopic(repoKey, topic.id);
    setNewTopicName('');
    setIsCreating(false);
  };

  const allLabel = (t('sidebar:topics.all', { defaultValue: 'All' }) as string) || 'All';
  const createLabel = (t('sidebar:topics.createTopic', { defaultValue: 'Topic' }) as string) || 'Topic';

  return (
    <div className="space-y-1" data-topic-group-repo={repoKey}>
      <SidebarProjectItem
        project={project}
        sessions={filteredSessions}
        isExpanded={isExpanded}
        t={t}
        {...rest}
      />
      {showChips && (
        <div
          className="flex items-center gap-1.5 overflow-x-auto px-3 py-1.5 md:px-2"
          role="tablist"
          aria-label={(t('sidebar:topics.chipRowLabel', { defaultValue: 'Topics' }) as string) || 'Topics'}
        >
          <TopicChipDroppable
            topic={null}
            isActive={activeTopicId === null}
            onClick={() => topicsApi.setActiveTopic(repoKey, null)}
            allLabel={allLabel}
          />
          {topicsApi.topics.map((topic) => (
            <TopicChipDroppable
              key={topic.id}
              topic={topic}
              isActive={activeTopicId === topic.id}
              onClick={() => topicsApi.setActiveTopic(repoKey, topic.id)}
              allLabel={allLabel}
              onContextMenu={(e) => {
                e.preventDefault();
                const nextName = window.prompt(
                  (t('sidebar:topics.renamePrompt', { defaultValue: 'Rename topic' }) as string) ||
                    'Rename topic',
                  topic.name,
                );
                if (nextName === null) return;
                const trimmed = nextName.trim();
                if (trimmed) {
                  topicsApi.renameTopic(topic.id, trimmed);
                } else if (
                  window.confirm(
                    (t('sidebar:topics.deleteConfirm', { defaultValue: 'Delete this topic?' }) as string) ||
                      'Delete this topic?',
                  )
                ) {
                  topicsApi.deleteTopic(topic.id);
                }
              }}
            />
          ))}
          {isCreating ? (
            <input
              autoFocus
              type="text"
              value={newTopicName}
              onChange={(e) => setNewTopicName(e.target.value)}
              onBlur={handleCreateTopic}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateTopic();
                if (e.key === 'Escape') {
                  setNewTopicName('');
                  setIsCreating(false);
                }
              }}
              placeholder={
                (t('sidebar:topics.namePlaceholder', { defaultValue: 'Topic name' }) as string) || 'Topic name'
              }
              className="ds-chip min-h-[44px] min-w-[120px] bg-transparent px-3 text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
          ) : (
            <button
              type="button"
              className={cn('ds-chip min-h-[44px] whitespace-nowrap px-3 flex items-center gap-1')}
              onClick={() => setIsCreating(true)}
              aria-label={createLabel}
            >
              <Plus className="h-3 w-3" />
              <span className="text-xs font-semibold">{createLabel}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

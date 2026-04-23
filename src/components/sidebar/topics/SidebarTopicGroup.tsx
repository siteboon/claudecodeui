import { useMemo, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../lib/utils';
import type { LLMProvider, Project, ProjectSession } from '../../../types/app';
import type { MCPServerStatus, SessionWithProvider } from '../types/types';
import SidebarProjectItem from '../view/subcomponents/SidebarProjectItem';

import TopicChip from './TopicChip';
import type { Topic, TopicStorageAPI } from './useServerTopics';

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
  projectKey,
  isActive,
  count,
  onClick,
  onContextMenu,
  allLabel,
}: {
  topic: Topic | null;
  projectKey: string;
  isActive: boolean;
  count: number;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  allLabel: string;
}) {
  const droppableId = topic ? `topic:${topic.id}` : `topic:__all__:${projectKey}`;
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: { type: 'topic', topicId: topic?.id ?? null, projectKey },
  });
  return (
    <TopicChip
      label={topic ? topic.name : allLabel}
      color={topic ? topic.color : null}
      isActive={isActive}
      isDropTarget={isOver}
      count={count}
      onClick={onClick}
      onContextMenu={onContextMenu}
      dropRef={setNodeRef}
      dataTopicId={topic?.id}
    />
  );
}

/**
 * Additive wrapper around SidebarProjectItem.
 *
 * Mobile + desktop: shows a horizontal Topic chip row above the conversation
 * list. Tap a chip to filter the project's sessions by that topic. The chip
 * row only appears when the project is expanded and has at least one session.
 *
 * The chips ARE droppable: drag a session onto a chip to manually assign that
 * topic (method='manual', survives nightly re-clustering). Drag onto "All"
 * to clear the manual assignment.
 *
 * Topic counts on chips show how many sessions each topic owns server-side.
 */
export default function SidebarTopicGroup(props: SidebarTopicGroupProps) {
  const { project, sessions, topicsApi, isExpanded, t, ...rest } = props;
  const projectKey = project.name;
  const activeTopicId = topicsApi.activeTopicByProject[projectKey] ?? null;

  const [isCreating, setIsCreating] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');

  const projectTopics = useMemo<Topic[]>(
    () => topicsApi.topics.filter((t) => t.projectKey === projectKey),
    [topicsApi.topics, projectKey],
  );

  const filteredSessions = useMemo(() => {
    if (!activeTopicId) return sessions;
    return sessions.filter((s) => topicsApi.assignments[s.id]?.topicId === activeTopicId);
  }, [sessions, activeTopicId, topicsApi.assignments]);

  const allTopicCount = sessions.length;

  const showChips = isExpanded && sessions.length > 0;

  const handleCreateTopic = () => {
    const name = newTopicName.trim();
    if (!name) {
      setIsCreating(false);
      return;
    }
    const topic = topicsApi.createTopic(projectKey, name);
    topicsApi.setActiveTopic(projectKey, topic.id);
    setNewTopicName('');
    setIsCreating(false);
  };

  const allLabel = (t('sidebar:topics.all', { defaultValue: 'All' }) as string) || 'All';
  const createLabel =
    (t('sidebar:topics.createTopic', { defaultValue: 'Topic' }) as string) || 'Topic';

  return (
    <div className="space-y-1" data-topic-group-project={projectKey}>
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
          aria-label={
            (t('sidebar:topics.chipRowLabel', { defaultValue: 'Topics' }) as string) || 'Topics'
          }
        >
          <TopicChipDroppable
            topic={null}
            projectKey={projectKey}
            isActive={activeTopicId === null}
            count={allTopicCount}
            onClick={() => topicsApi.setActiveTopic(projectKey, null)}
            allLabel={allLabel}
          />
          {projectTopics.map((topic) => (
            <TopicChipDroppable
              key={topic.id}
              topic={topic}
              projectKey={projectKey}
              isActive={activeTopicId === topic.id}
              count={topic.sessionCount}
              onClick={() => topicsApi.setActiveTopic(projectKey, topic.id)}
              allLabel={allLabel}
              onContextMenu={
                topic.isLocal
                  ? (e) => {
                      e.preventDefault();
                      if (
                        window.confirm(
                          (t('sidebar:topics.deleteConfirm', {
                            defaultValue: 'Delete this topic?',
                          }) as string) || 'Delete this topic?',
                        )
                      ) {
                        topicsApi.deleteTopic(topic.id);
                      }
                    }
                  : undefined
              }
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
                (t('sidebar:topics.namePlaceholder', { defaultValue: 'Topic name' }) as string) ||
                'Topic name'
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

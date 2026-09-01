import { useState } from 'react';

import { cn } from '@/shared/utils';
import { api } from '@/shared/api';
import { useTaskMaster } from '@/modules/task-master/context/TaskMasterContext';
import { useTaskBoardState } from '@/modules/task-master/hooks/useTaskBoardState';
import type { PrdFile, TaskBoardView, TaskMasterProject, TaskMasterTask, TaskSelection } from '@/shared/types';
import TaskBoardContent from '@/modules/task-master/TaskBoardContent';
import TaskBoardToolbar from '@/modules/task-master/TaskBoardToolbar';
import TaskEmptyState from '@/modules/task-master/TaskEmptyState';
import CreateTaskModal from '@/modules/task-master/modals/CreateTaskModal';
import TaskHelpModal from '@/modules/task-master/modals/TaskHelpModal';
import TaskMasterSetupModal from '@/modules/task-master/modals/TaskMasterSetupModal';

type TaskBoardProps = {
  tasks?: TaskMasterTask[];
  onTaskClick?: ((task: TaskSelection) => void) | null;
  className?: string;
  showParentTasks?: boolean;
  defaultView?: TaskBoardView;
  currentProject?: TaskMasterProject | null;
  onTaskCreated?: (() => void) | null;
  onShowPRDEditor?: ((file?: PrdFile) => void) | null;
  existingPRDs?: PrdFile[];
  onRefreshPRDs?: ((showNotification?: boolean) => void) | null;
};

/** Rendered by TaskMasterPanel as the task board, wiring the toolbar, board content and this module's modals together. */
export default function TaskBoard({
  tasks = [],
  onTaskClick = null,
  className = '',
  showParentTasks = false,
  defaultView = 'kanban',
  currentProject = null,
  onTaskCreated = null,
  onShowPRDEditor = null,
  existingPRDs = [],
  onRefreshPRDs = null,
}: TaskBoardProps) {
  const { projectTaskMaster, refreshTasks, setCurrentProject } = useTaskMaster();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);

  const {
    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    priorityFilter,
    setPriorityFilter,
    sortField,
    setSortField,
    sortOrder,
    setSortOrder,
    viewMode,
    setViewMode,
    showFilters,
    setShowFilters,
    statuses,
    priorities,
    filteredTasks,
    kanbanColumns,
    handleSortChange,
    clearFilters,
  } = useTaskBoardState({ tasks, defaultView });

  const hasTaskMasterDirectory = Boolean(
    currentProject?.taskMasterConfigured
      || currentProject?.taskmaster?.hasTaskmaster
      || projectTaskMaster?.hasTaskmaster,
  );

  const loadPrdAndOpenEditor = async (prd: PrdFile) => {
    // Projects are addressed by DB projectId; see the projectName → projectId migration.
    if (!currentProject?.projectId) {
      return;
    }

    try {
      const response = await api.taskmaster.prdFile(currentProject.projectId, prd.name);

      if (!response.ok) {
        throw new Error(`Failed to load PRD ${prd.name}`);
      }

      const data = (await response.json()) as { content?: string };
      onShowPRDEditor?.({
        name: prd.name,
        content: data.content ?? '',
        isExisting: true,
      });
    } catch (error) {
      console.error('Failed to open PRD in editor:', error);
    }
  };

  const refreshAfterSetup = () => {
    // setCurrentProject re-reads the project's TaskMaster details itself, so
    // the refreshProjects() that used to precede it was the same request twice.
    if (currentProject) {
      setCurrentProject(currentProject);
    }
    void refreshTasks();
    onRefreshPRDs?.(false);
  };

  if (tasks.length === 0) {
    return (
      <>
        <TaskEmptyState
          className={className}
          hasTaskMasterDirectory={hasTaskMasterDirectory}
          existingPrds={existingPRDs}
          onOpenSetupModal={() => setShowSetupModal(true)}
          onCreatePrd={() => onShowPRDEditor?.()}
          onOpenPrd={(prd) => {
            void loadPrdAndOpenEditor(prd);
          }}
        />

        <TaskMasterSetupModal
          isOpen={showSetupModal}
          project={currentProject}
          onClose={() => setShowSetupModal(false)}
          onAfterClose={refreshAfterSetup}
        />
      </>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      <TaskBoardToolbar
        hasProject={Boolean(currentProject)}
        hasTaskMasterConfigured={hasTaskMasterDirectory}
        totalTaskCount={tasks.length}
        filteredTaskCount={filteredTasks.length}
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters((current) => !current)}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        priorityFilter={priorityFilter}
        onPriorityFilterChange={setPriorityFilter}
        sortField={sortField}
        sortOrder={sortOrder}
        onSortChange={handleSortChange}
        onSortConfigChange={(field, order) => {
          setSortField(field);
          setSortOrder(order);
        }}
        statuses={statuses}
        priorities={priorities}
        onClearFilters={clearFilters}
        existingPrds={existingPRDs}
        onCreatePrd={() => onShowPRDEditor?.()}
        onOpenPrd={(prd) => {
          void loadPrdAndOpenEditor(prd);
        }}
        onOpenHelp={() => setShowHelpModal(true)}
        onOpenCreateTask={() => setShowCreateModal(true)}
      />

      <TaskBoardContent
        viewMode={viewMode}
        filteredTaskCount={filteredTasks.length}
        kanbanColumns={kanbanColumns}
        filteredTasks={filteredTasks}
        showParentTasks={showParentTasks}
        onTaskClick={(task) => onTaskClick?.(task)}
      />

      <CreateTaskModal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          onTaskCreated?.();
        }}
      />

      <TaskHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        onCreatePrd={() => onShowPRDEditor?.()}
      />

      <TaskMasterSetupModal
        isOpen={showSetupModal}
        project={currentProject}
        onClose={() => setShowSetupModal(false)}
        onAfterClose={refreshAfterSetup}
      />
    </div>
  );
}

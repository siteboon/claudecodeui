import { useState } from 'react';
import {
  CheckCircle,
  Circle,
  Eye,
  Flag,
  List,
  Play,
  Settings,
  Target,
  Terminal,
  Zap,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useTaskMaster } from '../context/TaskMasterContext';
import TaskDetailModal from './TaskDetailModal';
import TaskMasterSetupModal from './modals/TaskMasterSetupModal';

type NextTaskBannerProps = {
  onShowAllTasks?: (() => void) | null;
  onStartTask?: (() => void) | null;
  className?: string;
};

function PriorityIndicator({ priority }: { priority?: string }) {
  if (priority === 'high') {
    return (
      <div className="flex h-4 w-4 items-center justify-center rounded bg-red-100 dark:bg-red-900/50" title="High Priority">
        <Zap className="h-2.5 w-2.5 text-red-600 dark:text-red-400" />
      </div>
    );
  }

  if (priority === 'medium') {
    return (
      <div className="flex h-4 w-4 items-center justify-center rounded bg-amber-100 dark:bg-amber-900/50" title="Medium Priority">
        <Flag className="h-2.5 w-2.5 text-amber-600 dark:text-amber-400" />
      </div>
    );
  }

  return (
    <div className="flex h-4 w-4 items-center justify-center rounded bg-gray-100 dark:bg-gray-800" title="Low Priority">
      <Circle className="h-2.5 w-2.5 text-gray-400 dark:text-gray-500" />
    </div>
  );
}

export default function NextTaskBanner({ onShowAllTasks = null, onStartTask = null, className = '' }: NextTaskBannerProps) {
  const {
    nextTask,
    tasks,
    currentProject,
    isLoadingTasks,
    projectTaskMaster,
    refreshTasks,
    refreshProjects,
    setCurrentProject,
  } = useTaskMaster();

  const [showTaskDetail, setShowTaskDetail] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showSetupDetails, setShowSetupDetails] = useState(false);

  if (!currentProject || isLoadingTasks) {
    return null;
  }

  const hasTasks = Array.isArray(tasks) && tasks.length > 0;
  const hasTaskMaster = Boolean(projectTaskMaster?.hasTaskmaster || currentProject.taskmaster?.hasTaskmaster);

  const handleSetupRefresh = () => {
    void refreshProjects();
    setCurrentProject(currentProject);
    void refreshTasks();
  };

  if (!hasTasks && !hasTaskMaster) {
    return (
      <>
        <div className={cn('bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-4', className)}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <List className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <p className="text-sm font-medium text-gray-900 dark:text-white">TaskMaster AI is not configured</p>
            </div>

            <button
              onClick={() => setShowSetupModal(true)}
              className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs text-white transition-colors hover:bg-blue-700"
            >
              <Terminal className="h-3 w-3" />
              Initialize
            </button>
          </div>

          <button
            onClick={() => setShowSetupDetails((current) => !current)}
            className="mt-2 flex items-center gap-1 text-xs text-blue-700 hover:underline dark:text-blue-300"
          >
            <Settings className="h-3 w-3" />
            {showSetupDetails ? 'Hide details' : 'What is TaskMaster?'}
          </button>

          {showSetupDetails && (
            <div className="mt-3 space-y-1 text-xs text-blue-900 dark:text-blue-100">
              <p>- AI-powered task management with dependencies and subtasks.</p>
              <p>- PRD-driven task generation for faster project bootstrapping.</p>
              <p>- Kanban and list views for day-to-day execution.</p>
            </div>
          )}
        </div>

        <TaskMasterSetupModal
          isOpen={showSetupModal}
          project={currentProject}
          onClose={() => setShowSetupModal(false)}
          onAfterClose={handleSetupRefresh}
        />
      </>
    );
  }

  if (nextTask) {
    return (
      <>
        <div className={cn('bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 rounded-lg p-3 mb-4', className)}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50">
                  <Target className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Task {nextTask.id}</span>
                <PriorityIndicator priority={nextTask.priority} />
              </div>
              <p className="line-clamp-1 text-sm font-medium text-slate-900 dark:text-slate-100">{nextTask.title}</p>
            </div>

            <div className="flex flex-shrink-0 items-center gap-1">
              <button
                onClick={() => onStartTask?.()}
                className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Play className="h-3 w-3" />
                Start Task
              </button>

              <button
                onClick={() => setShowTaskDetail(true)}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                title="View task details"
              >
                <Eye className="h-3 w-3" />
              </button>

              {onShowAllTasks && (
                <button
                  onClick={onShowAllTasks}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                  title="View all tasks"
                >
                  <List className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        <TaskDetailModal
          task={nextTask}
          isOpen={showTaskDetail}
          onClose={() => setShowTaskDetail(false)}
          onStatusChange={() => {
            void refreshTasks();
          }}
        />
      </>
    );
  }

  if (hasTasks) {
    const completedTasks = tasks.filter((task) => task.status === 'done').length;

    return (
      <div className={cn('bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 rounded-lg p-3 mb-4', className)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {completedTasks === tasks.length ? 'All tasks complete' : 'No pending tasks'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 dark:text-gray-400">
              {completedTasks}/{tasks.length}
            </span>
            {onShowAllTasks && (
              <button
                onClick={onShowAllTasks}
                className="rounded bg-purple-600 px-2 py-1 text-xs text-white transition-colors hover:bg-purple-700"
              >
                Review
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

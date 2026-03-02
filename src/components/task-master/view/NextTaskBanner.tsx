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
      <div className="w-4 h-4 rounded bg-red-100 dark:bg-red-900/50 flex items-center justify-center" title="High Priority">
        <Zap className="w-2.5 h-2.5 text-red-600 dark:text-red-400" />
      </div>
    );
  }

  if (priority === 'medium') {
    return (
      <div className="w-4 h-4 rounded bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center" title="Medium Priority">
        <Flag className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400" />
      </div>
    );
  }

  return (
    <div className="w-4 h-4 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center" title="Low Priority">
      <Circle className="w-2.5 h-2.5 text-gray-400 dark:text-gray-500" />
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
            <div className="flex items-center gap-2 min-w-0">
              <List className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <p className="text-sm font-medium text-gray-900 dark:text-white">TaskMaster AI is not configured</p>
            </div>

            <button
              onClick={() => setShowSetupModal(true)}
              className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center gap-1"
            >
              <Terminal className="w-3 h-3" />
              Initialize
            </button>
          </div>

          <button
            onClick={() => setShowSetupDetails((current) => !current)}
            className="mt-2 text-xs text-blue-700 dark:text-blue-300 hover:underline flex items-center gap-1"
          >
            <Settings className="w-3 h-3" />
            {showSetupDetails ? 'Hide details' : 'What is TaskMaster?'}
          </button>

          {showSetupDetails && (
            <div className="mt-3 text-xs text-blue-900 dark:text-blue-100 space-y-1">
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
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-5 h-5 bg-blue-100 dark:bg-blue-900/50 rounded-full flex items-center justify-center">
                  <Target className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">Task {nextTask.id}</span>
                <PriorityIndicator priority={nextTask.priority} />
              </div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100 line-clamp-1">{nextTask.title}</p>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => onStartTask?.()}
                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium flex items-center gap-1"
              >
                <Play className="w-3 h-3" />
                Start Task
              </button>

              <button
                onClick={() => setShowTaskDetail(true)}
                className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-md"
                title="View task details"
              >
                <Eye className="w-3 h-3" />
              </button>

              {onShowAllTasks && (
                <button
                  onClick={onShowAllTasks}
                  className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-md"
                  title="View all tasks"
                >
                  <List className="w-3 h-3" />
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
            <CheckCircle className="w-4 h-4 text-purple-600 dark:text-purple-400" />
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
                className="text-xs px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors"
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

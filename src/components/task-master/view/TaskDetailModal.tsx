import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  Edit,
  Pause,
  Save,
  X,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { api } from '../../../utils/api';
import { useTaskMaster } from '../context/TaskMasterContext';
import type { TaskId, TaskMasterTask, TaskReference } from '../types';

type TaskDetailModalProps = {
  task: TaskMasterTask | null;
  isOpen?: boolean;
  className?: string;
  onClose: () => void;
  onEdit?: ((task: TaskMasterTask) => void) | null;
  onStatusChange?: ((taskId: TaskId, status: string) => void) | null;
  onTaskClick?: ((task: TaskReference) => void) | null;
};

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'cancelled', label: 'Cancelled' },
];

function getStatusIcon(status?: string) {
  if (status === 'done') return CheckCircle;
  if (status === 'in-progress') return Clock;
  if (status === 'review') return AlertCircle;
  if (status === 'deferred') return Pause;
  if (status === 'cancelled') return X;
  return Circle;
}

function getPriorityBadgeClass(priority?: string): string {
  if (priority === 'high') return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950';
  if (priority === 'medium') return 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950';
  if (priority === 'low') return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950';
  return 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800';
}

export default function TaskDetailModal({
  task,
  isOpen = true,
  className = '',
  onClose,
  onEdit = null,
  onStatusChange = null,
  onTaskClick = null,
}: TaskDetailModalProps) {
  const { currentProject, refreshTasks } = useTaskMaster();

  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showTestStrategy, setShowTestStrategy] = useState(false);
  const [editableTask, setEditableTask] = useState<TaskMasterTask | null>(task);

  useEffect(() => {
    setEditableTask(task);
    setIsEditMode(false);
  }, [task]);

  const StatusIcon = useMemo(() => getStatusIcon(task?.status), [task?.status]);

  if (!isOpen || !task || !editableTask) {
    return null;
  }

  const handleSaveChanges = async () => {
    if (!currentProject?.name) {
      return;
    }

    const updates: Record<string, string> = {};

    if (editableTask.title !== task.title) {
      updates.title = editableTask.title;
    }

    if (editableTask.description !== task.description) {
      updates.description = editableTask.description ?? '';
    }

    if (editableTask.details !== task.details) {
      updates.details = editableTask.details ?? '';
    }

    if (Object.keys(updates).length === 0) {
      setIsEditMode(false);
      return;
    }

    setIsSaving(true);
    try {
      const response = await api.taskmaster.updateTask(currentProject.name, task.id, updates);
      if (!response.ok) {
        const errorPayload = (await response.json()) as { message?: string };
        throw new Error(errorPayload.message ?? 'Failed to update task');
      }

      setIsEditMode(false);
      await refreshTasks();
      onEdit?.(editableTask);
    } catch (error) {
      console.error('Failed to save task changes:', error);
      alert(error instanceof Error ? error.message : 'Failed to update task');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStatusSelect = async (nextStatus: string) => {
    if (!currentProject?.name || nextStatus === task.status) {
      return;
    }

    try {
      const response = await api.taskmaster.updateTask(currentProject.name, task.id, { status: nextStatus });
      if (!response.ok) {
        const errorPayload = (await response.json()) as { message?: string };
        throw new Error(errorPayload.message ?? 'Failed to update task status');
      }

      await refreshTasks();
      onStatusChange?.(task.id, nextStatus);
    } catch (error) {
      console.error('Failed to update task status:', error);
      alert(error instanceof Error ? error.message : 'Failed to update task status');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center md:p-4">
      <div
        className={cn(
          'w-full md:max-w-4xl h-full md:h-[90vh] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 md:rounded-lg shadow-xl flex flex-col',
          className,
        )}
      >
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <StatusIcon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <div className="min-w-0 flex-1">
              <button
                onClick={() => copyTextToClipboard(String(task.id))}
                className="mb-2 inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                title="Copy task ID"
              >
                <span>Task {task.id}</span>
                <Copy className="w-3 h-3" />
              </button>

              {isEditMode ? (
                <input
                  type="text"
                  value={editableTask.title}
                  onChange={(event) => setEditableTask({ ...editableTask, title: event.target.value })}
                  className="w-full text-lg font-semibold bg-transparent border-b-2 border-blue-500 focus:outline-none text-gray-900 dark:text-white"
                />
              ) : (
                <h1 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white line-clamp-2">{task.title}</h1>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isEditMode ? (
              <>
                <button
                  onClick={handleSaveChanges}
                  disabled={isSaving}
                  className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-950 rounded-md disabled:opacity-50"
                  title="Save"
                >
                  <Save className={cn('w-5 h-5', isSaving && 'animate-spin')} />
                </button>
                <button
                  onClick={() => {
                    setEditableTask(task);
                    setIsEditMode(false);
                  }}
                  disabled={isSaving}
                  className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
                  title="Cancel editing"
                >
                  <X className="w-5 h-5" />
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditMode(true)}
                className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md"
                title="Edit task"
              >
                <Edit className="w-5 h-5" />
              </button>
            )}
            <button onClick={onClose} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md" title="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
              <select
                value={task.status ?? 'pending'}
                onChange={(event) => {
                  void handleStatusSelect(event.target.value);
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Priority</label>
              <div className={cn('px-3 py-2 rounded-md text-sm font-medium capitalize', getPriorityBadgeClass(task.priority))}>
                {task.priority ?? 'Not set'}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Dependencies</label>
              {Array.isArray(task.dependencies) && task.dependencies.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {task.dependencies.map((dependency) => (
                    <button
                      key={String(dependency)}
                      onClick={() => onTaskClick?.({ id: dependency })}
                      className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded text-sm hover:bg-blue-200 dark:hover:bg-blue-800"
                    >
                      <ArrowRight className="w-3 h-3 inline mr-1" />
                      {dependency}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-gray-500 dark:text-gray-400 text-sm">No dependencies</span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Description</label>
            {isEditMode ? (
              <textarea
                rows={4}
                value={editableTask.description ?? ''}
                onChange={(event) => setEditableTask({ ...editableTask, description: event.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800"
              />
            ) : (
              <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{task.description || 'No description provided'}</p>
            )}
          </div>

          {task.details && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
              <button
                onClick={() => setShowDetails((current) => !current)}
                className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Implementation Details</span>
                {showDetails ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              {showDetails && (
                <div className="border-t border-gray-200 dark:border-gray-700 p-4">
                  <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{task.details}</p>
                </div>
              )}
            </div>
          )}

          {task.testStrategy && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
              <button
                onClick={() => setShowTestStrategy((current) => !current)}
                className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Test Strategy</span>
                {showTestStrategy ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              {showTestStrategy && (
                <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-blue-50 dark:bg-blue-950/30">
                  <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{task.testStrategy}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

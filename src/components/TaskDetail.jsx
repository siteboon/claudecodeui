import React, { useState } from 'react';
import { X, Flag, User, ArrowRight, CheckCircle, Circle, AlertCircle, Pause, Edit, Save, Copy, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { cn } from '../lib/utils';
import TaskIndicator from './TaskIndicator';
import { api } from '../utils/api';
import { useTaskMaster } from '../contexts/TaskMasterContext';

const TaskDetail = ({ 
  task, 
  onClose, 
  onEdit,
  onStatusChange,
  onTaskClick,
  isOpen = true,
  className = ''
}) => {
  const [editMode, setEditMode] = useState(false);
  const [editedTask, setEditedTask] = useState(task || {});
  const [isSaving, setIsSaving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showTestStrategy, setShowTestStrategy] = useState(false);
  const { currentProject, refreshTasks } = useTaskMaster();

  if (!isOpen || !task) return null;

  const handleSave = async () => {
    if (!currentProject) return;
    
    setIsSaving(true);
    try {
      // Only include changed fields
      const updates = {};
      if (editedTask.title !== task.title) updates.title = editedTask.title;
      if (editedTask.description !== task.description) updates.description = editedTask.description;
      if (editedTask.details !== task.details) updates.details = editedTask.details;
      
      if (Object.keys(updates).length > 0) {
        const response = await api.taskmaster.updateTask(currentProject.name, task.id, updates);
        
        if (response.ok) {
          // Refresh tasks to get updated data
          refreshTasks?.();
          onEdit?.(editedTask);
          setEditMode(false);
        } else {
          const error = await response.json();
          console.error('Failed to update task:', error);
          alert(`Failed to update task: ${error.message}`);
        }
      } else {
        setEditMode(false);
      }
    } catch (error) {
      console.error('Error updating task:', error);
      alert('Error updating task. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    if (!currentProject) return;
    
    try {
      const response = await api.taskmaster.updateTask(currentProject.name, task.id, { status: newStatus });
      
      if (response.ok) {
        refreshTasks?.();
        onStatusChange?.(task.id, newStatus);
      } else {
        const error = await response.json();
        console.error('Failed to update task status:', error);
        alert(`Failed to update task status: ${error.message}`);
      }
    } catch (error) {
      console.error('Error updating task status:', error);
      alert('Error updating task status. Please try again.');
    }
  };

  const copyTaskId = () => {
    navigator.clipboard.writeText(task.id.toString());
  };

  const getStatusConfig = (status) => {
    switch (status) {
      case 'done':
        return { icon: CheckCircle, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-950' };
      case 'in-progress':
        return { icon: Clock, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950' };
      case 'review':
        return { icon: AlertCircle, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950' };
      case 'deferred':
        return { icon: Pause, color: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-50 dark:bg-gray-800' };
      case 'cancelled':
        return { icon: X, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950' };
      default:
        return { icon: Circle, color: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-50 dark:bg-slate-800' };
    }
  };

  const statusConfig = getStatusConfig(task.status);
  const StatusIcon = statusConfig.icon;


  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950';
      case 'medium': return 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950';
      case 'low': return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950';
      default: return 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800';
    }
  };

  const statusOptions = [
    { value: 'pending', label: 'Pending' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'review', label: 'Review' },
    { value: 'done', label: 'Done' },
    { value: 'deferred', label: 'Deferred' },
    { value: 'cancelled', label: 'Cancelled' }
  ];

  return (
    <div className="modal-backdrop fixed inset-0 flex items-center justify-center z-[100] md:p-4 bg-black/50">
      <div className={cn(
        'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 md:rounded-lg shadow-xl',
        'w-full md:max-w-4xl h-full md:h-[90vh] flex flex-col',
        className
      )}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <StatusIcon className={cn('w-6 h-6', statusConfig.color)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <button
                  onClick={copyTaskId}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  title="Click to copy task ID"
                >
                  <span>Task {task.id}</span>
                  <Copy className="w-3 h-3" />
                </button>
                {task.parentId && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Subtask of Task {task.parentId}
                  </span>
                )}
              </div>
              {editMode ? (
                <input
                  type="text"
                  value={editedTask.title || ''}
                  onChange={(e) => setEditedTask({ ...editedTask, title: e.target.value })}
                  className="w-full text-lg font-semibold bg-transparent border-b-2 border-blue-500 focus:outline-none text-gray-900 dark:text-white"
                  placeholder="Task title"
                />
              ) : (
                <h1 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white line-clamp-2">
                  {task.title}
                </h1>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2 flex-shrink-0">
            {editMode ? (
              <>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="p-2 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={isSaving ? "Saving..." : "Save changes"}
                >
                  <Save className={cn("w-5 h-5", isSaving && "animate-spin")} />
                </button>
                <button
                  onClick={() => {
                    setEditMode(false);
                    setEditedTask(task);
                  }}
                  disabled={isSaving}
                  className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Cancel editing"
                >
                  <X className="w-5 h-5" />
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditMode(true)}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                title="Edit task"
              >
                <Edit className="w-5 h-5" />
              </button>
            )}
            
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 min-h-0">
          {/* Status and Metadata Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Status */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
              <div className={cn(
                'w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600',
                statusConfig.bg,
                statusConfig.color
              )}>
                <div className="flex items-center gap-2">
                  <StatusIcon className="w-4 h-4" />
                  <span className="font-medium capitalize">
                    {statusOptions.find(option => option.value === task.status)?.label || task.status}
                  </span>
                </div>
              </div>
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Priority</label>
              <div className={cn(
                'px-3 py-2 rounded-md text-sm font-medium capitalize',
                getPriorityColor(task.priority)
              )}>
                <Flag className="w-4 h-4 inline mr-2" />
                {task.priority || 'Not set'}
              </div>
            </div>

            {/* Dependencies */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Dependencies</label>
              {task.dependencies && task.dependencies.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {task.dependencies.map(depId => (
                    <button 
                      key={depId} 
                      onClick={() => onTaskClick && onTaskClick({ id: depId })}
                      className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded text-sm hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50"
                      disabled={!onTaskClick}
                      title={onTaskClick ? `Click to view Task ${depId}` : `Task ${depId}`}
                    >
                      <ArrowRight className="w-3 h-3 inline mr-1" />
                      {depId}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-gray-500 dark:text-gray-400 text-sm">No dependencies</span>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Description</label>
            {editMode ? (
              <textarea
                value={editedTask.description || ''}
                onChange={(e) => setEditedTask({ ...editedTask, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                placeholder="Task description"
              />
            ) : (
              <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {task.description || 'No description provided'}
              </p>
            )}
          </div>

          {/* Implementation Details */}
          {task.details && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Implementation Details
                </span>
                {showDetails ? (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                )}
              </button>
              {showDetails && (
                <div className="border-t border-gray-200 dark:border-gray-700 p-4">
                  {editMode ? (
                    <textarea
                      value={editedTask.details || ''}
                      onChange={(e) => setEditedTask({ ...editedTask, details: e.target.value })}
                      rows={4}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      placeholder="Implementation details"
                    />
                  ) : (
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-4">
                      <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {task.details}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Test Strategy */}
          {task.testStrategy && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
              <button
                onClick={() => setShowTestStrategy(!showTestStrategy)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Test Strategy
                </span>
                {showTestStrategy ? (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                )}
              </button>
              {showTestStrategy && (
                <div className="border-t border-gray-200 dark:border-gray-700 p-4">
                  <div className="bg-blue-50 dark:bg-blue-950 rounded-md p-4">
                    <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                      {task.testStrategy}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Subtasks */}
          {task.subtasks && task.subtasks.length > 0 && (
            <div className="space-y-3">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Subtasks ({task.subtasks.length})
              </label>
              <div className="space-y-2">
                {task.subtasks.map(subtask => {
                  const subtaskConfig = getStatusConfig(subtask.status);
                  const SubtaskIcon = subtaskConfig.icon;
                  return (
                    <div key={subtask.id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                      <SubtaskIcon className={cn('w-4 h-4', subtaskConfig.color)} />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-gray-900 dark:text-white truncate">
                          {subtask.title}
                        </h4>
                        {subtask.description && (
                          <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                            {subtask.description}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {subtask.id}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 md:p-6 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Task ID: {task.id}
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaskDetail;
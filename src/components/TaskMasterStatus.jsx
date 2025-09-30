import React from 'react';
import { useTaskMaster } from '../contexts/TaskMasterContext';
import TaskIndicator from './TaskIndicator';

const TaskMasterStatus = () => {
  const { 
    currentProject, 
    projectTaskMaster, 
    mcpServerStatus,
    isLoading,
    isLoadingMCP,
    error 
  } = useTaskMaster();

  if (isLoading || isLoadingMCP) {
    return (
      <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
        <div className="animate-spin w-3 h-3 border border-gray-300 border-t-blue-500 rounded-full mr-2"></div>
        Loading TaskMaster status...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center text-sm text-red-500 dark:text-red-400">
        <span className="w-2 h-2 bg-red-500 rounded-full mr-2"></span>
        TaskMaster Error
      </div>
    );
  }

  // Show MCP server status
  const mcpConfigured = mcpServerStatus?.hasMCPServer && mcpServerStatus?.isConfigured;
  
  // Show project TaskMaster status
  const projectConfigured = currentProject?.taskmaster?.hasTaskmaster;
  const taskCount = currentProject?.taskmaster?.metadata?.taskCount || 0;
  const completedCount = currentProject?.taskmaster?.metadata?.completed || 0;

  if (!currentProject) {
    return (
      <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
        <span className="w-2 h-2 bg-gray-400 rounded-full mr-2"></span>
        No project selected
      </div>
    );
  }

  // Determine overall status for TaskIndicator
  let overallStatus = 'not-configured';
  if (projectConfigured && mcpConfigured) {
    overallStatus = 'fully-configured';
  } else if (projectConfigured) {
    overallStatus = 'taskmaster-only';
  } else if (mcpConfigured) {
    overallStatus = 'mcp-only';
  }

  return (
    <div className="flex items-center gap-3">
      {/* TaskMaster Status Indicator */}
      <TaskIndicator 
        status={overallStatus} 
        size="md"
        showLabel={true}
      />

      {/* Task Progress Info */}
      {projectConfigured && (
        <div className="text-xs text-gray-600 dark:text-gray-400">
          <span className="font-medium">
            {completedCount}/{taskCount} tasks
          </span>
          {taskCount > 0 && (
            <span className="ml-2 opacity-75">
              ({Math.round((completedCount / taskCount) * 100)}%)
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default TaskMasterStatus;
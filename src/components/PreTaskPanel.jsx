import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';
import { Switch } from './ui/switch';

const PreTaskPanel = ({ selectedProject, selectedSession, onClose, isVisible }) => {
  const [pretasks, setPretasks] = useState([]);
  const [autoExecute, setAutoExecute] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newTaskContent, setNewTaskContent] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [draggedItem, setDraggedItem] = useState(null);
  const [executing, setExecuting] = useState(false);

  // Load pretasks when session changes
  const loadPretasks = useCallback(async () => {
    if (!selectedSession?.id) {
      setPretasks([]);
      setAutoExecute(false);
      return;
    }

    setLoading(true);
    try {
      const response = await api.pretasks.list(selectedSession.id);
      if (response.ok) {
        const data = await response.json();
        setPretasks(data.pretasks || []);
        setAutoExecute(data.auto_execute || false);
      } else {
        console.error('Failed to load pretasks');
        setPretasks([]);
        setAutoExecute(false);
      }
    } catch (error) {
      console.error('Error loading pretasks:', error);
      setPretasks([]);
      setAutoExecute(false);
    } finally {
      setLoading(false);
    }
  }, [selectedSession?.id]);

  useEffect(() => {
    if (isVisible && selectedSession) {
      loadPretasks();
    }
  }, [loadPretasks, isVisible, selectedSession]);

  // Add new pretask
  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!newTaskContent.trim() || !selectedSession?.id || addingTask) return;

    setAddingTask(true);
    try {
      const response = await api.pretasks.add(
        selectedSession.id, 
        newTaskContent.trim(),
        selectedProject?.name
      );
      
      if (response.ok) {
        setNewTaskContent('');
        await loadPretasks(); // Reload to get updated list
      } else {
        const error = await response.json();
        console.error('Failed to add pretask:', error);
        // TODO: Show error message to user
      }
    } catch (error) {
      console.error('Error adding pretask:', error);
      // TODO: Show error message to user
    } finally {
      setAddingTask(false);
    }
  };

  // Delete pretask
  const handleDeleteTask = async (pretaskId) => {
    if (!selectedSession?.id) return;

    try {
      const response = await api.pretasks.delete(selectedSession.id, pretaskId);
      if (response.ok) {
        await loadPretasks(); // Reload to get updated list
      } else {
        console.error('Failed to delete pretask');
        // TODO: Show error message to user
      }
    } catch (error) {
      console.error('Error deleting pretask:', error);
      // TODO: Show error message to user
    }
  };

  // Toggle auto-execute
  const handleToggleAutoExecute = async (newValue) => {
    if (!selectedSession?.id) return;

    try {
      const response = await api.pretasks.toggleAutoExecute(selectedSession.id, newValue);
      if (response.ok) {
        setAutoExecute(newValue);
      } else {
        console.error('Failed to toggle auto-execute');
        // TODO: Show error message to user
      }
    } catch (error) {
      console.error('Error toggling auto-execute:', error);
      // TODO: Show error message to user
    }
  };

  // Manual execution of PRETASKs
  const handleStartExecution = async () => {
    if (!selectedSession?.id || !selectedProject) return;

    // Check if there are incomplete pretasks
    const incompletePretasks = pretasks.filter(p => !p.is_completed);
    if (incompletePretasks.length === 0) {
      // TODO: Show message to user that there are no tasks to execute
      console.log('No incomplete PRETASKs to execute');
      return;
    }

    setExecuting(true);
    try {
      const response = await api.pretasks.execute(
        selectedSession.id,
        selectedProject.fullPath || selectedProject.path,
        selectedProject.fullPath || selectedProject.path
      );
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Manual PRETASK execution started:', result);
        // TODO: Show success message to user
        // The execution will be tracked through WebSocket events
      } else {
        const error = await response.json();
        console.error('Failed to start PRETASK execution:', error);
        // TODO: Show error message to user
      }
    } catch (error) {
      console.error('Error starting PRETASK execution:', error);
      // TODO: Show error message to user
    } finally {
      setExecuting(false);
    }
  };

  // Handle drag and drop for reordering
  const handleDragStart = (e, pretask, index) => {
    setDraggedItem({ pretask, index });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e, dropIndex) => {
    e.preventDefault();
    
    if (!draggedItem || draggedItem.index === dropIndex) {
      setDraggedItem(null);
      return;
    }

    // Create new array with reordered items
    const reorderedPretasks = [...pretasks];
    const [draggedPretask] = reorderedPretasks.splice(draggedItem.index, 1);
    reorderedPretasks.splice(dropIndex, 0, draggedPretask);

    // Update order_index for each pretask
    const updateData = reorderedPretasks.map((pretask, index) => ({
      id: pretask.id,
      order_index: index + 1
    }));

    try {
      const response = await api.pretasks.updateOrder(selectedSession.id, updateData);
      if (response.ok) {
        await loadPretasks(); // Reload to get updated order
      } else {
        console.error('Failed to update pretask order');
        // TODO: Show error message to user
      }
    } catch (error) {
      console.error('Error updating pretask order:', error);
      // TODO: Show error message to user
    }

    setDraggedItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">PRETASK Manager</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {selectedSession ? `Session: ${selectedSession.id}` : 'No session selected'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Auto-execute toggle and manual execution */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1">
              <Switch
                id="auto-execute-switch"
                checked={autoExecute}
                onCheckedChange={handleToggleAutoExecute}
                disabled={loading || !selectedSession}
                aria-labelledby="auto-execute-label"
                aria-describedby="auto-execute-description"
              />
              <div className="flex flex-col">
                <label 
                  id="auto-execute-label"
                  htmlFor="auto-execute-switch"
                  className="font-medium text-gray-900 dark:text-white cursor-pointer"
                >
                  Auto-execute PRETASKs
                </label>
                <div id="auto-execute-description" className="text-sm text-gray-500 dark:text-gray-400">
                  Automatically run pretasks when conversations complete
                </div>
              </div>
            </div>

            {/* Start Execution Button */}
            <button
              onClick={handleStartExecution}
              disabled={executing || !selectedSession || pretasks.filter(p => !p.is_completed).length === 0 || loading}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
              title={
                !selectedSession 
                  ? 'No session selected' 
                  : pretasks.filter(p => !p.is_completed).length === 0 
                  ? 'No incomplete PRETASKs to execute'
                  : executing 
                  ? 'Execution in progress...'
                  : 'Start executing PRETASKs now'
              }
            >
              {executing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Executing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h8M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M9 16v-4a2 2 0 012-2h2a2 2 0 012 2v4" />
                  </svg>
                  Start Execution
                </>
              )}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Add new task form */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <form onSubmit={handleAddTask} className="flex gap-2">
              <input
                type="text"
                value={newTaskContent}
                onChange={(e) => setNewTaskContent(e.target.value)}
                placeholder="Add a new pretask..."
                disabled={addingTask || !selectedSession}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!newTaskContent.trim() || addingTask || !selectedSession}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-md transition-colors flex items-center gap-2"
              >
                {addingTask ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Adding...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Add
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Pretasks list */}
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                <div className="flex items-center justify-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
                  <p>Loading pretasks...</p>
                </div>
              </div>
            ) : pretasks.length === 0 ? (
              <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="font-medium mb-1">No pretasks yet</p>
                <p className="text-sm">Add a pretask to get started</p>
              </div>
            ) : (
              <div className="space-y-2">
                {pretasks.map((pretask, index) => (
                  <div
                    key={pretask.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, pretask, index)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`group bg-gray-50 dark:bg-gray-700 rounded-lg p-3 border border-gray-200 dark:border-gray-600 cursor-move hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors ${
                      draggedItem?.index === index ? 'opacity-50' : ''
                    } ${pretask.is_completed ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Drag handle */}
                      <div className="flex flex-col items-center text-gray-400 dark:text-gray-500 pt-1">
                        <span className="text-xs font-mono">{pretask.order_index}</span>
                        <svg className="w-4 h-4 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                        </svg>
                      </div>
                      
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className={`font-mono text-sm break-words ${
                          pretask.is_completed 
                            ? 'text-gray-500 dark:text-gray-400 line-through' 
                            : 'text-gray-900 dark:text-white'
                        }`}>
                          {pretask.content}
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                          <span>Created: {new Date(pretask.created_at).toLocaleString()}</span>
                          {pretask.is_completed && (
                            <span className="text-green-600 dark:text-green-400 font-medium">
                              ✓ Completed
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* Delete button */}
                      <button
                        onClick={() => handleDeleteTask(pretask.id)}
                        disabled={loading}
                        className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 rounded transition-opacity disabled:opacity-50"
                        title="Delete pretask"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Drag and drop to reorder • PRETASKs execute automatically after conversations when enabled
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreTaskPanel;
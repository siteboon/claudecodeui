import React, { useState } from 'react';
import { ArrowRight, List, Clock, Flag, CheckCircle, Circle, AlertCircle, Pause, ChevronDown, ChevronUp, Plus, FileText, Settings, X, Terminal, Eye, Play, Zap, Target } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTaskMaster } from '../contexts/TaskMasterContext';
import { api } from '../utils/api';
import Shell from './Shell';
import TaskDetail from './TaskDetail';

const NextTaskBanner = ({ onShowAllTasks, onStartTask, className = '' }) => {
  const { nextTask, tasks, currentProject, isLoadingTasks, projectTaskMaster, refreshTasks, refreshProjects } = useTaskMaster();
  const [showDetails, setShowDetails] = useState(false);
  const [showTaskOptions, setShowTaskOptions] = useState(false);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showCLI, setShowCLI] = useState(false);
  const [showTaskDetail, setShowTaskDetail] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Handler functions
  const handleInitializeTaskMaster = async () => {
    if (!currentProject) return;
    
    setIsLoading(true);
    try {
      const response = await api.taskmaster.init(currentProject.name);
      if (response.ok) {
        await refreshProjects();
        setShowTaskOptions(false);
      } else {
        const error = await response.json();
        console.error('Failed to initialize TaskMaster:', error);
        alert(`Failed to initialize TaskMaster: ${error.message}`);
      }
    } catch (error) {
      console.error('Error initializing TaskMaster:', error);
      alert('Error initializing TaskMaster. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateManualTask = () => {
    setShowCreateTaskModal(true);
    setShowTaskOptions(false);
  };

  const handleParsePRD = () => {
    setShowTemplateSelector(true);
    setShowTaskOptions(false);
  };

  // Don't show if no project or still loading
  if (!currentProject || isLoadingTasks) {
    return null;
  }

  let bannerContent;

  // Show setup message only if no tasks exist AND TaskMaster is not configured
  if ((!tasks || tasks.length === 0) && !projectTaskMaster?.hasTaskmaster) {
    bannerContent = (
      <div className={cn(
        'bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-4',
        className
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <List className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                TaskMaster AI is not configured
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowTaskOptions(!showTaskOptions)}
              className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center gap-1"
            >
              <Settings className="w-3 h-3" />
              Initialize TaskMaster AI
            </button>
          </div>
        </div>
        
        {showTaskOptions && (
          <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-800">
            {!projectTaskMaster?.hasTaskmaster && (
              <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-900/50 rounded-lg">
                <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                  🎯 What is TaskMaster?
                </h4>
                <div className="text-xs text-blue-800 dark:text-blue-200 space-y-1">
                  <p>• <strong>AI-Powered Task Management:</strong> Break complex projects into manageable subtasks</p>
                  <p>• <strong>PRD Templates:</strong> Generate tasks from Product Requirements Documents</p>
                  <p>• <strong>Dependency Tracking:</strong> Understand task relationships and execution order</p>
                  <p>• <strong>Progress Visualization:</strong> Kanban boards and detailed task analytics</p>
                  <p>• <strong>CLI Integration:</strong> Use taskmaster commands for advanced workflows</p>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {!projectTaskMaster?.hasTaskmaster ? (
                <button
                  className="text-xs px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded transition-colors text-left flex items-center gap-2"
                  onClick={() => setShowCLI(true)}
                >
                  <Terminal className="w-3 h-3" />
                  Initialize TaskMaster
                </button>
              ) : (
                <>
                  <div className="mb-2 p-2 bg-green-50 dark:bg-green-900/30 rounded text-xs text-green-800 dark:text-green-200">
                    <strong>Add more tasks:</strong> Create additional tasks manually or generate them from a PRD template
                  </div>
                  <button
                    className="text-xs px-3 py-2 bg-green-100 dark:bg-green-900 hover:bg-green-200 dark:hover:bg-green-800 text-green-800 dark:text-green-200 rounded transition-colors text-left flex items-center gap-2 disabled:opacity-50"
                    onClick={handleCreateManualTask}
                    disabled={isLoading}
                  >
                    <Plus className="w-3 h-3" />
                    Create a new task manually
                  </button>
                  <button
                    className="text-xs px-3 py-2 bg-purple-100 dark:bg-purple-900 hover:bg-purple-200 dark:hover:bg-purple-800 text-purple-800 dark:text-purple-200 rounded transition-colors text-left flex items-center gap-2 disabled:opacity-50"
                    onClick={handleParsePRD}
                    disabled={isLoading}
                  >
                    <FileText className="w-3 h-3" />
                    {isLoading ? 'Parsing...' : 'Generate tasks from PRD template'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  } else if (nextTask) {
    // Show next task if available
    bannerContent = (
      <div className={cn(
        'bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 rounded-lg p-3 mb-4',
        className
      )}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-5 h-5 bg-blue-100 dark:bg-blue-900/50 rounded-full flex items-center justify-center flex-shrink-0">
                <Target className="w-3 h-3 text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">Task {nextTask.id}</span>
              {nextTask.priority === 'high' && (
                <div className="w-4 h-4 rounded bg-red-100 dark:bg-red-900/50 flex items-center justify-center" title="High Priority">
                  <Zap className="w-2.5 h-2.5 text-red-600 dark:text-red-400" />
                </div>
              )}
              {nextTask.priority === 'medium' && (
                <div className="w-4 h-4 rounded bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center" title="Medium Priority">
                  <Flag className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400" />
                </div>
              )}
              {nextTask.priority === 'low' && (
                <div className="w-4 h-4 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center" title="Low Priority">
                  <Circle className="w-2.5 h-2.5 text-gray-400 dark:text-gray-500" />
                </div>
              )}
            </div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 line-clamp-1">
              {nextTask.title}
            </p>
          </div>
          
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => onStartTask?.()}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors shadow-sm flex items-center gap-1"
            >
              <Play className="w-3 h-3" />
              Start Task
            </button>
            <button
              onClick={() => setShowTaskDetail(true)}
              className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-md transition-colors flex items-center gap-1"
              title="View task details"
            >
              <Eye className="w-3 h-3" />
            </button>
            {onShowAllTasks && (
              <button
                onClick={onShowAllTasks}
                className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-md transition-colors flex items-center gap-1"
                title="View all tasks"
              >
                <List className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        
      </div>
    );
  } else if (tasks && tasks.length > 0) {
    // Show completion message only if there are tasks and all are done
    const completedTasks = tasks.filter(task => task.status === 'done').length;
    const totalTasks = tasks.length;
    
    bannerContent = (
    <div className={cn(
      'bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 rounded-lg p-3 mb-4',
      className
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {completedTasks === totalTasks ? "All done! 🎉" : "No pending tasks"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {completedTasks}/{totalTasks}
          </span>
          <button
            onClick={onShowAllTasks}
            className="text-xs px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors"
          >
            Review
          </button>
        </div>
      </div>
    </div>
    );
  } else {
    // TaskMaster is configured but no tasks exist - don't show anything in chat
    bannerContent = null;
  }

  return (
    <>
      {bannerContent}
      
      {/* Create Task Modal */}
      {showCreateTaskModal && (
        <CreateTaskModal
          currentProject={currentProject}
          onClose={() => setShowCreateTaskModal(false)}
          onTaskCreated={() => {
            refreshTasks();
            setShowCreateTaskModal(false);
          }}
        />
      )}
      
      {/* Template Selector Modal */}
      {showTemplateSelector && (
        <TemplateSelector
          currentProject={currentProject}
          onClose={() => setShowTemplateSelector(false)}
          onTemplateApplied={() => {
            refreshTasks();
            setShowTemplateSelector(false);
          }}
        />
      )}
      
      {/* TaskMaster CLI Setup Modal */}
      {showCLI && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-4xl h-[600px] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/50 rounded-lg flex items-center justify-center">
                  <Terminal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">TaskMaster Setup</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Interactive CLI for {currentProject?.displayName}</p>
                </div>
              </div>
              <button
                onClick={() => setShowCLI(false)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Terminal Container */}
            <div className="flex-1 p-4">
              <div className="h-full bg-black rounded-lg overflow-hidden">
                <Shell 
                  selectedProject={currentProject}
                  selectedSession={null}
                  isActive={true}
                  initialCommand="npx task-master init"
                  isPlainShell={true}
                />
              </div>
            </div>
            
            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  TaskMaster initialization will start automatically
                </div>
                <button
                  onClick={() => setShowCLI(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Task Detail Modal */}
      {showTaskDetail && nextTask && (
        <TaskDetail
          task={nextTask}
          isOpen={showTaskDetail}
          onClose={() => setShowTaskDetail(false)}
          onStatusChange={() => refreshTasks?.()}
          onTaskClick={null} // Disable dependency navigation in NextTaskBanner for now
        />
      )}
    </>
  );
};

// Simple Create Task Modal Component
const CreateTaskModal = ({ currentProject, onClose, onTaskCreated }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium',
    useAI: false,
    prompt: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentProject) return;

    setIsSubmitting(true);
    try {
      const taskData = formData.useAI 
        ? { prompt: formData.prompt, priority: formData.priority }
        : { title: formData.title, description: formData.description, priority: formData.priority };

      const response = await api.taskmaster.addTask(currentProject.name, taskData);
      
      if (response.ok) {
        onTaskCreated();
      } else {
        const error = await response.json();
        console.error('Failed to create task:', error);
        alert(`Failed to create task: ${error.message}`);
      }
    } catch (error) {
      console.error('Error creating task:', error);
      alert('Error creating task. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Create New Task</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              <input
                type="checkbox"
                checked={formData.useAI}
                onChange={(e) => setFormData(prev => ({ ...prev, useAI: e.target.checked }))}
              />
              Use AI to generate task details
            </label>
          </div>

          {formData.useAI ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Task Description (AI will generate details)
              </label>
              <textarea
                value={formData.prompt}
                onChange={(e) => setFormData(prev => ({ ...prev, prompt: e.target.value }))}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                rows="3"
                placeholder="Describe what you want to accomplish..."
                required
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Task Title
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Enter task title..."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  rows="3"
                  placeholder="Describe the task..."
                  required
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Priority
            </label>
            <select
              value={formData.priority}
              onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value }))}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
              disabled={isSubmitting || (formData.useAI && !formData.prompt.trim()) || (!formData.useAI && (!formData.title.trim() || !formData.description.trim()))}
            >
              {isSubmitting ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Template Selector Modal Component
const TemplateSelector = ({ currentProject, onClose, onTemplateApplied }) => {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [customizations, setCustomizations] = useState({});
  const [fileName, setFileName] = useState('prd.txt');
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [step, setStep] = useState('select'); // 'select', 'customize', 'generate'

  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const response = await api.taskmaster.getTemplates();
        if (response.ok) {
          const data = await response.json();
          setTemplates(data.templates);
        }
      } catch (error) {
        console.error('Error loading templates:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadTemplates();
  }, []);

  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);
    // Find placeholders in template content
    const placeholders = template.content.match(/\[([^\]]+)\]/g) || [];
    const uniquePlaceholders = [...new Set(placeholders.map(p => p.slice(1, -1)))];
    
    const initialCustomizations = {};
    uniquePlaceholders.forEach(placeholder => {
      initialCustomizations[placeholder] = '';
    });
    
    setCustomizations(initialCustomizations);
    setStep('customize');
  };

  const handleApplyTemplate = async () => {
    if (!selectedTemplate || !currentProject) return;

    setIsApplying(true);
    try {
      // Apply template
      const applyResponse = await api.taskmaster.applyTemplate(currentProject.name, {
        templateId: selectedTemplate.id,
        fileName,
        customizations
      });

      if (!applyResponse.ok) {
        const error = await applyResponse.json();
        throw new Error(error.message || 'Failed to apply template');
      }

      // Parse PRD to generate tasks
      const parseResponse = await api.taskmaster.parsePRD(currentProject.name, {
        fileName,
        numTasks: 10
      });

      if (!parseResponse.ok) {
        const error = await parseResponse.json();
        throw new Error(error.message || 'Failed to generate tasks');
      }

      setStep('generate');
      setTimeout(() => {
        onTemplateApplied();
      }, 2000);

    } catch (error) {
      console.error('Error applying template:', error);
      alert(`Error: ${error.message}`);
      setIsApplying(false);
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <span className="text-gray-900 dark:text-white">Loading templates...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {step === 'select' ? 'Select PRD Template' : 
             step === 'customize' ? 'Customize Template' : 
             'Generating Tasks'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === 'select' && (
          <div className="space-y-3">
            {templates.map((template) => (
              <div
                key={template.id}
                className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                onClick={() => handleSelectTemplate(template)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900 dark:text-white">{template.name}</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{template.description}</p>
                    <span className="inline-block text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded mt-2">
                      {template.category}
                    </span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 mt-1" />
                </div>
              </div>
            ))}
          </div>
        )}

        {step === 'customize' && selectedTemplate && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                File Name
              </label>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder="prd.txt"
              />
            </div>

            {Object.keys(customizations).length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Customize Template
                </label>
                <div className="space-y-3">
                  {Object.entries(customizations).map(([key, value]) => (
                    <div key={key}>
                      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                        {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                      </label>
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => setCustomizations(prev => ({ ...prev, [key]: e.target.value }))}
                        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        placeholder={`Enter ${key.toLowerCase()}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-4">
              <button
                onClick={() => setStep('select')}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
              >
                Back
              </button>
              <button
                onClick={handleApplyTemplate}
                className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded disabled:opacity-50"
                disabled={isApplying}
              >
                {isApplying ? 'Applying...' : 'Apply & Generate Tasks'}
              </button>
            </div>
          </div>
        )}

        {step === 'generate' && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              Template Applied Successfully!
            </h4>
            <p className="text-gray-600 dark:text-gray-400">
              Your PRD has been created and tasks are being generated...
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default NextTaskBanner;
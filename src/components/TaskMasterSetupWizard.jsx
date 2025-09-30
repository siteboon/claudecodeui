import React, { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, CheckCircle, AlertCircle, Settings, Server, FileText, Sparkles, ExternalLink, Copy } from 'lucide-react';
import { cn } from '../lib/utils';
import { api } from '../utils/api';

const TaskMasterSetupWizard = ({ 
  isOpen = true, 
  onClose, 
  onComplete,
  currentProject,
  className = ''
}) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [setupData, setSetupData] = useState({
    projectRoot: '',
    initGit: true,
    storeTasksInGit: true,
    addAliases: true,
    skipInstall: false,
    rules: ['claude'],
    mcpConfigured: false,
    prdContent: ''
  });

  const totalSteps = 4;

  useEffect(() => {
    if (currentProject) {
      setSetupData(prev => ({
        ...prev,
        projectRoot: currentProject.path || ''
      }));
    }
  }, [currentProject]);

  const steps = [
    {
      id: 1,
      title: 'Project Configuration',
      description: 'Configure basic TaskMaster settings for your project'
    },
    {
      id: 2,
      title: 'MCP Server Setup',
      description: 'Ensure TaskMaster MCP server is properly configured'
    },
    {
      id: 3,
      title: 'PRD Creation',
      description: 'Create or import a Product Requirements Document'
    },
    {
      id: 4,
      title: 'Complete Setup',
      description: 'Initialize TaskMaster and generate initial tasks'
    }
  ];

  const handleNext = async () => {
    setError(null);
    
    try {
      if (currentStep === 1) {
        // Validate project configuration
        if (!setupData.projectRoot) {
          setError('Project root path is required');
          return;
        }
        setCurrentStep(2);
      } else if (currentStep === 2) {
        // Check MCP server status
        setLoading(true);
        try {
          const mcpStatus = await api.get('/mcp-utils/taskmaster-server');
          setSetupData(prev => ({
            ...prev,
            mcpConfigured: mcpStatus.hasMCPServer && mcpStatus.isConfigured
          }));
          setCurrentStep(3);
        } catch (err) {
          setError('Failed to check MCP server status. You can continue but some features may not work.');
          setCurrentStep(3);
        }
      } else if (currentStep === 3) {
        // Validate PRD step
        if (!setupData.prdContent.trim()) {
          setError('Please create or import a PRD to continue');
          return;
        }
        setCurrentStep(4);
      } else if (currentStep === 4) {
        // Complete setup
        await completeSetup();
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      setError(null);
    }
  };

  const completeSetup = async () => {
    setLoading(true);
    try {
      // Initialize TaskMaster project
      const initResponse = await api.post('/taskmaster/initialize', {
        projectRoot: setupData.projectRoot,
        initGit: setupData.initGit,
        storeTasksInGit: setupData.storeTasksInGit,
        addAliases: setupData.addAliases,
        skipInstall: setupData.skipInstall,
        rules: setupData.rules,
        yes: true
      });

      if (!initResponse.ok) {
        throw new Error('Failed to initialize TaskMaster project');
      }

      // Save PRD content if provided
      if (setupData.prdContent.trim()) {
        const prdResponse = await api.post('/taskmaster/save-prd', {
          projectRoot: setupData.projectRoot,
          content: setupData.prdContent
        });

        if (!prdResponse.ok) {
          console.warn('Failed to save PRD content');
        }
      }

      // Parse PRD to generate initial tasks
      if (setupData.prdContent.trim()) {
        const parseResponse = await api.post('/taskmaster/parse-prd', {
          projectRoot: setupData.projectRoot,
          input: '.taskmaster/docs/prd.txt',
          numTasks: '10',
          research: false,
          force: false
        });

        if (!parseResponse.ok) {
          console.warn('Failed to parse PRD and generate tasks');
        }
      }

      onComplete?.();
      onClose?.();
    } catch (err) {
      setError(err.message || 'Failed to complete TaskMaster setup');
    } finally {
      setLoading(false);
    }
  };

  const copyMCPConfig = () => {
    const mcpConfig = `{
  "mcpServers": {
    "": {
      "command": "npx",
      "args": ["-y", "--package=task-master-ai", "task-master-ai"],
      "env": {
        "ANTHROPIC_API_KEY": "your_anthropic_key_here",
        "PERPLEXITY_API_KEY": "your_perplexity_key_here"
      }
    }
  }
}`;
    navigator.clipboard.writeText(mcpConfig);
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <Settings className="w-12 h-12 text-blue-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Project Configuration
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Configure TaskMaster settings for your project
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Project Root Path
                </label>
                <input
                  type="text"
                  value={setupData.projectRoot}
                  onChange={(e) => setSetupData(prev => ({ ...prev, projectRoot: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder="/path/to/your/project"
                />
              </div>

              <div className="space-y-3">
                <h4 className="font-medium text-gray-900 dark:text-white">Options</h4>
                
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={setupData.initGit}
                    onChange={(e) => setSetupData(prev => ({ ...prev, initGit: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Initialize Git repository</span>
                </label>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={setupData.storeTasksInGit}
                    onChange={(e) => setSetupData(prev => ({ ...prev, storeTasksInGit: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Store tasks in Git</span>
                </label>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={setupData.addAliases}
                    onChange={(e) => setSetupData(prev => ({ ...prev, addAliases: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Add shell aliases (tm, taskmaster)</span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Rule Profiles
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {['claude', 'cursor', 'vscode', 'roo', 'cline', 'windsurf'].map(rule => (
                    <label key={rule} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={setupData.rules.includes(rule)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSetupData(prev => ({ ...prev, rules: [...prev.rules, rule] }));
                          } else {
                            setSetupData(prev => ({ ...prev, rules: prev.rules.filter(r => r !== rule) }));
                          }
                        }}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">{rule}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <Server className="w-12 h-12 text-purple-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                MCP Server Setup
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                TaskMaster works best with the MCP server configured
              </p>
            </div>

            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                <div>
                  <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-1">
                    MCP Server Configuration
                  </h4>
                  <p className="text-sm text-blue-800 dark:text-blue-200 mb-3">
                    To enable full TaskMaster integration, add the MCP server configuration to your Claude settings.
                  </p>
                  
                  <div className="bg-white dark:bg-gray-800 rounded border p-3 mb-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-mono text-gray-600 dark:text-gray-400">.mcp.json</span>
                      <button
                        onClick={copyMCPConfig}
                        className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                      >
                        <Copy className="w-3 h-3" />
                        Copy
                      </button>
                    </div>
                    <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
{`{
  "mcpServers": {
    "task-master-ai": {
      "command": "npx",
      "args": ["-y", "--package=task-master-ai", "task-master-ai"],
      "env": {
        "ANTHROPIC_API_KEY": "your_anthropic_key_here",
        "PERPLEXITY_API_KEY": "your_perplexity_key_here"
      }
    }
  }
}`}
                    </pre>
                  </div>

                  <div className="flex items-center gap-2 text-sm">
                    <a
                      href="https://docs.anthropic.com/en/docs/build-with-claude/tool-use/mcp-servers"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1"
                    >
                      Learn about MCP setup
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
              <h4 className="font-medium text-gray-900 dark:text-white mb-2">Current Status</h4>
              <div className="flex items-center gap-2">
                {setupData.mcpConfigured ? (
                  <>
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span className="text-sm text-green-700 dark:text-green-300">MCP server is configured</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    <span className="text-sm text-amber-700 dark:text-amber-300">MCP server not detected (optional)</span>
                  </>
                )}
              </div>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <FileText className="w-12 h-12 text-green-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Product Requirements Document
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Create or import a PRD to generate initial tasks
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  PRD Content
                </label>
                <textarea
                  value={setupData.prdContent}
                  onChange={(e) => setSetupData(prev => ({ ...prev, prdContent: e.target.value }))}
                  rows={12}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono text-sm"
                  placeholder="# Product Requirements Document

## 1. Overview
Describe your project or feature...

## 2. Objectives
- Primary goal
- Success metrics

## 3. User Stories
- As a user, I want...

## 4. Requirements
- Feature requirements
- Technical requirements

## 5. Implementation Plan
- Phase 1: Core features
- Phase 2: Enhancements"
                />
              </div>

              <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-1">
                      AI Task Generation
                    </h4>
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      TaskMaster will analyze your PRD and automatically generate a structured task list with dependencies, priorities, and implementation details.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Complete Setup
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Ready to initialize TaskMaster for your project
              </p>
            </div>

            <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4">
              <h4 className="font-medium text-green-900 dark:text-green-100 mb-3">
                Setup Summary
              </h4>
              <ul className="space-y-2 text-sm text-green-800 dark:text-green-200">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  Project: {setupData.projectRoot}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  Rules: {setupData.rules.join(', ')}
                </li>
                {setupData.mcpConfigured && (
                  <li className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    MCP server configured
                  </li>
                )}
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  PRD content ready ({setupData.prdContent.length} characters)
                </li>
              </ul>
            </div>

            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                What happens next?
              </h4>
              <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800 dark:text-blue-200">
                <li>Initialize TaskMaster project structure</li>
                <li>Save your PRD to <code>.taskmaster/docs/prd.txt</code></li>
                <li>Generate initial tasks from your PRD</li>
                <li>Set up project configuration and rules</li>
              </ol>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop fixed inset-0 flex items-center justify-center z-[100] md:p-4 bg-black/50">
      <div className={cn(
        'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 md:rounded-lg shadow-xl',
        'w-full md:max-w-4xl h-full md:h-[90vh] flex flex-col',
        className
      )}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-blue-600" />
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                TaskMaster Setup Wizard
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Step {currentStep} of {totalSteps}: {steps[currentStep - 1]?.description}
              </p>
            </div>
          </div>
          
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="px-4 md:px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                  currentStep > step.id 
                    ? 'bg-green-500 text-white' 
                    : currentStep === step.id
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                )}>
                  {currentStep > step.id ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : (
                    step.id
                  )}
                </div>
                {index < steps.length - 1 && (
                  <div className={cn(
                    'w-16 h-1 mx-2 rounded',
                    currentStep > step.id 
                      ? 'bg-green-500' 
                      : 'bg-gray-200 dark:bg-gray-700'
                  )} />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
            {steps.map(step => (
              <span key={step.id} className="text-center">
                {step.title}
              </span>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {renderStepContent()}
          
          {error && (
            <div className="mt-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
                <div>
                  <h4 className="font-medium text-red-900 dark:text-red-100 mb-1">Error</h4>
                  <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 md:p-6 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
          <button
            onClick={handlePrevious}
            disabled={currentStep === 1}
            className="flex items-center gap-2 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>
          
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {currentStep} of {totalSteps}
          </div>
          
          <button
            onClick={handleNext}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                {currentStep === totalSteps ? 'Setting up...' : 'Processing...'}
              </>
            ) : (
              <>
                {currentStep === totalSteps ? 'Complete Setup' : 'Next'}
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TaskMasterSetupWizard;
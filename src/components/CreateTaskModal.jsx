import React from 'react';
import { X, Sparkles } from 'lucide-react';

const CreateTaskModal = ({ currentProject, onClose, onTaskCreated }) => {

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/50 rounded-lg flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Create AI-Generated Task</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* AI-First Approach */}
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
                  💡 Pro Tip: Ask Claude Code Directly!
                </h4>
                <p className="text-sm text-blue-800 dark:text-blue-200 mb-3">
                  You can simply ask Claude Code in the chat to create tasks for you. 
                  The AI assistant will automatically generate detailed tasks with research-backed insights.
                </p>
                
                <div className="bg-white dark:bg-gray-800 rounded border border-blue-200 dark:border-blue-700 p-3 mb-3">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Example:</p>
                  <p className="text-sm text-gray-900 dark:text-white font-mono">
                    "Please add a new task to implement user profile image uploads using Cloudinary, research the best approach."
                  </p>
                </div>
                
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  <strong>This runs:</strong> <code className="bg-blue-100 dark:bg-blue-900/50 px-1 rounded text-xs">
                    task-master add-task --prompt="Implement user profile image uploads using Cloudinary" --research
                  </code>
                </p>
              </div>
            </div>
          </div>

          {/* Learn More Link */}
          <div className="text-center pt-4 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              For more examples and advanced usage patterns:
            </p>
            <a
              href="https://github.com/eyaltoledano/claude-task-master/blob/main/docs/examples.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline font-medium"
            >
              View TaskMaster Documentation →
            </a>
          </div>

          {/* Footer */}
          <div className="pt-4">
            <button
              onClick={onClose}
              className="w-full px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              Got it, I'll ask Claude Code directly
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateTaskModal;
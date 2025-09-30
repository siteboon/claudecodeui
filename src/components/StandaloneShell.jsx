import React, { useState, useEffect } from 'react';
import Shell from './Shell.jsx';

/**
 * Generic Shell wrapper that can be used in tabs, modals, and other contexts.
 * Provides a flexible API for both standalone and session-based usage.
 * 
 * @param {Object} project - Project object with name, fullPath/path, displayName
 * @param {Object} session - Session object (optional, for tab usage)
 * @param {string} command - Initial command to run (optional)
 * @param {boolean} isActive - Whether the shell is active (for tab usage, default: true)
 * @param {boolean} isPlainShell - Use plain shell mode vs Claude CLI (default: auto-detect)
 * @param {boolean} autoConnect - Whether to auto-connect when mounted (default: true)
 * @param {function} onComplete - Callback when process completes (receives exitCode)
 * @param {function} onClose - Callback for close button (optional)
 * @param {string} title - Custom header title (optional)
 * @param {string} className - Additional CSS classes
 * @param {boolean} showHeader - Whether to show custom header (default: true)
 * @param {boolean} compact - Use compact layout (default: false)
 */
function StandaloneShell({
  project,
  session = null,
  command = null,
  isActive = true,
  isPlainShell = null, // Auto-detect: true if command provided, false if session provided
  autoConnect = true,
  onComplete = null,
  onClose = null,
  title = null,
  className = "",
  showHeader = true,
  compact = false
}) {
  const [isCompleted, setIsCompleted] = useState(false);

  // Auto-detect isPlainShell based on props
  const shouldUsePlainShell = isPlainShell !== null ? isPlainShell : (command !== null);

  // Handle process completion
  const handleProcessComplete = (exitCode) => {
    setIsCompleted(true);
    if (onComplete) {
      onComplete(exitCode);
    }
  };

  if (!project) {
    return (
      <div className={`h-full flex items-center justify-center ${className}`}>
        <div className="text-center text-gray-500 dark:text-gray-400">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">No Project Selected</h3>
          <p>A project is required to open a shell</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col ${className}`}>
      {/* Optional custom header */}
      {showHeader && title && (
        <div className="flex-shrink-0 bg-gray-800 border-b border-gray-700 px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-medium text-gray-200">{title}</h3>
              {isCompleted && (
                <span className="text-xs text-green-400">(Completed)</span>
              )}
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white"
                title="Close"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Shell component wrapper */}
      <div className="flex-1">
        <Shell
          selectedProject={project}
          selectedSession={session}
          isActive={isActive}
          initialCommand={command}
          isPlainShell={shouldUsePlainShell}
          onProcessComplete={handleProcessComplete}
        />
      </div>
    </div>
  );
}

export default StandaloneShell;
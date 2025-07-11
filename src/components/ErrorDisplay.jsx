import React, { useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon, ClipboardIcon, ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';

/**
 * ErrorDisplay Component
 * Displays user-friendly error messages with expandable technical details
 */
const ErrorDisplay = ({ 
  friendlyMessage, 
  onAction, 
  showTechnicalDetails = false,
  compact = false,
  className = '' 
}) => {
  const [isExpanded, setIsExpanded] = useState(showTechnicalDetails);
  const [copiedSection, setCopiedSection] = useState(null);

  if (!friendlyMessage) return null;

  const handleCopy = async (text, section) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const getSeverityColor = (severity) => {
    const colors = {
      critical: 'bg-red-100 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200',
      high: 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/10 dark:border-red-700 dark:text-red-300',
      medium: 'bg-yellow-50 border-yellow-200 text-yellow-700 dark:bg-yellow-900/10 dark:border-yellow-700 dark:text-yellow-300',
      low: 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/10 dark:border-blue-700 dark:text-blue-300'
    };
    return colors[severity] || colors.medium;
  };

  const getActionButtonColor = (action) => {
    if (action.primary) {
      return 'bg-blue-600 hover:bg-blue-700 text-white';
    }
    return 'bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300';
  };

  if (compact) {
    return (
      <div className={`rounded-lg border p-3 ${getSeverityColor(friendlyMessage.severity.id)} ${className}`}>
        <div className="flex items-start gap-3">
          <span className="text-lg flex-shrink-0">{friendlyMessage.icon}</span>
          <div className="flex-1 min-w-0">
            <h4 className="font-medium truncate">{friendlyMessage.title}</h4>
            <p className="text-sm opacity-90 mt-1">{friendlyMessage.message}</p>
          </div>
          {friendlyMessage.actions?.filter(a => a.primary).map((action, index) => (
            <button
              key={index}
              onClick={() => onAction?.(action)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${getActionButtonColor(action)}`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border ${getSeverityColor(friendlyMessage.severity.id)} ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-current border-opacity-20">
        <div className="flex items-start gap-3">
          <span className="text-2xl flex-shrink-0">{friendlyMessage.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-lg">{friendlyMessage.title}</h3>
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-current bg-opacity-20">
                {friendlyMessage.severity.icon} {friendlyMessage.severity.name}
              </span>
            </div>
            <p className="text-sm opacity-90 mb-2">{friendlyMessage.message}</p>
            <div className="flex items-center gap-4 text-xs opacity-75">
              <span>Category: {friendlyMessage.category.name}</span>
              <span>•</span>
              <span>{friendlyMessage.timestamp}</span>
              <span>•</span>
              <span>ID: {friendlyMessage.id}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Suggestions */}
      {friendlyMessage.suggestions && friendlyMessage.suggestions.length > 0 && (
        <div className="p-4 border-b border-current border-opacity-10">
          <div className="flex items-center gap-2 mb-2">
            <InformationCircleIcon className="w-4 h-4" />
            <h4 className="font-medium">Suggested Solutions</h4>
          </div>
          <ul className="list-disc list-inside space-y-1 text-sm opacity-90">
            {friendlyMessage.suggestions.map((suggestion, index) => (
              <li key={index}>{suggestion}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      {friendlyMessage.actions && friendlyMessage.actions.length > 0 && (
        <div className="p-4 border-b border-current border-opacity-10">
          <div className="flex flex-wrap gap-2">
            {friendlyMessage.actions.map((action, index) => (
              <button
                key={index}
                onClick={() => onAction?.(action)}
                className={`px-3 py-2 rounded text-sm font-medium transition-colors flex items-center gap-2 ${getActionButtonColor(action)}`}
                disabled={action.automated && action.type === 'processing'}
              >
                {action.automated && <span className="w-2 h-2 bg-current rounded-full opacity-50"></span>}
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Technical Details Toggle */}
      <div className="p-4">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-sm font-medium opacity-75 hover:opacity-100 transition-opacity"
        >
          {isExpanded ? (
            <ChevronUpIcon className="w-4 h-4" />
          ) : (
            <ChevronDownIcon className="w-4 h-4" />
          )}
          Technical Details
        </button>

        {/* Expandable Technical Details */}
        {isExpanded && (
          <div className="mt-4 space-y-4">
            {/* Original Error Message */}
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h5 className="font-medium text-sm">Original Error Message</h5>
                <button
                  onClick={() => handleCopy(friendlyMessage.technical.originalMessage, 'message')}
                  className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                >
                  <ClipboardIcon className="w-4 h-4" />
                </button>
              </div>
              <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
                {friendlyMessage.technical.originalMessage}
              </pre>
              {copiedSection === 'message' && (
                <div className="text-xs text-green-600 dark:text-green-400 mt-1">Copied to clipboard!</div>
              )}
            </div>

            {/* Error Code */}
            {friendlyMessage.technical.code && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <h5 className="font-medium text-sm">Error Code</h5>
                  <button
                    onClick={() => handleCopy(friendlyMessage.technical.code, 'code')}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                  >
                    <ClipboardIcon className="w-4 h-4" />
                  </button>
                </div>
                <code className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                  {friendlyMessage.technical.code}
                </code>
                {copiedSection === 'code' && (
                  <div className="text-xs text-green-600 dark:text-green-400 mt-1">Copied to clipboard!</div>
                )}
              </div>
            )}

            {/* Path */}
            {friendlyMessage.technical.path && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <h5 className="font-medium text-sm">File Path</h5>
                  <button
                    onClick={() => handleCopy(friendlyMessage.technical.path, 'path')}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                  >
                    <ClipboardIcon className="w-4 h-4" />
                  </button>
                </div>
                <code className="text-xs text-gray-700 dark:text-gray-300 break-all">
                  {friendlyMessage.technical.path}
                </code>
                {copiedSection === 'path' && (
                  <div className="text-xs text-green-600 dark:text-green-400 mt-1">Copied to clipboard!</div>
                )}
              </div>
            )}

            {/* Stack Trace */}
            {friendlyMessage.technical.stack && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <h5 className="font-medium text-sm">Stack Trace</h5>
                  <button
                    onClick={() => handleCopy(friendlyMessage.technical.stack, 'stack')}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                  >
                    <ClipboardIcon className="w-4 h-4" />
                  </button>
                </div>
                <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                  {friendlyMessage.technical.stack}
                </pre>
                {copiedSection === 'stack' && (
                  <div className="text-xs text-green-600 dark:text-green-400 mt-1">Copied to clipboard!</div>
                )}
              </div>
            )}

            {/* Context Information */}
            {friendlyMessage.technical.context && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <h5 className="font-medium text-sm">Context Information</h5>
                  <button
                    onClick={() => handleCopy(JSON.stringify(friendlyMessage.technical.context, null, 2), 'context')}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                  >
                    <ClipboardIcon className="w-4 h-4" />
                  </button>
                </div>
                <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1">
                  {Object.entries(friendlyMessage.technical.context).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <span className="font-medium min-w-0 flex-shrink-0">{key}:</span>
                      <span className="break-all">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                    </div>
                  ))}
                </div>
                {copiedSection === 'context' && (
                  <div className="text-xs text-green-600 dark:text-green-400 mt-1">Copied to clipboard!</div>
                )}
              </div>
            )}

            {/* Recovery Information */}
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
              <h5 className="font-medium text-sm mb-2">Recovery Strategy</h5>
              <div className="flex items-center gap-2 text-sm">
                <span>{friendlyMessage.recovery.icon}</span>
                <span className="font-medium">{friendlyMessage.recovery.name}</span>
                <span className="text-gray-500">•</span>
                <span className="text-gray-600 dark:text-gray-400">{friendlyMessage.recovery.description}</span>
              </div>
              {friendlyMessage.recovery.automated && (
                <div className="mt-2 text-xs text-blue-600 dark:text-blue-400">
                  This recovery can be automated
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ErrorDisplay;
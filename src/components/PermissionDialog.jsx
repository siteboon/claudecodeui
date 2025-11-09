import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Shield, AlertTriangle, Terminal, Code, FileText, Globe, Database, Lock, Clock, CheckCircle, XCircle } from 'lucide-react';
import { PERMISSION_DECISIONS } from '../utils/permissionWebSocketClient';
import { usePermission } from '../contexts/PermissionContext';

// Risk level assessment based on tool type
const getRiskLevel = (tool, operation) => {
  const highRiskTools = ['bash', 'terminal', 'exec', 'shell'];
  const mediumRiskTools = ['file_write', 'file_delete', 'database', 'api'];
  const lowRiskTools = ['file_read', 'search', 'list'];

  const toolLower = tool?.toLowerCase() || '';
  const opLower = operation?.toLowerCase() || '';

  if (highRiskTools.some(t => toolLower.includes(t)) || opLower.includes('delete') || opLower.includes('remove')) {
    return { level: 'high', color: 'red', icon: AlertTriangle };
  }
  if (mediumRiskTools.some(t => toolLower.includes(t)) || opLower.includes('write') || opLower.includes('modify')) {
    return { level: 'medium', color: 'yellow', icon: Shield };
  }
  return { level: 'low', color: 'green', icon: Shield };
};

// Tool icon mapping
const getToolIcon = (tool) => {
  const toolLower = tool?.toLowerCase() || '';
  if (toolLower.includes('bash') || toolLower.includes('terminal')) return Terminal;
  if (toolLower.includes('code') || toolLower.includes('script')) return Code;
  if (toolLower.includes('file')) return FileText;
  if (toolLower.includes('web') || toolLower.includes('url')) return Globe;
  if (toolLower.includes('database') || toolLower.includes('db')) return Database;
  return Shield;
};

const PermissionDialog = ({ request, onClose, sendResponse }) => {
  const { handleDecision, moveToNextRequest, queueCount } = usePermission();
  const [selectedDecision, setSelectedDecision] = useState(null);
  const [editedInput, setEditedInput] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [showDetails, setShowDetails] = useState(false);
  const dialogRef = useRef(null);
  const firstButtonRef = useRef(null);

  // Focus management
  useEffect(() => {
    firstButtonRef.current?.focus();
  }, []);

  // Countdown timer
  useEffect(() => {
    if (!request) return;

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          // Auto-deny on timeout
          handleSubmit(PERMISSION_DECISIONS.DENY);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [request]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Don't handle if editing parameters
      if (isEditing) return;

      switch (e.key.toLowerCase()) {
        case 'y':
          handleSubmit(PERMISSION_DECISIONS.ALLOW);
          break;
        case 'n':
          handleSubmit(PERMISSION_DECISIONS.DENY);
          break;
        case 'a':
          handleSubmit(PERMISSION_DECISIONS.ALLOW_ALWAYS);
          break;
        case 's':
          handleSubmit(PERMISSION_DECISIONS.ALLOW_SESSION);
          break;
        case 'd':
          handleSubmit(PERMISSION_DECISIONS.DENY);
          break;
        case 'escape':
          handleSubmit(PERMISSION_DECISIONS.DENY);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isEditing]);

  const handleSubmit = useCallback((decision) => {
    if (!request) return;

    const result = handleDecision(request.id, decision, editedInput);

    // Send WebSocket response
    if (sendResponse && result) {
      sendResponse(result.id, result.decision, result.updatedInput);
    }

    // Move to next request or close
    if (queueCount > 1) {
      moveToNextRequest();
    } else {
      onClose();
    }
  }, [request, editedInput, handleDecision, sendResponse, queueCount, moveToNextRequest, onClose]);

  const handleParameterEdit = () => {
    setIsEditing(true);
    setEditedInput(request.input || {});
  };

  const saveParameterEdits = () => {
    setIsEditing(false);
    // Validate JSON if needed
    try {
      if (typeof editedInput === 'string') {
        JSON.parse(editedInput);
      }
    } catch (error) {
      alert('Invalid JSON format');
      return;
    }
  };

  if (!request) return null;

  const risk = getRiskLevel(request.tool, request.operation);
  const ToolIcon = getToolIcon(request.tool);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div
        ref={dialogRef}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl border border-gray-200 dark:border-gray-700 animate-in slide-in-from-bottom duration-300"
        role="dialog"
        aria-labelledby="permission-title"
        aria-describedby="permission-description"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg bg-${risk.color}-100 dark:bg-${risk.color}-900/20`}>
              <ToolIcon className={`w-5 h-5 text-${risk.color}-600 dark:text-${risk.color}-400`} />
            </div>
            <div>
              <h3 id="permission-title" className="text-lg font-semibold text-gray-900 dark:text-white">
                Permission Request
              </h3>
              {queueCount > 1 && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {queueCount - 1} more in queue
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => handleSubmit(PERMISSION_DECISIONS.DENY)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Deny and close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Timeout indicator */}
        <div className="relative h-1 bg-gray-200 dark:bg-gray-700">
          <div
            className={`absolute left-0 top-0 h-full transition-all duration-1000 ${
              timeRemaining > 10 ? 'bg-blue-500' : timeRemaining > 5 ? 'bg-yellow-500' : 'bg-red-500'
            }`}
            style={{ width: `${(timeRemaining / 30) * 100}%` }}
          />
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Tool and operation info */}
          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Tool</h4>
                <p className="text-lg font-mono text-gray-900 dark:text-white">{request.tool}</p>
              </div>
              {request.operation && (
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Operation</h4>
                  <p className="text-lg font-mono text-gray-900 dark:text-white">{request.operation}</p>
                </div>
              )}
            </div>

            {/* Risk assessment */}
            <div className={`p-3 rounded-lg bg-${risk.color}-50 dark:bg-${risk.color}-900/10 border border-${risk.color}-200 dark:border-${risk.color}-800`}>
              <div className="flex items-center space-x-2">
                <risk.icon className={`w-4 h-4 text-${risk.color}-600 dark:text-${risk.color}-400`} />
                <span className={`text-sm font-medium text-${risk.color}-700 dark:text-${risk.color}-300`}>
                  {risk.level.charAt(0).toUpperCase() + risk.level.slice(1)} Risk
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {risk.level === 'high' && 'This operation can make significant changes to your system.'}
                {risk.level === 'medium' && 'This operation will modify files or data.'}
                {risk.level === 'low' && 'This operation is read-only and safe.'}
              </p>
            </div>

            {/* Description */}
            {request.description && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</h4>
                <p id="permission-description" className="text-gray-600 dark:text-gray-400">
                  {request.description}
                </p>
              </div>
            )}

            {/* Parameters */}
            {request.input && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Parameters</h4>
                  <button
                    onClick={() => setShowDetails(!showDetails)}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    {showDetails ? 'Hide' : 'Show'} Details
                  </button>
                </div>
                {showDetails && (
                  <div className="relative">
                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={typeof editedInput === 'object' ? JSON.stringify(editedInput, null, 2) : editedInput}
                          onChange={(e) => setEditedInput(e.target.value)}
                          className="w-full h-32 p-3 font-mono text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                        <div className="flex space-x-2">
                          <button
                            onClick={saveParameterEdits}
                            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setIsEditing(false);
                              setEditedInput(null);
                            }}
                            className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="relative">
                        <pre className="p-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto text-sm">
                          <code className="text-gray-800 dark:text-gray-200">
                            {typeof request.input === 'object'
                              ? JSON.stringify(editedInput || request.input, null, 2)
                              : (editedInput || request.input)
                            }
                          </code>
                        </pre>
                        <button
                          onClick={handleParameterEdit}
                          className="absolute top-2 right-2 px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Timeout warning */}
            {timeRemaining <= 5 && (
              <div className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <div className="flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-red-600 dark:text-red-400 animate-pulse" />
                  <span className="text-sm font-medium text-red-700 dark:text-red-300">
                    Auto-deny in {timeRemaining} seconds
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Decision buttons */}
        <div className="p-6 border-t border-gray-200 dark:border-gray-700 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              ref={firstButtonRef}
              onClick={() => handleSubmit(PERMISSION_DECISIONS.ALLOW)}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
            >
              <CheckCircle className="w-4 h-4" />
              <span>Allow Once</span>
              <kbd className="ml-2 px-1.5 py-0.5 text-xs bg-green-700 rounded">Y</kbd>
            </button>

            <button
              onClick={() => handleSubmit(PERMISSION_DECISIONS.DENY)}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
            >
              <XCircle className="w-4 h-4" />
              <span>Deny</span>
              <kbd className="ml-2 px-1.5 py-0.5 text-xs bg-red-700 rounded">N</kbd>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => handleSubmit(PERMISSION_DECISIONS.ALLOW_SESSION)}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Allow Session
              <kbd className="ml-1 px-1.5 py-0.5 text-xs bg-blue-700 rounded">S</kbd>
            </button>

            <button
              onClick={() => handleSubmit(PERMISSION_DECISIONS.ALLOW_ALWAYS)}
              className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Always Allow
              <kbd className="ml-1 px-1.5 py-0.5 text-xs bg-purple-700 rounded">A</kbd>
            </button>

            <button
              onClick={() => handleSubmit('never')}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-800 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Never Allow
            </button>
          </div>

          <p className="text-xs text-center text-gray-500 dark:text-gray-400">
            Press <kbd className="px-1 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs">ESC</kbd> to deny
          </p>
        </div>
      </div>
    </div>
  );
};

export default PermissionDialog;
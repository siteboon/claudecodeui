import React from 'react';
import { Shield, Terminal, Code, FileText, Globe, Database, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { PERMISSION_DECISIONS } from '../utils/permissionWebSocketClient';

// Get appropriate icon for the tool
const getToolIcon = (tool) => {
  const toolLower = tool?.toLowerCase() || '';
  if (toolLower.includes('bash') || toolLower.includes('terminal')) return Terminal;
  if (toolLower.includes('code') || toolLower.includes('script')) return Code;
  if (toolLower.includes('file')) return FileText;
  if (toolLower.includes('web') || toolLower.includes('url')) return Globe;
  if (toolLower.includes('database') || toolLower.includes('db')) return Database;
  return Shield;
};

// Assess risk level
const getRiskLevel = (tool, operation) => {
  const toolLower = tool?.toLowerCase() || '';
  const opLower = operation?.toLowerCase() || '';

  if (toolLower.includes('bash') || toolLower.includes('exec') || opLower.includes('delete')) {
    return { level: 'high', color: 'red' };
  }
  if (toolLower.includes('write') || opLower.includes('modify')) {
    return { level: 'medium', color: 'yellow' };
  }
  return { level: 'low', color: 'green' };
};

const PermissionRequestCard = ({
  request,
  isActive = false,
  isSelected = false,
  onSelect,
  onQuickAction,
  onClick,
  compact = false,
}) => {
  const ToolIcon = getToolIcon(request.tool);
  const risk = getRiskLevel(request.tool, request.operation);

  const handleQuickAction = (decision, e) => {
    e?.stopPropagation();
    onQuickAction?.(request.id, decision);
  };

  if (compact) {
    // Compact view for queue list
    return (
      <div
        className={`
          flex items-center p-2 rounded-lg border transition-all cursor-pointer
          ${isActive
            ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700'
            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
          }
          ${isSelected ? 'ring-2 ring-blue-500' : ''}
        `}
        onClick={onClick}
      >
        {onSelect && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => {
              e.stopPropagation();
              onSelect(request.id);
            }}
            className="mr-3 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
        )}

        <div className={`p-1.5 rounded bg-${risk.color}-100 dark:bg-${risk.color}-900/20 mr-3`}>
          <ToolIcon className={`w-4 h-4 text-${risk.color}-600 dark:text-${risk.color}-400`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
              {request.tool}
            </span>
            {isActive && (
              <span className="px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded">
                Active
              </span>
            )}
          </div>
          {request.operation && (
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {request.operation}
            </p>
          )}
        </div>

        {onQuickAction && (
          <div className="flex items-center space-x-1 ml-2">
            <button
              onClick={(e) => handleQuickAction(PERMISSION_DECISIONS.ALLOW, e)}
              className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
              title="Allow"
            >
              <CheckCircle className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => handleQuickAction(PERMISSION_DECISIONS.DENY, e)}
              className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
              title="Deny"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    );
  }

  // Full card view
  return (
    <div
      className={`
        p-4 rounded-lg border transition-all transform hover:scale-[1.02]
        ${isActive
          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 shadow-lg'
          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow hover:shadow-md'
        }
        ${isSelected ? 'ring-2 ring-blue-500' : ''}
        ${onClick ? 'cursor-pointer' : ''}
      `}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-3">
          {onSelect && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => {
                e.stopPropagation();
                onSelect(request.id);
              }}
              className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
          )}

          <div className={`p-2 rounded-lg bg-${risk.color}-100 dark:bg-${risk.color}-900/20`}>
            <ToolIcon className={`w-5 h-5 text-${risk.color}-600 dark:text-${risk.color}-400`} />
          </div>

          <div>
            <h4 className="font-semibold text-gray-900 dark:text-white">
              {request.tool}
            </h4>
            {request.operation && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {request.operation}
              </p>
            )}
          </div>
        </div>

        {/* Risk indicator */}
        <div className="flex items-center space-x-2">
          {risk.level === 'high' && (
            <AlertTriangle className="w-4 h-4 text-red-500" />
          )}
          <span className={`text-xs font-medium text-${risk.color}-700 dark:text-${risk.color}-400 uppercase`}>
            {risk.level} risk
          </span>
        </div>
      </div>

      {/* Description */}
      {request.description && (
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          {request.description}
        </p>
      )}

      {/* Parameters preview */}
      {request.input && (
        <div className="mb-3 p-2 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
          <pre className="text-xs text-gray-700 dark:text-gray-300 overflow-hidden">
            <code>
              {typeof request.input === 'object'
                ? JSON.stringify(request.input, null, 2).slice(0, 100) + '...'
                : String(request.input).slice(0, 100) + (request.input.length > 100 ? '...' : '')
              }
            </code>
          </pre>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
          <Clock className="w-3 h-3 mr-1" />
          {new Date(request.timestamp).toLocaleTimeString()}
        </div>

        {/* Quick actions */}
        {onQuickAction && (
          <div className="flex items-center space-x-2">
            <button
              onClick={(e) => handleQuickAction(PERMISSION_DECISIONS.ALLOW, e)}
              className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors"
            >
              Allow
            </button>
            <button
              onClick={(e) => handleQuickAction(PERMISSION_DECISIONS.DENY, e)}
              className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
            >
              Deny
            </button>
            {isActive && (
              <button
                onClick={(e) => handleQuickAction(PERMISSION_DECISIONS.ALLOW_SESSION, e)}
                className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
              >
                Session
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PermissionRequestCard;
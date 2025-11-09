import React, { useState } from 'react';
import { Shield, ChevronDown, X, CheckCircle, XCircle, Clock, Trash2 } from 'lucide-react';
import { usePermission } from '../contexts/PermissionContext';
import { PERMISSION_DECISIONS } from '../utils/permissionWebSocketClient';

const PermissionQueueIndicator = () => {
  const {
    queueCount,
    pendingRequests,
    activeRequest,
    jumpToRequest,
    handleBatchDecision,
    clearAllRequests,
  } = usePermission();

  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedRequests, setSelectedRequests] = useState(new Set());

  if (queueCount === 0) return null;

  const allRequests = activeRequest
    ? [activeRequest, ...pendingRequests]
    : pendingRequests;

  const toggleSelection = (requestId) => {
    setSelectedRequests(prev => {
      const updated = new Set(prev);
      if (updated.has(requestId)) {
        updated.delete(requestId);
      } else {
        updated.add(requestId);
      }
      return updated;
    });
  };

  const handleBatchApprove = () => {
    if (selectedRequests.size > 0) {
      handleBatchDecision(Array.from(selectedRequests), PERMISSION_DECISIONS.ALLOW);
      setSelectedRequests(new Set());
    }
  };

  const handleBatchDeny = () => {
    if (selectedRequests.size > 0) {
      handleBatchDecision(Array.from(selectedRequests), PERMISSION_DECISIONS.DENY);
      setSelectedRequests(new Set());
    }
  };

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to deny all pending permission requests?')) {
      const allIds = allRequests.map(r => r.id);
      handleBatchDecision(allIds, PERMISSION_DECISIONS.DENY);
      setShowDropdown(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {/* Main indicator button */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-lg transition-all duration-200 transform hover:scale-105"
      >
        <Shield className="w-5 h-5" />
        <span className="font-medium">{queueCount} Pending</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />

        {/* Pulsing indicator for new requests */}
        {queueCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {showDropdown && (
        <div className="absolute bottom-full right-0 mb-2 w-96 max-h-96 bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-in slide-in-from-bottom duration-200">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white">
              Permission Queue
            </h3>
            <button
              onClick={() => setShowDropdown(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Batch actions */}
          {selectedRequests.size > 0 && (
            <div className="p-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {selectedRequests.size} selected
                </span>
                <div className="flex space-x-2">
                  <button
                    onClick={handleBatchApprove}
                    className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md"
                  >
                    <CheckCircle className="w-3 h-3 inline mr-1" />
                    Approve
                  </button>
                  <button
                    onClick={handleBatchDeny}
                    className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 text-white rounded-md"
                  >
                    <XCircle className="w-3 h-3 inline mr-1" />
                    Deny
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Request list */}
          <div className="overflow-y-auto max-h-64">
            {allRequests.map((request, index) => (
              <div
                key={request.id}
                className={`p-3 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                  request.id === activeRequest?.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                }`}
              >
                <div className="flex items-center space-x-3">
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={selectedRequests.has(request.id)}
                    onChange={() => toggleSelection(request.id)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />

                  {/* Request info */}
                  <div
                    className="flex-1 cursor-pointer"
                    onClick={() => {
                      jumpToRequest(request.id);
                      setShowDropdown(false);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-gray-900 dark:text-white">
                        {request.tool}
                      </span>
                      {request.id === activeRequest?.id && (
                        <span className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full">
                          Active
                        </span>
                      )}
                    </div>
                    {request.operation && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {request.operation}
                      </span>
                    )}
                    <div className="flex items-center mt-1 text-xs text-gray-400">
                      <Clock className="w-3 h-3 mr-1" />
                      {new Date(request.timestamp).toLocaleTimeString()}
                    </div>
                  </div>

                  {/* Quick actions */}
                  <div className="flex space-x-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBatchDecision([request.id], PERMISSION_DECISIONS.ALLOW);
                      }}
                      className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
                      title="Allow"
                    >
                      <CheckCircle className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleBatchDecision([request.id], PERMISSION_DECISIONS.DENY);
                      }}
                      className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                      title="Deny"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer actions */}
          <div className="p-3 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleClearAll}
              className="w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded-md transition-colors flex items-center justify-center space-x-2"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear All</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PermissionQueueIndicator;
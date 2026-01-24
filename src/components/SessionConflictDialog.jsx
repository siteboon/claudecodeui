import {
  X,
  AlertTriangle,
  Terminal,
  MessageSquare,
  GitBranch,
  Users,
} from "lucide-react";

/**
 * SessionConflictDialog - Shows conflict resolution options when chat and shell conflict
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the dialog is visible
 * @param {Function} props.onClose - Callback when dialog is closed/cancelled
 * @param {Object} props.conflict - Conflict details from server
 * @param {string} props.conflict.conflictType - Type of conflict: 'shell-active' | 'chat-locked' | 'external-session'
 * @param {string} props.conflict.message - Human-readable conflict description
 * @param {number} props.conflict.clientCount - Number of connected shell clients
 * @param {string[]} props.conflict.options - Available resolution options
 * @param {Object} props.conflict.holder - Lock holder info (for chat-locked type)
 * @param {Function} props.onResolve - Callback when user chooses a resolution option
 */
function SessionConflictDialog({ isOpen, onClose, conflict, onResolve }) {
  if (!isOpen || !conflict) return null;

  const { conflictType, message, clientCount, options = [], holder } = conflict;

  const getTitle = () => {
    switch (conflictType) {
      case "shell-active":
        return "Shell Session Active";
      case "chat-locked":
        return "Chat Session in Progress";
      case "external-session":
        return "External Claude Session Detected";
      default:
        return "Session Conflict";
    }
  };

  const getIcon = () => {
    switch (conflictType) {
      case "shell-active":
        return <Terminal className="w-6 h-6 text-yellow-500" />;
      case "chat-locked":
        return <MessageSquare className="w-6 h-6 text-blue-500" />;
      case "external-session":
        return <AlertTriangle className="w-6 h-6 text-orange-500" />;
      default:
        return <AlertTriangle className="w-6 h-6 text-yellow-500" />;
    }
  };

  const getDescription = () => {
    switch (conflictType) {
      case "shell-active":
        return (
          <div className="space-y-2">
            <p className="text-gray-600 dark:text-gray-300">{message}</p>
            {clientCount > 0 && (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Users className="w-4 h-4" />
                <span>
                  {clientCount} client{clientCount > 1 ? "s" : ""} connected
                </span>
              </div>
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Starting a chat will block shell input until the chat completes.
            </p>
          </div>
        );
      case "chat-locked":
        return (
          <div className="space-y-2">
            <p className="text-gray-600 dark:text-gray-300">{message}</p>
            {holder && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Lock held since:{" "}
                {new Date(holder.acquiredAt).toLocaleTimeString()}
              </p>
            )}
          </div>
        );
      case "external-session":
        return (
          <div className="space-y-2">
            <p className="text-gray-600 dark:text-gray-300">
              Another Claude session may be running on this project from the
              command line or another application.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Running multiple sessions on the same project may cause conflicts.
            </p>
          </div>
        );
      default:
        return <p className="text-gray-600 dark:text-gray-300">{message}</p>;
    }
  };

  const renderOption = (option) => {
    switch (option) {
      case "close-shell":
        return (
          <button
            key={option}
            onClick={() => onResolve("close-shell")}
            className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
          >
            <Terminal className="w-4 h-4" />
            <span>Close Shell Session</span>
          </button>
        );
      case "fork-session":
        return (
          <button
            key={option}
            onClick={() => onResolve("fork-session")}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
          >
            <GitBranch className="w-4 h-4" />
            <span>Fork to New Session</span>
          </button>
        );
      case "cancel":
        return (
          <button
            key={option}
            onClick={() => {
              onResolve("cancel");
              onClose();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
            <span>Cancel</span>
          </button>
        );
      case "wait":
        return (
          <button
            key={option}
            onClick={() => {
              onResolve("wait");
              onClose();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
          >
            <span>Wait for Session</span>
          </button>
        );
      case "continue":
        return (
          <button
            key={option}
            onClick={() => {
              onResolve("continue");
              onClose();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors"
          >
            <span>Continue Anyway</span>
          </button>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
          {getIcon()}
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex-1">
            {getTitle()}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">{getDescription()}</div>

        {/* Actions */}
        <div className="flex flex-wrap justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          {options.map(renderOption)}
        </div>
      </div>
    </div>
  );
}

export default SessionConflictDialog;

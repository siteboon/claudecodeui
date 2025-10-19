import React, { useState, useEffect } from 'react';

/**
 * AutoCompactNotification - Toast notification for auto-compact events
 *
 * Displays notifications when:
 * - Auto-compact is triggered (blue)
 * - Auto-compact completes successfully (green)
 * - Auto-compact fails (red)
 *
 * Auto-dismisses success messages after 5 seconds.
 * Error messages require manual dismissal.
 *
 * @param {object} notification - Notification data from backend
 * @param {string} notification.type - Event type ('auto-compact-triggered', 'auto-compact-complete', 'auto-compact-error')
 * @param {object} notification.data - Event data
 * @param {string} notification.data.message - Display message
 * @param {number} notification.data.tokensSaved - Tokens saved (for complete events)
 * @param {function} onDismiss - Callback when notification is dismissed
 */
function AutoCompactNotification({ notification, onDismiss }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (notification?.type === 'auto-compact-complete') {
      // Auto-dismiss after 5 seconds for success messages
      const timer = setTimeout(() => {
        setVisible(false);
        onDismiss?.();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [notification, onDismiss]);

  if (!notification || !visible) return null;

  const getNotificationStyle = () => {
    switch (notification.type) {
      case 'auto-compact-triggered':
        return 'bg-blue-900 border-blue-500';
      case 'auto-compact-complete':
        return 'bg-green-900 border-green-500';
      case 'auto-compact-error':
        return 'bg-red-900 border-red-500';
      default:
        return 'bg-gray-900 border-gray-500';
    }
  };

  const getIcon = () => {
    switch (notification.type) {
      case 'auto-compact-triggered':
        return (
          <svg className="w-5 h-5 text-blue-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        );
      case 'auto-compact-complete':
        return (
          <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'auto-compact-error':
        return (
          <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`fixed top-4 right-4 z-50 max-w-md p-4 rounded-lg border-2 ${getNotificationStyle()} text-white shadow-lg animate-in slide-in-from-top duration-300`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          {/* Icon */}
          {getIcon()}

          {/* Content */}
          <div className="flex-1">
            <p className="font-medium">{notification.data?.message}</p>
            {notification.data?.tokensSaved && (
              <p className="text-sm text-gray-300 mt-1">
                Tokens saved: {notification.data.tokensSaved.toLocaleString()}
              </p>
            )}
            {notification.data?.error && (
              <p className="text-sm text-gray-300 mt-1">
                Error: {notification.data.error}
              </p>
            )}
          </div>
        </div>

        {/* Dismiss button */}
        <button
          onClick={() => {
            setVisible(false);
            onDismiss?.();
          }}
          className="ml-4 text-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default AutoCompactNotification;

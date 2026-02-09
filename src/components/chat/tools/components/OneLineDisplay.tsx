import React, { useState } from 'react';

type ActionType = 'copy' | 'open-file' | 'jump-to-results' | 'none';

interface OneLineDisplayProps {
  icon?: string;
  label?: string;
  value: string;
  secondary?: string;
  action?: ActionType;
  onAction?: () => void;
  colorScheme?: {
    primary?: string;
    secondary?: string;
  };
  resultId?: string; // For jump-to-results
}

/**
 * Unified one-line display for simple tool inputs and results
 * Used by: Bash, Read, Grep/Glob (minimized), TodoRead, etc.
 */
export const OneLineDisplay: React.FC<OneLineDisplayProps> = ({
  icon,
  label,
  value,
  secondary,
  action = 'none',
  onAction,
  colorScheme = {
    primary: 'text-gray-700 dark:text-gray-300',
    secondary: 'text-gray-500 dark:text-gray-400'
  },
  resultId
}) => {
  const [copied, setCopied] = useState(false);

  const handleAction = () => {
    if (action === 'copy' && value) {
      navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else if (onAction) {
      onAction();
    }
  };

  const renderActionButton = () => {
    if (action === 'none') return null;

    if (action === 'copy') {
      return (
        <button
          onClick={handleAction}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors ml-1"
          title="Copy to clipboard"
          aria-label="Copy to clipboard"
        >
          {copied ? (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>
      );
    }

    if (action === 'open-file') {
      return (
        <button
          onClick={handleAction}
          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline font-mono transition-colors"
        >
          {value.split('/').pop()}
        </button>
      );
    }

    if (action === 'jump-to-results' && resultId) {
      return (
        <a
          href={`#${resultId}`}
          className="flex-shrink-0 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors flex items-center gap-1"
        >
          <span>Search results</span>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </a>
      );
    }

    return null;
  };

  return (
    <div className="mt-2 text-sm flex items-center gap-2">
      {/* Icon */}
      {icon && (
        <span className={`${colorScheme.primary} text-xs flex-shrink-0`}>
          {icon}
        </span>
      )}

      {/* Label */}
      {label && (
        <span className={colorScheme.primary}>{label}</span>
      )}

      {/* Value - different rendering based on action type */}
      {action === 'open-file' ? (
        renderActionButton()
      ) : (
        <span className={`${colorScheme.primary} ${action === 'none' ? '' : 'font-mono'}`}>
          {value}
        </span>
      )}

      {/* Secondary text (e.g., description) */}
      {secondary && (
        <span className={`text-xs ${colorScheme.secondary} italic`}>
          ({secondary})
        </span>
      )}

      {/* Action button (copy, jump) */}
      {action !== 'open-file' && renderActionButton()}
    </div>
  );
};

import React, { useState } from 'react';

type ActionType = 'copy' | 'open-file' | 'jump-to-results' | 'none';

interface OneLineDisplayProps {
  toolName: string;
  icon?: string;
  label?: string;
  value: string;
  secondary?: string;
  action?: ActionType;
  onAction?: () => void;
  style?: string;
  wrapText?: boolean;
  colorScheme?: {
    primary?: string;
    secondary?: string;
    background?: string;
    border?: string;
    icon?: string;
  };
  resultId?: string;
  toolResult?: any;
  toolId?: string;
}

/**
 * Unified one-line display for simple tool inputs and results
 * Used by: Bash, Read, Grep/Glob (minimized), TodoRead, etc.
 */
export const OneLineDisplay: React.FC<OneLineDisplayProps> = ({
  toolName,
  icon,
  label,
  value,
  secondary,
  action = 'none',
  onAction,
  style,
  wrapText = false,
  colorScheme = {
    primary: 'text-gray-700 dark:text-gray-300',
    secondary: 'text-gray-500 dark:text-gray-400',
    background: 'bg-gray-50/50 dark:bg-gray-800/30',
    border: 'border-blue-400 dark:border-blue-500',
    icon: 'text-blue-500 dark:text-blue-400'
  },
  resultId,
  toolResult,
  toolId
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
  const isTerminal = style === 'terminal';

  return (
    <div className={`group relative ${colorScheme.background} border-l-2 ${colorScheme.border} pl-3 py-1 my-0.5`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 flex-1 min-w-0">
          {icon === 'terminal' ? (
            <svg className={`w-3.5 h-3.5 ${colorScheme.icon} flex-shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          ) : icon ? (
            <span className={`${colorScheme.icon} flex-shrink-0`}>
              {icon}
            </span>
          ) : label ? (
            <span className="font-medium flex-shrink-0">{label}</span>
          ) : (
            <span className="font-medium flex-shrink-0">{toolName}</span>
          )}

          <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">•</span>

          {action === 'open-file' ? (
            renderActionButton()
          ) : (
            <span className={`font-mono ${wrapText ? 'whitespace-pre-wrap break-all' : 'truncate'} flex-1 min-w-0 ${colorScheme.primary}`}>
              {isTerminal && <span className="text-green-500 dark:text-green-400 mr-1">$</span>}
              {value}
            </span>
          )}

          {secondary && (
            <span className={`text-xs ${colorScheme.secondary} italic ml-2`}>
              ({secondary})
            </span>
          )}

          {action === 'copy' && renderActionButton()}
        </div>

        {action === 'jump-to-results' && toolResult && (
          <a
            href={`#tool-result-${toolId}`}
            className="flex-shrink-0 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors flex items-center gap-1"
          >
            <span>Search results</span>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
};

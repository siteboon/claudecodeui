import React from 'react';
import { CollapsibleSection } from './CollapsibleSection';

type ContentType = 'diff' | 'markdown' | 'file-list' | 'todo-list' | 'text';

interface CollapsibleDisplayProps {
  toolName: string;
  toolId?: string;
  title: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  contentType: ContentType;
  contentProps: any;
  showRawParameters?: boolean;
  rawContent?: string;
  className?: string;
  onShowSettings?: () => void;
}

export const CollapsibleDisplay: React.FC<CollapsibleDisplayProps> = ({
  toolName,
  toolId,
  title,
  defaultOpen = false,
  action,
  contentType,
  contentProps,
  showRawParameters = false,
  rawContent,
  className = '',
  onShowSettings
}) => {
  const renderContent = () => {
    switch (contentType) {
      case 'diff':
        return contentProps.DiffViewer;

      case 'markdown':
        return contentProps.MarkdownComponent;

      case 'file-list':
        return contentProps.FileListComponent;

      case 'todo-list':
        return contentProps.TodoListComponent;

      case 'text':
        return contentProps.TextComponent;

      default:
        return <div className="text-gray-500">Unknown content type: {contentType}</div>;
    }
  };
  return (
    <div className="group relative bg-gradient-to-br from-blue-50/50 to-indigo-50/50 dark:from-blue-950/20 dark:to-indigo-950/20 border border-blue-100/30 dark:border-blue-800/30 rounded-lg p-3 mb-2">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/3 to-indigo-500/3 dark:from-blue-400/3 dark:to-indigo-400/3 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

      <div className="relative flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="relative w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 dark:from-blue-400 dark:to-indigo-500 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20 dark:shadow-blue-400/20">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <div className="absolute inset-0 rounded-lg bg-blue-500 dark:bg-blue-400 animate-pulse opacity-20"></div>
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-gray-900 dark:text-white text-sm">
              {toolName}
            </span>
            {toolId && (
              <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                {toolId}
              </span>
            )}
          </div>
        </div>
        {onShowSettings && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onShowSettings();
            }}
            className="p-2 rounded-lg hover:bg-white/60 dark:hover:bg-gray-800/60 transition-all duration-200 group/btn backdrop-blur-sm"
            title="Settings"
          >
            <svg className="w-4 h-4 text-gray-600 dark:text-gray-400 group-hover/btn:text-blue-600 dark:group-hover/btn:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
      </div>

      <CollapsibleSection
        title={title}
        open={defaultOpen}
        action={action}
        className={className}
      >
        {renderContent()}

        {showRawParameters && rawContent && (
          <details className="relative mt-3 pl-6 group/raw" open={defaultOpen}>
            <summary className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
              <svg
                className="w-3 h-3 transition-transform duration-200 group-open/raw:rotate-180"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              View raw parameters
            </summary>
            <pre className="mt-2 text-xs bg-gray-50 dark:bg-gray-800/50 border border-gray-200/60 dark:border-gray-700/60 p-3 rounded-lg whitespace-pre-wrap break-words overflow-hidden text-gray-700 dark:text-gray-300 font-mono">
              {rawContent}
            </pre>
          </details>
        )}
      </CollapsibleSection>
    </div>
  );
};

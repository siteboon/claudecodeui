import React from 'react';
import { CollapsibleSection } from './CollapsibleSection';

type ContentType = 'diff' | 'markdown' | 'file-list' | 'todo-list' | 'text';

interface CollapsibleDisplayProps {
  title: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  contentType: ContentType;
  contentProps: any;
  showRawParameters?: boolean;
  rawContent?: string;
  className?: string;
}

/**
 * Unified collapsible display for complex tool inputs and results
 * Used by: Edit, Write, Plan, TodoWrite, Grep/Glob (results), etc.
 *
 * Content is rendered by specialized components based on contentType
 */
export const CollapsibleDisplay: React.FC<CollapsibleDisplayProps> = ({
  title,
  defaultOpen = false,
  action,
  contentType,
  contentProps,
  showRawParameters = false,
  rawContent,
  className = ''
}) => {
  // Import content renderers dynamically based on type
  const renderContent = () => {
    switch (contentType) {
      case 'diff':
        // DiffViewer already exists - will be imported by ToolRenderer
        return contentProps.DiffViewer;

      case 'markdown':
        // Markdown component already exists - will be imported by ToolRenderer
        return contentProps.MarkdownComponent;

      case 'file-list':
        // FileListContent will be created
        return contentProps.FileListComponent;

      case 'todo-list':
        // TodoListContent will be created
        return contentProps.TodoListComponent;

      case 'text':
        // TextContent will be created
        return contentProps.TextComponent;

      default:
        return <div className="text-gray-500">Unknown content type: {contentType}</div>;
    }
  };

  return (
    <CollapsibleSection
      title={title}
      open={defaultOpen}
      action={action}
      className={className}
    >
      {/* Main content */}
      {renderContent()}

      {/* Optional raw parameters viewer */}
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
  );
};

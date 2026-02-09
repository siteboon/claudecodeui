import React from 'react';
import { CollapsibleSection } from './CollapsibleSection';

type ContentType = 'diff' | 'markdown' | 'file-list' | 'todo-list' | 'text' | 'task' | 'success-message';

interface CollapsibleDisplayProps {
  toolName: string;
  toolId?: string;
  title: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  onTitleClick?: () => void;
  contentType: ContentType;
  contentProps: any;
  showRawParameters?: boolean;
  rawContent?: string;
  className?: string;
  onShowSettings?: () => void;
  toolCategory?: string;
}

const borderColorMap: Record<string, string> = {
  edit: 'border-l-amber-500 dark:border-l-amber-400',
  search: 'border-l-gray-400 dark:border-l-gray-500',
  bash: 'border-l-green-500 dark:border-l-green-400',
  todo: 'border-l-violet-500 dark:border-l-violet-400',
  task: 'border-l-violet-500 dark:border-l-violet-400',
  plan: 'border-l-indigo-500 dark:border-l-indigo-400',
  default: 'border-l-gray-300 dark:border-l-gray-600',
};

export const CollapsibleDisplay: React.FC<CollapsibleDisplayProps> = ({
  toolName,
  title,
  defaultOpen = false,
  action,
  onTitleClick,
  contentType,
  contentProps,
  showRawParameters = false,
  rawContent,
  className = '',
  toolCategory
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
      case 'task':
        return contentProps.TaskComponent;
      case 'text':
        return contentProps.TextComponent;
      default:
        return <div className="text-xs text-gray-500">Unknown content type: {contentType}</div>;
    }
  };

  const borderColor = borderColorMap[toolCategory || 'default'];

  return (
    <div className={`border-l-2 ${borderColor} pl-3 py-0.5 my-1 ${className}`}>
      <CollapsibleSection
        title={title}
        toolName={toolName}
        open={defaultOpen}
        action={action}
        onTitleClick={onTitleClick}
      >
        {renderContent()}

        {showRawParameters && rawContent && (
          <details className="relative mt-2 group/raw">
            <summary className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 py-0.5">
              <svg
                className="w-2.5 h-2.5 transition-transform duration-150 group-open/raw:rotate-90"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              raw params
            </summary>
            <pre className="mt-1 text-[11px] bg-gray-50 dark:bg-gray-900/50 border border-gray-200/40 dark:border-gray-700/40 p-2 rounded whitespace-pre-wrap break-words overflow-hidden text-gray-600 dark:text-gray-400 font-mono">
              {rawContent}
            </pre>
          </details>
        )}
      </CollapsibleSection>
    </div>
  );
};

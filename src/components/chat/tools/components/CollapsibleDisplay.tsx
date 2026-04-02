import React from 'react';
import { CollapsibleSection } from './CollapsibleSection';

interface CollapsibleDisplayProps {
  toolName: string;
  toolId?: string;
  title: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  onTitleClick?: () => void;
  children: React.ReactNode;
  showRawParameters?: boolean;
  rawContent?: string;
  className?: string;
  toolCategory?: string;
}

const borderColorMap: Record<string, string> = {
  edit: 'border-l-amber-500 dark:border-l-amber-400',
  search: 'border-l-gray-400 dark:border-l-gray-500',
  bash: 'border-l-green-500 dark:border-l-green-400',
  todo: 'border-l-violet-500 dark:border-l-violet-400',
  task: 'border-l-violet-500 dark:border-l-violet-400',
  agent: 'border-l-purple-500 dark:border-l-purple-400',
  plan: 'border-l-indigo-500 dark:border-l-indigo-400',
  question: 'border-l-blue-500 dark:border-l-blue-400',
  default: 'border-l-gray-300 dark:border-l-gray-600',
};

export const CollapsibleDisplay: React.FC<CollapsibleDisplayProps> = ({
  toolName,
  title,
  defaultOpen = false,
  action,
  onTitleClick,
  children,
  showRawParameters = false,
  rawContent,
  className = '',
  toolCategory
}) => {
  // Fall back to default styling for unknown/new categories so className never includes "undefined".
  const borderColor = borderColorMap[toolCategory || 'default'] || borderColorMap.default;

  return (
    <div className={`border-l-2 ${borderColor} my-1 py-0.5 pl-3 ${className}`}>
      <CollapsibleSection
        title={title}
        toolName={toolName}
        open={defaultOpen}
        action={action}
        onTitleClick={onTitleClick}
      >
        {children}

        {showRawParameters && rawContent && (
          <details className="group/raw relative mt-2">
            <summary className="flex cursor-pointer items-center gap-1.5 py-0.5 text-[11px] text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
              <svg
                className="h-2.5 w-2.5 transition-transform duration-150 group-open/raw:rotate-90"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              raw params
            </summary>
            <pre className="mt-1 overflow-hidden whitespace-pre-wrap break-words rounded border border-gray-200/40 bg-gray-50 p-2 font-mono text-[11px] text-gray-600 dark:border-gray-700/40 dark:bg-gray-900/50 dark:text-gray-400">
              {rawContent}
            </pre>
          </details>
        )}
      </CollapsibleSection>
    </div>
  );
};

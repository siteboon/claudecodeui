import React from 'react';

interface CollapsibleSectionProps {
  title: string;
  toolName?: string;
  open?: boolean;
  action?: React.ReactNode;
  onTitleClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Reusable collapsible section with consistent styling
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  toolName,
  open = false,
  action,
  onTitleClick,
  children,
  className = ''
}) => {
  return (
    <details className={`relative group/details ${className}`} open={open}>
      <summary className="flex items-center gap-1.5 text-xs cursor-pointer py-0.5 select-none group-open/details:sticky group-open/details:top-0 group-open/details:z-10 group-open/details:bg-background group-open/details:-mx-1 group-open/details:px-1">
        <svg
          className="w-3 h-3 text-gray-400 dark:text-gray-500 transition-transform duration-150 group-open/details:rotate-90 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {toolName && (
          <span className="font-medium text-gray-500 dark:text-gray-400 flex-shrink-0">{toolName}</span>
        )}
        {toolName && (
          <span className="text-gray-300 dark:text-gray-600 text-[10px] flex-shrink-0">/</span>
        )}
        {onTitleClick ? (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTitleClick(); }}
            className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-mono hover:underline truncate flex-1 text-left transition-colors"
          >
            {title}
          </button>
        ) : (
          <span className="text-gray-600 dark:text-gray-400 truncate flex-1">
            {title}
          </span>
        )}
        {action && <span className="flex-shrink-0 ml-1">{action}</span>}
      </summary>
      <div className="mt-1.5 pl-[18px]">
        {children}
      </div>
    </details>
  );
};

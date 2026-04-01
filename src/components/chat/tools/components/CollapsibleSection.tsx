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
    <details className={`group/details relative ${className}`} open={open}>
      <summary className="flex cursor-pointer select-none items-center gap-1.5 py-0.5 text-xs group-open/details:sticky group-open/details:top-0 group-open/details:z-10 group-open/details:-mx-1 group-open/details:bg-background group-open/details:px-1">
        <svg
          className="h-3 w-3 flex-shrink-0 text-gray-400 transition-transform duration-150 group-open/details:rotate-90 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {toolName && (
          <span className="flex-shrink-0 font-medium text-gray-500 dark:text-gray-400">{toolName}</span>
        )}
        {toolName && (
          <span className="flex-shrink-0 text-[10px] text-gray-300 dark:text-gray-600">/</span>
        )}
        {onTitleClick ? (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTitleClick(); }}
            className="flex-1 truncate text-left font-mono text-blue-600 transition-colors hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
          >
            {title}
          </button>
        ) : (
          <span className="flex-1 truncate text-gray-600 dark:text-gray-400">
            {title}
          </span>
        )}
        {action && <span className="ml-1 flex-shrink-0">{action}</span>}
      </summary>
      <div className="mt-1.5 pl-[18px]">
        {children}
      </div>
    </details>
  );
};

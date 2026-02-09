import React from 'react';

interface CollapsibleSectionProps {
  title: string;
  open?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Reusable collapsible section with consistent styling
 * Replaces repeated details/summary patterns throughout MessageComponent
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  open = false,
  action,
  children,
  className = ''
}) => {
  return (
    <details className={`relative mt-3 group/details ${className}`} open={open}>
      <summary className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2.5 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
        <svg
          className="w-4 h-4 transition-transform duration-200 group-open/details:rotate-180"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        <span className="flex items-center gap-2 flex-1">
          {title}
        </span>
        {action}
      </summary>
      <div className="mt-3 pl-6">
        {children}
      </div>
    </details>
  );
};

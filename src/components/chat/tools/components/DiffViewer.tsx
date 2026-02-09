import React from 'react';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

interface DiffViewerProps {
  oldContent: string;
  newContent: string;
  filePath: string;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileClick?: () => void;
  badge?: string;
  badgeColor?: 'gray' | 'green';
}

/**
 * Reusable diff viewer component with consistent styling
 * Replaces duplicated diff display logic in Edit, Write, and result sections
 */
export const DiffViewer: React.FC<DiffViewerProps> = ({
  oldContent,
  newContent,
  filePath,
  createDiff,
  onFileClick,
  badge = 'Diff',
  badgeColor = 'gray'
}) => {
  const badgeClasses = badgeColor === 'green'
    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
    : 'bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400';

  return (
    <div className="bg-white dark:bg-gray-900/50 border border-gray-200/60 dark:border-gray-700/60 rounded-lg overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100/50 dark:from-gray-800/80 dark:to-gray-800/40 border-b border-gray-200/60 dark:border-gray-700/60 backdrop-blur-sm">
        {onFileClick ? (
          <button
            onClick={onFileClick}
            className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 truncate cursor-pointer font-medium transition-colors"
          >
            {filePath}
          </button>
        ) : (
          <span className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate">
            {filePath}
          </span>
        )}
        <span className={`text-xs font-medium px-2 py-0.5 rounded ${badgeClasses}`}>
          {badge}
        </span>
      </div>

      {/* Diff content */}
      <div className="text-xs font-mono">
        {createDiff(oldContent, newContent).map((diffLine, i) => (
          <div key={i} className="flex">
            <span
              className={`w-8 text-center border-r ${
                diffLine.type === 'removed'
                  ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800'
                  : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800'
              }`}
            >
              {diffLine.type === 'removed' ? '-' : '+'}
            </span>
            <span
              className={`px-2 py-0.5 flex-1 whitespace-pre-wrap ${
                diffLine.type === 'removed'
                  ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
                  : 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
              }`}
            >
              {diffLine.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

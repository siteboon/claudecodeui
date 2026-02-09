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
 * Compact diff viewer — VS Code-style
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
    ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400';

  return (
    <div className="border border-gray-200/60 dark:border-gray-700/50 rounded overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-1 bg-gray-50/80 dark:bg-gray-800/40 border-b border-gray-200/60 dark:border-gray-700/50">
        {onFileClick ? (
          <button
            onClick={onFileClick}
            className="text-[11px] font-mono text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 truncate cursor-pointer transition-colors"
          >
            {filePath}
          </button>
        ) : (
          <span className="text-[11px] font-mono text-gray-600 dark:text-gray-400 truncate">
            {filePath}
          </span>
        )}
        <span className={`text-[10px] font-medium px-1.5 py-px rounded ${badgeClasses} flex-shrink-0 ml-2`}>
          {badge}
        </span>
      </div>

      {/* Diff lines */}
      <div className="text-[11px] font-mono leading-[18px]">
        {createDiff(oldContent, newContent).map((diffLine, i) => (
          <div key={i} className="flex">
            <span
              className={`w-6 text-center select-none flex-shrink-0 ${
                diffLine.type === 'removed'
                  ? 'bg-red-50 dark:bg-red-950/30 text-red-400 dark:text-red-500'
                  : 'bg-green-50 dark:bg-green-950/30 text-green-400 dark:text-green-500'
              }`}
            >
              {diffLine.type === 'removed' ? '-' : '+'}
            </span>
            <span
              className={`px-2 flex-1 whitespace-pre-wrap ${
                diffLine.type === 'removed'
                  ? 'bg-red-50/50 dark:bg-red-950/20 text-red-800 dark:text-red-200'
                  : 'bg-green-50/50 dark:bg-green-950/20 text-green-800 dark:text-green-200'
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

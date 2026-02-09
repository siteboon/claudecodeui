import React from 'react';

interface FileListItem {
  path: string;
  onClick?: () => void;
}

interface FileListContentProps {
  files: string[] | FileListItem[];
  onFileClick?: (filePath: string) => void;
  title?: string;
}

/**
 * Renders a list of files with click handlers
 * Used by: Grep/Glob results
 */
export const FileListContent: React.FC<FileListContentProps> = ({
  files,
  onFileClick,
  title
}) => {
  const fileCount = files.length;

  return (
    <div>
      {title && (
        <div className="flex items-center gap-2 mb-3">
          <span className="font-medium">
            {title || `Found ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`}
          </span>
        </div>
      )}
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {files.map((file, index) => {
          const filePath = typeof file === 'string' ? file : file.path;
          const fileName = filePath.split('/').pop() || filePath;
          const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
          const handleClick = typeof file === 'string'
            ? () => onFileClick?.(file)
            : file.onClick;

          return (
            <div
              key={index}
              onClick={handleClick}
              className="group flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer transition-colors"
            >
              {/* File icon */}
              <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>

              {/* File path */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {fileName}
                </div>
                {dirPath && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {dirPath}
                  </div>
                )}
              </div>

              {/* Chevron on hover */}
              <svg className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          );
        })}
      </div>
    </div>
  );
};

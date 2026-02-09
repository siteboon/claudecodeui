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
 * Renders a compact comma-separated list of clickable file names
 * Used by: Grep/Glob results
 */
export const FileListContent: React.FC<FileListContentProps> = ({
  files,
  onFileClick,
  title
}) => {
  return (
    <div>
      {title && (
        <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
          {title}
        </div>
      )}
      <div className="flex flex-wrap gap-x-1 gap-y-0.5 max-h-48 overflow-y-auto">
        {files.map((file, index) => {
          const filePath = typeof file === 'string' ? file : file.path;
          const fileName = filePath.split('/').pop() || filePath;
          const handleClick = typeof file === 'string'
            ? () => onFileClick?.(file)
            : file.onClick;

          return (
            <span key={index} className="inline-flex items-center">
              <button
                onClick={handleClick}
                className="text-[11px] font-mono text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors"
                title={filePath}
              >
                {fileName}
              </button>
              {index < files.length - 1 && (
                <span className="text-gray-300 dark:text-gray-600 text-[10px] ml-1">,</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
};

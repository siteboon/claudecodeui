import React from 'react';

interface FilePathButtonProps {
  filePath: string;
  onClick: () => void;
  variant?: 'button' | 'link';
  showFullPath?: boolean;
  className?: string;
}

/**
 * Clickable file path — inline link style
 */
export const FilePathButton: React.FC<FilePathButtonProps> = ({
  filePath,
  onClick,
  variant = 'button',
  showFullPath = false,
  className = ''
}) => {
  const filename = filePath.split('/').pop() || filePath;
  const displayText = showFullPath ? filePath : filename;

  if (variant === 'link') {
    return (
      <button
        onClick={onClick}
        className={`text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-mono text-xs hover:underline transition-colors ${className}`}
      >
        {displayText}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-mono text-xs hover:underline transition-colors ${className}`}
      title={filePath}
    >
      {displayText}
    </button>
  );
};

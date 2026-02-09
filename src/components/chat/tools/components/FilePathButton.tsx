import React from 'react';

interface FilePathButtonProps {
  filePath: string;
  onClick: () => void;
  variant?: 'button' | 'link';
  showFullPath?: boolean;
  className?: string;
}

/**
 * Reusable clickable file path component with consistent styling
 * Used across Edit, Write, and Read tool displays
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
        className={`text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline font-mono transition-colors ${className}`}
      >
        {displayText}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md bg-white/60 dark:bg-gray-800/60 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 font-mono text-xs font-medium transition-all duration-200 shadow-sm ${className}`}
    >
      {displayText}
    </button>
  );
};

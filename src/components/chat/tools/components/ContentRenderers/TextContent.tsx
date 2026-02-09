import React from 'react';

interface TextContentProps {
  content: string;
  format?: 'plain' | 'json' | 'code';
  className?: string;
}

/**
 * Renders plain text, JSON, or code content
 * Used by: Raw parameters, generic text results, JSON responses
 */
export const TextContent: React.FC<TextContentProps> = ({
  content,
  format = 'plain',
  className = ''
}) => {
  if (format === 'json') {
    let formattedJson = content;
    try {
      const parsed = JSON.parse(content);
      formattedJson = JSON.stringify(parsed, null, 2);
    } catch (e) {
      // If parsing fails, use original content
    }

    return (
      <pre className={`mt-1 text-xs bg-gray-900 dark:bg-gray-950 text-gray-100 p-2.5 rounded overflow-x-auto font-mono ${className}`}>
        {formattedJson}
      </pre>
    );
  }

  if (format === 'code') {
    return (
      <pre className={`mt-1 text-xs bg-gray-50 dark:bg-gray-800/50 border border-gray-200/50 dark:border-gray-700/50 p-2 rounded whitespace-pre-wrap break-words overflow-hidden text-gray-700 dark:text-gray-300 font-mono ${className}`}>
        {content}
      </pre>
    );
  }

  // Plain text
  return (
    <div className={`mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap ${className}`}>
      {content}
    </div>
  );
};

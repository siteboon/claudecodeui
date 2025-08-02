import React, { lazy, Suspense } from 'react';

const CodeBlock = lazy(() => import('./CodeBlock'));

const CodeBlockFallback = ({ children, className = '' }) => (
  <code className={`block bg-gray-100 dark:bg-gray-800 p-3 rounded-lg overflow-x-auto my-4 text-gray-800 dark:text-gray-200 text-sm font-mono whitespace-pre-wrap break-words ${className}`}>
    {children}
  </code>
);

export const LazyCodeBlock = (props) => (
  <Suspense fallback={<CodeBlockFallback {...props} />}>
    <CodeBlock {...props} />
  </Suspense>
);

export const MarkdownCodeBlock = ({ node, inline, className, children, ...props }) => {
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';

  const isInline = inline !== undefined ? inline : !match;

  if (isInline) {
    return (
      <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-mono text-sm font-normal">
        {children}
      </code>
    );
  }

  return (
    <LazyCodeBlock
      language={language}
      inline={false}
      className={className}
    >
      {children}
    </LazyCodeBlock>
  );
};

export default LazyCodeBlock;

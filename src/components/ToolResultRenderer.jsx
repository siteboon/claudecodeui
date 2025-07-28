import React, { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { extractToolContent, sanitizeContent, truncateContent, preprocessMarkdown } from '../utils/markdownUtils';
import { MarkdownCodeBlock } from './CodeBlockLazy';
import TodoList from './TodoList';

/**
 * Component for rendering tool results with enhanced markdown support
 */
const ToolResultRenderer = memo(({
  toolName,
  toolInput,
  toolResult,
  showRawParameters = false,
  autoExpandTools = true,
  className = ''
}) => {
  // Extract meaningful content from tool result with error handling
  const extractedContent = useMemo(() => {
    try {
      return extractToolContent(toolName, toolInput, toolResult);
    } catch (error) {
      console.error('Error extracting tool content:', error);
      return {
        contentType: 'text',
        primaryContent: toolInput || '',
        metadata: { toolName },
        fallback: true
      };
    }
  }, [toolName, toolInput, toolResult]);

  // Sanitize and prepare content for rendering
  const { primaryContent, contentType, metadata, fallback } = extractedContent;
  const sanitizedContent = sanitizeContent(primaryContent);
  const { content: displayContent, isTruncated, fullLength } = truncateContent(sanitizedContent, 10000);

  // Special handling for TodoWrite tool
  if (toolName === 'TodoWrite') {
    try {
      const input = JSON.parse(toolInput);
      if (input.todos && Array.isArray(input.todos)) {
        return (
          <details className="mt-2" open={autoExpandTools}>
            <summary className="text-sm text-blue-700 dark:text-blue-300 cursor-pointer hover:text-blue-800 dark:hover:text-blue-200 flex items-center gap-2">
              <svg className="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              Updating Todo List
            </summary>
            <div className="mt-3">
              <TodoList todos={input.todos} />
              {showRawParameters && (
                <RawParametersView content={toolInput} />
              )}
            </div>
          </details>
        );
      }
    } catch (e) {
      // Fall through to default rendering
    }
  }

  // Special handling for exit_plan_mode with enhanced markdown
  if (toolName === 'exit_plan_mode' || toolName === 'ExitPlanMode') {
    return (
      <details className="mt-2" open={autoExpandTools}>
        <summary className="text-sm text-blue-700 dark:text-blue-300 cursor-pointer hover:text-blue-800 dark:hover:text-blue-200 flex items-center gap-2">
          <svg className="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          📋 {metadata?.title || 'View implementation plan'}
        </summary>
        <div className="mt-3">
          <MarkdownContent content={displayContent} />
          {isTruncated && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Content truncated ({fullLength} characters total)
            </p>
          )}
          {showRawParameters && (
            <RawParametersView content={toolInput} />
          )}
        </div>
      </details>
    );
  }

  // Result tool with enhanced display
  if (toolName === 'Result' && !fallback) {
    return (
      <div className={`mt-2 ${className}`}>
        <div className="flex items-center gap-2 mb-2 text-green-700 dark:text-green-300">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="font-medium">Result</span>
        </div>
        <div className="ml-6">
          <MarkdownContent content={displayContent} contentType={contentType} />
          {isTruncated && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Content truncated ({fullLength} characters total)
            </p>
          )}
        </div>
      </div>
    );
  }

  // Generic tool result rendering
  if (!fallback && primaryContent && primaryContent !== toolInput) {
    return (
      <details className="mt-2" open={autoExpandTools}>
        <summary className="text-sm text-blue-700 dark:text-blue-300 cursor-pointer hover:text-blue-800 dark:hover:text-blue-200 flex items-center gap-2">
          <svg className="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          {metadata?.title || `View ${toolName} result`}
        </summary>
        <div className="mt-3">
          <MarkdownContent content={displayContent} contentType={contentType} metadata={metadata} />
          {isTruncated && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Content truncated ({fullLength} characters total)
            </p>
          )}
          {showRawParameters && (
            <RawParametersView content={toolInput} />
          )}
        </div>
      </details>
    );
  }

  // Fallback to raw parameters display
  return showRawParameters ? (
    <details className="mt-2" open={autoExpandTools}>
      <summary className="text-sm text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
        View {toolName} parameters
      </summary>
      <RawParametersView content={toolInput} />
    </details>
  ) : null;
});

/**
 * Component for rendering markdown content with enhanced features
 */
const MarkdownContent = memo(({ content, contentType = 'markdown', metadata = {} }) => {
  // Custom components for ReactMarkdown
  const components = useMemo(() => ({
    code: MarkdownCodeBlock,
    pre: ({ children }) => <>{children}</>, // Remove default pre wrapper
    table: ({ children }) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>
    ),
    th: ({ children }) => (
      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
        {children}
      </td>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 dark:text-blue-400 hover:underline"
      >
        {children}
      </a>
    ),
  }), []);

  if (contentType === 'json') {
    return (
      <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-x-auto">
        <code className="text-gray-900 dark:text-gray-100">
          {content}
        </code>
      </pre>
    );
  }

  if (contentType === 'text' && metadata.language) {
    return (
      <MarkdownCodeBlock language={metadata.language}>
        {content}
      </MarkdownCodeBlock>
    );
  }

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown components={components}>
        {preprocessMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
});

/**
 * Component for displaying raw parameters
 */
const RawParametersView = memo(({ content }) => (
  <details className="mt-3">
    <summary className="text-xs text-blue-600 dark:text-blue-400 cursor-pointer hover:text-blue-700 dark:hover:text-blue-300">
      View raw parameters
    </summary>
    <pre className="mt-2 text-xs bg-blue-100 dark:bg-blue-800/30 p-2 rounded whitespace-pre-wrap break-words overflow-hidden text-blue-900 dark:text-blue-100">
      {content}
    </pre>
  </details>
));

ToolResultRenderer.displayName = 'ToolResultRenderer';
MarkdownContent.displayName = 'MarkdownContent';
RawParametersView.displayName = 'RawParametersView';

export default ToolResultRenderer;

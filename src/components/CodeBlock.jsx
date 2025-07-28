import React, { useState, memo, useCallback } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from '../contexts/ThemeContext';

/**
 * Enhanced code block component with syntax highlighting and copy functionality
 */
const CodeBlock = memo(({ 
  language = '', 
  children, 
  inline = false,
  showLineNumbers = false,
  className = ''
}) => {
  const [copied, setCopied] = useState(false);
  const { isDarkMode } = useTheme();
  
  const code = String(children).replace(/\n$/, '');

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
      // Fallback for older browsers
      try {
        const textArea = document.createElement('textarea');
        textArea.value = code;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (fallbackErr) {
        console.error('Fallback copy also failed:', fallbackErr);
      }
    }
  }, [code]);

  // Inline code rendering
  if (inline) {
    return (
      <code className={`px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-blue-600 dark:text-blue-400 font-mono text-sm ${className}`}>
        {children}
      </code>
    );
  }

  // Full code block rendering - use a span wrapper to avoid div in p issue
  const codeBlock = (
    <span className="block relative group my-4">
      <span className="absolute right-2 top-2 z-10 block">
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 px-2 py-1 text-xs bg-gray-700 dark:bg-gray-600 text-white rounded hover:bg-gray-600 dark:hover:bg-gray-500 flex items-center gap-1"
          title="Copy code"
        >
          {copied ? (
            <>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy
            </>
          )}
        </button>
      </span>
      
      {language && (
        <span className="absolute left-3 top-2 text-xs text-gray-400 dark:text-gray-500 font-mono block">
          {language}
        </span>
      )}

      <SyntaxHighlighter
        language={language || 'text'}
        style={isDarkMode ? oneDark : oneLight}
        showLineNumbers={showLineNumbers}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          padding: language ? '2.5rem 1rem 1rem' : '1rem',
        }}
        codeTagProps={{
          style: {
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
          }
        }}
      >
        {code}
      </SyntaxHighlighter>
    </span>
  );

  return codeBlock;
});

CodeBlock.displayName = 'CodeBlock';

/**
 * Wrapper component for use with ReactMarkdown
 */
export const MarkdownCodeBlock = ({ node, inline, className, children, ...props }) => {
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';

  return (
    <CodeBlock 
      language={language} 
      inline={inline}
      className={className}
      {...props}
    >
      {children}
    </CodeBlock>
  );
};

export default CodeBlock;
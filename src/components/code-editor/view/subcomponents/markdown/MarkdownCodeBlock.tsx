import { useState } from 'react';
import type { ComponentProps } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark as prismOneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { copyTextToClipboard } from '../../../../../utils/clipboard';

type MarkdownCodeBlockProps = {
  inline?: boolean;
  node?: unknown;
} & ComponentProps<'code'>;

export default function MarkdownCodeBlock({
  inline,
  className,
  children,
  node: _node,
  ...props
}: MarkdownCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const rawContent = Array.isArray(children) ? children.join('') : String(children ?? '');
  const looksMultiline = /[\r\n]/.test(rawContent);
  const shouldRenderInline = inline || !looksMultiline;

  if (shouldRenderInline) {
    return (
      <code
        className={`whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-100 px-1.5 py-0.5 font-mono text-[0.9em] text-gray-900 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-100 ${className || ''}`}
        {...props}
      >
        {children}
      </code>
    );
  }

  const languageMatch = /language-(\w+)/.exec(className || '');
  const language = languageMatch ? languageMatch[1] : 'text';

  return (
    <div className="group relative my-2">
      {language !== 'text' && (
        <div className="absolute left-3 top-2 z-10 text-xs font-medium uppercase text-gray-400">{language}</div>
      )}

      <button
        type="button"
        onClick={() =>
          copyTextToClipboard(rawContent).then((success) => {
            if (success) {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          })}
        className="absolute right-2 top-2 z-10 rounded-md border border-gray-600 bg-gray-700/80 px-2 py-1 text-xs text-white opacity-0 transition-opacity hover:bg-gray-700 group-hover:opacity-100"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>

      <SyntaxHighlighter
        language={language}
        style={prismOneDark}
        customStyle={{
          margin: 0,
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          padding: language !== 'text' ? '2rem 1rem 1rem 1rem' : '1rem',
        }}
      >
        {rawContent}
      </SyntaxHighlighter>
    </div>
  );
}

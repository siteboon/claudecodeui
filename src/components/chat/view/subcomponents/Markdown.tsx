import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTranslation } from 'react-i18next';

import { usePaletteOps } from '../../../../contexts/PaletteOpsContext';
import { useTheme } from '../../../../contexts/ThemeContext';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { getArtifactLinkKind, stripArtifactLineSuffix } from '../../utils/artifactLinks';
import { normalizeInlineCodeFences } from '../../utils/chatFormatting';
import { createChatMarkdownRemarkPlugins } from './markdownPlugins';

type MarkdownProps = {
  children: React.ReactNode;
  className?: string;
};

const isExternalHref = (href?: string): boolean =>
  !!href && (/^(https?:|mailto:|tel:|data:)/i.test(href) || href.startsWith('#'));

const stripLineSuffix = (value: string): string =>
  value.replace(/:\d+(?::\d+)?$/, '');

const looksLikeFilePath = (value?: string): value is string => {
  if (!value) return false;
  const cleaned = stripLineSuffix(value.trim());
  return Boolean(cleaned && cleaned !== '#' && (/[\\/]/.test(cleaned) || /\.[a-z0-9]+$/i.test(cleaned)));
};

const childrenToText = (children: React.ReactNode): string => {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(childrenToText).join('');
  if (React.isValidElement(children)) {
    return childrenToText((children.props as { children?: React.ReactNode }).children);
  }
  return '';
};

type CodeBlockProps = {
  node?: { type?: string };
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
};

const CodeBlock = ({ node, inline, className, children, ...props }: CodeBlockProps) => {
  const { t } = useTranslation('chat');
  const { isDarkMode } = useTheme();
  const [copied, setCopied] = useState(false);
  const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
  const shouldInline = inline || node?.type === 'inlineCode' || !/[\r\n]/.test(raw);

  if (shouldInline) {
    return (
      <code
        className={`whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-100 px-1.5 py-0.5 font-mono text-[0.9em] text-gray-900 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-100 ${className || ''}`}
        {...props}
      >
        {children}
      </code>
    );
  }

  const language = /language-(\w+)/.exec(className || '')?.[1] ?? 'text';

  return (
    <div className="group relative my-2">
      {language !== 'text' && (
        <div className="absolute left-3 top-2 z-10 text-xs font-medium uppercase text-gray-400">{language}</div>
      )}
      <button
        type="button"
        onClick={() => {
          void copyTextToClipboard(raw).then((success) => {
            if (!success) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
        className="absolute right-2 top-2 z-10 rounded-md border border-border bg-card/90 px-2 py-1 text-xs text-foreground/80 opacity-0 transition-opacity hover:bg-muted focus:opacity-100 active:opacity-100 group-hover:opacity-100"
        title={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
        aria-label={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
      >
        {copied ? t('codeBlock.copied') : t('codeBlock.copy')}
      </button>
      <SyntaxHighlighter
        language={language}
        style={isDarkMode ? oneDark : oneLight}
        customStyle={{
          margin: 0,
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          padding: language !== 'text' ? '2rem 1rem 1rem 1rem' : '1rem',
          ...(isDarkMode ? {} : { background: 'hsl(var(--muted))' }),
        }}
        codeTagProps={{
          style: {
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            ...(isDarkMode ? {} : { background: 'transparent' }),
          },
        }}
      >
        {raw}
      </SyntaxHighlighter>
    </div>
  );
};

const markdownComponents = {
  code: CodeBlock,
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-2 border-l-4 border-gray-300 pl-4 italic text-gray-600 dark:border-gray-600 dark:text-gray-400">
      {children}
    </blockquote>
  ),
  p: ({ children }: { children?: React.ReactNode }) => <div className="mb-2 last:mb-0">{children}</div>,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-gray-200 px-3 py-2 text-left text-sm font-semibold dark:border-gray-700">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-gray-200 px-3 py-2 align-top text-sm dark:border-gray-700">{children}</td>
  ),
};

export function Markdown({ children, className }: MarkdownProps) {
  const content = normalizeInlineCodeFences(String(children ?? ''));
  const remarkPlugins = useMemo(createChatMarkdownRemarkPlugins, []);
  const rehypePlugins = useMemo(() => [rehypeKatex], []);
  const { openFileInEditor } = usePaletteOps();

  const components = useMemo(
    () => ({
      ...markdownComponents,
      a: ({ href, children: linkChildren }: { href?: string; children?: React.ReactNode }) => {
        const linkText = childrenToText(linkChildren);
        const fileRef = looksLikeFilePath(href) ? href : looksLikeFilePath(linkText) ? linkText : undefined;

        if (fileRef && !isExternalHref(href)) {
          const artifactKind = getArtifactLinkKind(fileRef);

          if (artifactKind) {
            const artifactPath = stripArtifactLineSuffix(fileRef);
            return (
              <button
                type="button"
                className="my-1 flex w-full max-w-md items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-left text-sm text-blue-900 hover:border-blue-300 hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100 dark:hover:border-blue-800 dark:hover:bg-blue-950/50"
                onClick={() => openFileInEditor(artifactPath, { artifactPreview: true, artifactKind })}
                title={artifactPath}
              >
                <span className="min-w-0">
                  <span className="block font-medium">{linkChildren}</span>
                  <span className="block truncate text-xs text-blue-700/80 dark:text-blue-200/70">{artifactPath}</span>
                </span>
                <span className="shrink-0 rounded-md bg-white/70 px-2 py-1 text-xs font-medium dark:bg-white/10">
                  {artifactKind === 'html' ? 'Preview HTML' : 'Preview image'}
                </span>
              </button>
            );
          }

          return (
            <a
              href={href || fileRef}
              className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400"
              onClick={(event) => {
                event.preventDefault();
                openFileInEditor(stripLineSuffix(fileRef));
              }}
            >
              {linkChildren}
            </a>
          );
        }

        return (
          <a
            href={href}
            className="text-blue-600 hover:underline dark:text-blue-400"
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkChildren}
          </a>
        );
      },
    }),
    [openFileInEditor],
  );

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components as any}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

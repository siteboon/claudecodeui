import React, { memo, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTranslation } from 'react-i18next';

import { MermaidDiagram } from '@/modules/code-editor';
import { normalizeInlineCodeFences } from '@/modules/chat/utils/chatFormatting';
import { copyTextToClipboard } from '@/shared/utils';
import { SyntaxHighlighter } from '@/shared/syntaxHighlighter';
import { usePaletteOps } from '@/modules/command-palette';
import { buildSyntaxTheme } from '@/modules/chat/utils/syntaxHighlightTheme';
import type { PrismStyleSheet } from '@/modules/chat/utils/syntaxHighlightTheme';

type MarkdownProps = {
  children: React.ReactNode;
  className?: string;
  /** Render single newlines as hard line breaks (for user-typed messages). */
  breaks?: boolean;
};

// Links to the wider web (or in-page anchors) keep normal browser navigation;
// everything else is treated as a workspace file reference.
const isExternalHref = (href?: string): boolean =>
  !!href && (/^(https?:|mailto:|tel:|data:)/i.test(href) || href.startsWith('#'));

// Strip a trailing `:line` / `:line:col` suffix (e.g. `src/foo.ts:130`).
const stripLineSuffix = (value: string): string => value.replace(/:\d+(?::\d+)?$/, '');

// A usable file path contains a separator or a filename with an extension.
const looksLikeFilePath = (value?: string): value is string => {
  if (!value) {
    return false;
  }
  const cleaned = stripLineSuffix(value.trim());
  if (!cleaned || cleaned === '#') {
    return false;
  }
  return /[\\/]/.test(cleaned) || /\.[a-z0-9]+$/i.test(cleaned);
};

// Extract plain text from link children so a reference rendered only as link
// text (e.g. `[src/foo.ts]()` with an empty href) can still be opened.
const childrenToText = (children: React.ReactNode): string => {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(childrenToText).join('');
  }
  if (React.isValidElement(children)) {
    return childrenToText((children.props as { children?: React.ReactNode }).children);
  }
  return '';
};

// The delimiters `remark-math` recognizes with `singleDollarTextMath` off.
const MATH_DELIMITER = /\$\$|\\\(|\\\[/;

const EMPTY_PLUGINS: never[] = [];

type CodeBlockProps = {
  node?: any;
  className?: string;
  children?: React.ReactNode;
  /** Set by the custom `pre` renderer: this code element is a fenced/indented block. */
  forceBlock?: boolean;
};

// `node` is destructured out so react-markdown's hast node never reaches the DOM.
const CodeBlock = ({ node: _node, className, children, forceBlock, ...props }: CodeBlockProps) => {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  // Fenced blocks carry a trailing newline in the tree; trim it so the
  // highlighter doesn't render an empty final line.
  const raw = (Array.isArray(children) ? children.join('') : String(children ?? '')).replace(/\n$/, '');
  // react-markdown v9+ dropped the `inline` prop: block code is whatever the
  // `pre` renderer hands us (forceBlock). Multiline is kept as a safety net.
  const shouldInline = !forceBlock && !/[\r\n]/.test(raw);

  if (shouldInline) {
    return (
      <code
        className={`whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[0.875em] text-foreground ${className || ''
          }`}
        {...props}
      >
        {children}
      </code>
    );
  }

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';
  const languageLabel = language.charAt(0).toUpperCase() + language.slice(1);

  if (language === 'mermaid') {
    return <MermaidDiagram code={raw} />;
  }

  return (
    <div className="group my-3 overflow-hidden rounded-xl border border-border bg-muted/50 shadow-sm dark:bg-zinc-900">
      {/* Label row shares the block's background — no divider, ChatGPT-style */}
      <div className="flex items-center justify-between px-4 pt-2">
        <span className="select-none text-xs text-muted-foreground">{languageLabel}</span>
        <button
          type="button"
          onClick={() =>
            copyTextToClipboard(raw).then((success) => {
              if (success) {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            })
          }
          className={`rounded-md p-1 transition-opacity focus-visible:opacity-100 ${copied
            ? 'text-green-600 opacity-100 dark:text-green-500'
            : 'text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100'
            }`}
          title={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
          aria-label={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
        >
          {copied ? (
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
            </svg>
          )}
        </button>
      </div>

      <SyntaxHighlighter
        language={language}
        style={syntaxTheme.style}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: '0.8125rem',
          lineHeight: 1.6,
          padding: '0.5rem 1rem 1rem',
          // The container owns the background so the label row and code read as one panel.
          background: 'transparent',
        }}
        codeTagProps={{
          style: {
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            background: 'transparent',
          },
        }}
      >
        {raw}
      </SyntaxHighlighter>
    </div>
  );
};

/**
 * One style object for both themes: switching between the two Prism objects
 * re-tokenized every mounted code block, so the theme-dependent values are CSS
 * variables and the toggle is a style recalculation instead.
 */
const syntaxTheme = buildSyntaxTheme(oneLight as PrismStyleSheet, oneDark as PrismStyleSheet);

// The `:root`/`.dark` declarations backing syntaxTheme.style. Injected once
// because the values are derived from the Prism theme objects at runtime and so
// cannot live in index.css. ThemeContext toggles `.dark` on <html>, which is
// what repaints the tokens.
const SYNTAX_THEME_STYLE_ELEMENT_ID = 'cc-syntax-theme';
if (!document.getElementById(SYNTAX_THEME_STYLE_ELEMENT_ID)) {
  const styleElement = document.createElement('style');
  styleElement.id = SYNTAX_THEME_STYLE_ELEMENT_ID;
  styleElement.textContent = syntaxTheme.css;
  document.head.appendChild(styleElement);
}

const markdownComponents = {
  code: CodeBlock,
  // Fenced/indented code arrives as <pre><code>. Re-render the child CodeBlock
  // with `forceBlock` so it always gets the block treatment (react-markdown v9+
  // no longer passes an `inline` flag), and skip the outer <pre> so Tailwind
  // Typography doesn't wrap the highlighter in a second dark shell.
  pre: ({ children }: { children?: React.ReactNode }) => {
    const child = Array.isArray(children) ? children.find(React.isValidElement) : children;
    if (React.isValidElement(child) && child.type === CodeBlock) {
      return <CodeBlock {...(child.props as CodeBlockProps)} forceBlock />;
    }
    return <>{children}</>;
  },
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-3 border-l-2 border-primary/50 pl-4 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-t border-border" />,
  p: ({ children }: { children?: React.ReactNode }) => <div className="mb-2 last:mb-0">{children}</div>,
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-2 list-outside list-disc space-y-1 pl-5 marker:text-current last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-2 list-outside list-decimal space-y-1 pl-5 marker:text-current last:mb-0">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="[&>div:last-child]:mb-0 [&>div]:mb-1">{children}</li>,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      {/* my-0 cancels Tailwind Typography's table margin, which would show as blank bands inside the border */}
      <table className="my-0 min-w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-muted/60">{children}</thead>,
  tr: ({ children }: { children?: React.ReactNode }) => (
    <tr className="[&:last-child>td]:border-b-0">{children}</tr>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border-b border-border px-3 py-2 text-left font-semibold text-foreground">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border-b border-border/60 px-3 py-2 align-top">{children}</td>
  ),
};

/**
 * Used by chat's MessageComponent, ToolErrorDisplay and MarkdownContent to
 * render model-authored markdown with this module's shared prose styling,
 * code highlighting and table rules.
 */
function MarkdownBodyRenderer({ children, breaks = false }: Omit<MarkdownProps, 'className'>) {
  const content = useMemo(
    () => normalizeInlineCodeFences(String(children ?? '')),
    [children],
  );
  // Math support costs a remark tree pass plus a full KaTeX walk on every
  // render, and almost no assistant message contains math. Only wire the two
  // plugins up when the text has a delimiter they could act on.
  const hasMath = useMemo(() => MATH_DELIMITER.test(content), [content]);
  const remarkPlugins = useMemo(
    () => {
      const plugins: unknown[] = [remarkGfm];
      if (hasMath) {
        plugins.push([remarkMath, { singleDollarTextMath: false }]);
      }
      if (breaks) {
        plugins.push(remarkBreaks);
      }
      return plugins as any;
    },
    [breaks, hasMath],
  );
  const rehypePlugins = useMemo(() => (hasMath ? [rehypeKatex] : EMPTY_PLUGINS), [hasMath]);
  const { openFileInEditor } = usePaletteOps();

  const components = useMemo(
    () => ({
      ...markdownComponents,
      a: ({ href, children: linkChildren }: { href?: string; children?: React.ReactNode }) => {
        // Prefer the href when it is a real path; otherwise fall back to the
        // link text, since models often emit `[src/foo.ts]()` with an empty href.
        const linkText = childrenToText(linkChildren);
        const fileRef = looksLikeFilePath(href) ? href : looksLikeFilePath(linkText) ? linkText : undefined;

        if (fileRef && !isExternalHref(href)) {
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
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components as any}>
      {content}
    </ReactMarkdown>
  );
}

/**
 * Markdown blocks without the prose wrapper. Used by StreamingMarkdown so a
 * streamed reply's settled and pending halves render as siblings inside ONE
 * prose container — Tailwind Typography's `> :first-child`/`> :last-child`
 * margin rules are per-container, so two containers would zero the gap at the
 * seam and make it pop back when the boundary moves.
 *
 * Memoized so a re-render does not re-run remark, rehype, KaTeX and Prism over
 * text that has not changed.
 */
export const MarkdownBody = memo(MarkdownBodyRenderer);

/** Markdown in its own prose container. The form every non-streaming caller uses. */
export const Markdown = memo(function Markdown({ children, className, breaks }: MarkdownProps) {
  return (
    <div className={className}>
      <MarkdownBody breaks={breaks}>{children}</MarkdownBody>
    </div>
  );
});

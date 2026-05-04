import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Play } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

const SHELL_LANGUAGES = new Set(['bash', 'sh', 'zsh', 'powershell', 'cmd', 'shell', 'console']);

interface StreamingCodeBlockProps {
  source: string;
  language: string;
  onRunInShell?: (code: string) => void;
}

const MONO_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/**
 * A code block that re-highlights on a debounce (100 ms) during streaming,
 * showing the un-highlighted delta as monospace text in between cycles.
 */
function StreamingCodeBlockInner({ source, language, onRunInShell }: StreamingCodeBlockProps) {
  const [highlighted, setHighlighted] = useState(source);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }, [source]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setHighlighted(source);
    }, 100);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [source]);

  // Show the full latest content via SyntaxHighlighter using the debounced value.
  // The delta (source minus highlighted) is rendered as plain monospace after the
  // highlighted block — but for simplicity we just update the whole block with
  // a slight delay. This avoids complex DOM merging.

  return (
    <div className="group relative my-2">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
        {language && language !== 'text' && (
          <span className="text-xs font-medium uppercase text-gray-400">
            {language}
          </span>
        )}
        {SHELL_LANGUAGES.has(language) && (
          <button
            type="button"
            onClick={() => onRunInShell?.(source)}
            className="rounded p-1 text-gray-400 opacity-0 transition-all hover:bg-white/10 hover:text-gray-200 group-hover:opacity-100"
            title="Run in Shell"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="rounded p-1 text-gray-400 opacity-0 transition-all hover:bg-white/10 hover:text-gray-200 group-hover:opacity-100"
          title="Copy code"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          padding: '2rem 1rem 1rem 1rem',
        }}
        codeTagProps={{
          style: { fontFamily: MONO_FAMILY },
        }}
      >
        {highlighted}
      </SyntaxHighlighter>
      {/* Render any un-highlighted trailing content as plain mono text */}
      {source.length > highlighted.length && (
        <div
          style={{
            fontFamily: MONO_FAMILY,
            fontSize: '0.875rem',
            padding: '0 1rem 1rem',
            marginTop: '-0.5rem',
            whiteSpace: 'pre-wrap',
            color: '#abb2bf', // match oneDark default text
            backgroundColor: '#282c34', // match oneDark bg
            borderBottomLeftRadius: '0.5rem',
            borderBottomRightRadius: '0.5rem',
          }}
        >
          {source.slice(highlighted.length)}
        </div>
      )}
    </div>
  );
}

export default React.memo(StreamingCodeBlockInner, (prev, next) => {
  return prev.source === next.source && prev.language === next.language && prev.onRunInShell === next.onRunInShell;
});

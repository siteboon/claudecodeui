import React, { useEffect, useRef, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface StreamingCodeBlockProps {
  source: string;
  language: string;
}

const MONO_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/**
 * A code block that re-highlights on a debounce (100 ms) during streaming,
 * showing the un-highlighted delta as monospace text in between cycles.
 */
function StreamingCodeBlockInner({ source, language }: StreamingCodeBlockProps) {
  const [highlighted, setHighlighted] = useState(source);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      {language && language !== 'text' && (
        <div className="absolute left-3 top-2 z-10 text-xs font-medium uppercase text-gray-400">
          {language}
        </div>
      )}
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
  // Only re-render when content actually changes
  return prev.source === next.source && prev.language === next.language;
});

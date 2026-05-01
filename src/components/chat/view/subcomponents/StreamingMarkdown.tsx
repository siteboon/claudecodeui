import React, { useMemo } from 'react';
import { Markdown } from './Markdown';
import StreamingCodeBlock from './StreamingCodeBlock';

interface StreamingMarkdownProps {
  content: string;
  isStreaming: boolean;
  className?: string;
}

/**
 * Split streaming content into:
 * - `complete`: all content before the last unclosed code fence (stable, memoizable)
 * - `streaming`: the content inside the unclosed code fence (live, re-renders often)
 */
function splitStreamingContent(content: string) {
  // Count triple-backtick fences
  const fenceRegex = /```/g;
  const fences: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(content)) !== null) {
    fences.push(m.index);
  }

  // Even number of fences = all code blocks are closed
  if (fences.length % 2 === 0) {
    return { complete: content, streaming: '', language: null, isInCodeBlock: false };
  }

  // Odd = last fence is unclosed (we're inside a streaming code block)
  const lastFenceIdx = fences[fences.length - 1];
  const complete = content.slice(0, lastFenceIdx);

  // Extract the opening fence line: ```language\n
  const afterFence = content.slice(lastFenceIdx + 3);
  const newlineIdx = afterFence.indexOf('\n');
  let language: string | null = null;
  let codeContent: string;

  if (newlineIdx === -1) {
    // Still on the fence line itself (e.g. "```python" with no newline yet)
    language = afterFence.trim() || null;
    codeContent = '';
  } else {
    language = afterFence.slice(0, newlineIdx).trim() || null;
    codeContent = afterFence.slice(newlineIdx + 1);
  }

  return {
    complete,
    streaming: codeContent,
    language,
    isInCodeBlock: true,
  };
}

/**
 * A markdown renderer optimised for streaming:
 *
 * - When `isStreaming=false`, delegates entirely to the standard `<Markdown>` component
 *   (identical rendering to the current behaviour).
 * - When `isStreaming=true`, splits content at the last unclosed code fence.
 *   The "complete" portion is memoised; the "streaming" code block uses a debounced
 *   syntax-highlighter that avoids per-token re-highlighting.
 *   A blinking caret is shown at the end of the streaming content.
 */
export default function StreamingMarkdown({
  content,
  isStreaming,
  className,
}: StreamingMarkdownProps) {
  // Non-streaming: full parse
  if (!isStreaming) {
    return (
      <Markdown className={className}>
        {content}
      </Markdown>
    );
  }

  const { complete, streaming, language, isInCodeBlock } = splitStreamingContent(content);

  // If not inside an open code block, just render everything with the normal
  // markdown parser + append a caret.
  if (!isInCodeBlock) {
    return (
      <div className={className}>
        <Markdown className="">
          {content}
        </Markdown>
        <StreamingCaret />
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Completed portion — stable, should not re-render on each token */}
      {complete && (
        <MemoizedMarkdown content={complete} />
      )}

      {/* Live streaming code block */}
      {streaming ? (
        <div className="relative">
          <StreamingCodeBlock
            source={streaming}
            language={language || 'text'}
          />
          <StreamingCaret />
        </div>
      ) : (
        // Still on the opening fence line (e.g. "```python")
        <div className="my-2 rounded-lg bg-[#282c34] p-4 text-sm text-gray-400">
          <span className="uppercase">{language || '...'}</span>
          <StreamingCaret />
        </div>
      )}
    </div>
  );
}

/**
 * Memoised wrapper so the "complete" portion doesn't re-render on every token.
 */
const MemoizedMarkdown = React.memo(
  function MemoizedMarkdown({ content }: { content: string }) {
    return (
      <Markdown className="">
        {content}
      </Markdown>
    );
  },
  (prev, next) => prev.content === next.content,
);

/**
 * Blinking caret indicator shown during streaming.
 */
function StreamingCaret() {
  return (
    <span
      className="streaming-caret"
      aria-hidden="true"
    />
  );
}

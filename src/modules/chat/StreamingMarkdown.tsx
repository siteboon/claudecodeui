import { useMemo } from 'react';

import { Markdown } from '@/modules/chat/Markdown';
import { splitStreamingMarkdown } from '@/modules/chat/utils/streamingMarkdown';

type StreamingMarkdownProps = {
  content: string;
  className?: string;
};

/**
 * Used by chat's MessageComponent for the reply currently being streamed.
 *
 * The realtime handler republishes the whole accumulated reply every 100ms, so
 * a single <Markdown> would re-parse the entire message ten times a second.
 * Splitting at a block boundary keeps the settled half's props stable, so
 * memo(Markdown) skips it and only the block still being written is re-parsed.
 * Markdown blocks are independent across the boundaries splitStreamingMarkdown
 * chooses, so the rendered output matches the unsplit document.
 */
export default function StreamingMarkdown({ content, className }: StreamingMarkdownProps) {
  const { settled, pending } = useMemo(() => splitStreamingMarkdown(content), [content]);

  return (
    <>
      {settled && <Markdown className={className}>{settled}</Markdown>}
      {pending && <Markdown className={className}>{pending}</Markdown>}
    </>
  );
}

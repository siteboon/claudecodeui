import { useMemo } from 'react';

import { MarkdownBody } from '@/modules/chat/transcript/Markdown';
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
 * memo(MarkdownBody) skips it and only the block still being written is
 * re-parsed. Markdown blocks are independent across the boundaries
 * splitStreamingMarkdown chooses, so the rendered output matches the unsplit
 * document — including block spacing, because both halves are siblings inside
 * the single prose container below.
 *
 * A block does change parent when it crosses from pending to settled, so its
 * DOM is recreated once. That drops transient in-block UI state (a code block's
 * "Copied" tick, a text selection) at that moment; it only affects the block
 * being written, and only while streaming.
 */
export default function StreamingMarkdown({ content, className }: StreamingMarkdownProps) {
  const { settled, pending } = useMemo(() => splitStreamingMarkdown(content), [content]);

  return (
    <div className={className}>
      {settled && <MarkdownBody>{settled}</MarkdownBody>}
      {pending && <MarkdownBody>{pending}</MarkdownBody>}
    </div>
  );
}

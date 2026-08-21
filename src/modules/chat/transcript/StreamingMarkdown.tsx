import { useMemo } from 'react';

import { MarkdownBody } from '@/modules/chat/transcript/Markdown';
import { splitStreamingMarkdown } from '@/modules/chat/utils/streamingMarkdown';

type StreamingMarkdownProps = {
  content: string;
  /** False once the reply is complete, which stops the splitting. */
  isStreaming: boolean;
  className?: string;
};

/**
 * Used by chat's MessageComponent for an assistant reply, streaming or not.
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
 * It renders the finished reply too, with isStreaming false and no split at all
 * — there is nothing left to grow, so a second parse buys nothing. The reason it
 * handles that case rather than deferring to <Markdown> is that MessageComponent
 * used to switch between the two at that position, and React treats a different
 * element type in the same position as a different component: every completed
 * reply threw away its DOM and rebuilt it, losing any selection the user had
 * started making inside it. One component there means the nodes are reconciled.
 * messageStreamEnd.test.tsx pins that.
 *
 * A block changes parent when it crosses from pending to settled, so its DOM is
 * recreated at that moment, dropping transient in-block state (a code block's
 * "Copied" tick, a text selection).
 *
 * That crossing is not one-way. The boundary is recomputed from scratch on each
 * tick, so an already-settled block returns to pending whenever the text that
 * follows it makes the old boundary unsafe to split at — a soft-wrapped line, or
 * a list, table or blockquote starting after it. Retracting is what keeps the
 * two halves rendering identically to the unsplit document, so it is correct,
 * not a bug; measured on realistic replies at streaming speed it happens for
 * about a third of them, once. Only blocks in a message still being streamed are
 * affected.
 */
export default function StreamingMarkdown({
  content,
  isStreaming,
  className,
}: StreamingMarkdownProps) {
  const { settled, pending } = useMemo(
    () => (isStreaming ? splitStreamingMarkdown(content) : { settled: content, pending: '' }),
    [content, isStreaming],
  );

  return (
    <div className={className}>
      {settled && <MarkdownBody>{settled}</MarkdownBody>}
      {pending && <MarkdownBody>{pending}</MarkdownBody>}
    </div>
  );
}

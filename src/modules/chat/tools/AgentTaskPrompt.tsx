import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';

type AgentTaskPromptProps = {
  /** The brief the agent was spawned with, as written. */
  prompt: string;
};

/**
 * Used by SubagentPanel and WorkflowPanel to show the brief an agent was
 * spawned with, so an `Agent` call and a workflow agent read the same way.
 *
 * The brief is clamped to its first lines so a long one does not push the
 * agent's steps off screen, with a toggle to read the rest in place. The
 * toggle is offered only when the clamp actually hides something, which only
 * layout can tell: a short brief can still wrap past the clamp in a narrow
 * pane. An export renders the brief whole, since nothing in the file can
 * expand it.
 */
export const AgentTaskPrompt = memo(({ prompt }: AgentTaskPromptProps) => {
  const { t } = useTranslation();
  const isExporting = useIsExportingTranscript();
  const textRef = useRef<HTMLDivElement>(null);
  // Set by the toggle so the whole brief can be read without leaving the card.
  const [isExpanded, setIsExpanded] = useState(false);
  // Whether the clamp hides part of the brief, as last measured; the toggle
  // only exists when it does.
  const [isClamped, setIsClamped] = useState(false);
  const showWhole = isExpanded || isExporting;

  useEffect(() => {
    const element = textRef.current;
    // Measured only while clamped: expanded, nothing overflows, and the
    // toggle has to stay to fold the brief back.
    if (!element || showWhole) {
      return undefined;
    }

    const measure = () => setIsClamped(element.scrollHeight > element.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    // The pane can be resized after the card opens, which changes the wrap.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [prompt, showWhole]);

  return (
    <div className="rounded border border-border/40 bg-muted/40 p-2 text-xs text-muted-foreground">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">{t('workflow.agentTask', 'Task')}</div>
      <div ref={textRef} className={cn('whitespace-pre-wrap break-words', !showWhole && 'line-clamp-6')}>{prompt}</div>
      {isClamped && !isExporting && (
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((previous) => !previous)}
          className="mt-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {isExpanded ? t('workflow.agentTaskShowLess', 'Show less') : t('workflow.agentTaskShowMore', 'Show more')}
        </button>
      )}
    </div>
  );
});
AgentTaskPrompt.displayName = 'AgentTaskPrompt';

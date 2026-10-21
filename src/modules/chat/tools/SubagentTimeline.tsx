import { memo, useState } from 'react';
import { Brain, MessageSquareText } from 'lucide-react';

import type { DiffLine, Project, SubagentActivity } from '@/shared/types';
import { cn } from '@/shared/utils';
import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import TranscriptTimestamp from '@/modules/chat/transcript/TranscriptTimestamp';

type SubagentTimelineProps = {
  activity: SubagentActivity[];
  /** Total entries the agent recorded, which exceeds `activity` when a long run was truncated for transport. */
  activityCount?: number;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  selectedProject?: Project | null;
  /** Puts each step's time beside it, for a step the provider recorded one for. */
  showTimestamps?: boolean;
};

/**
 * How many timeline entries are drawn before the "show more" step. A single
 * entry can expand into a diff viewer, so an agent with a long run would
 * otherwise mount hundreds of tool renderers the moment it is opened.
 */
const INITIALLY_RENDERED_ACTIVITIES = 25;

/** One prose or reasoning entry from the agent's own narration. */
const SubagentNote = memo(({ activity }: { activity: SubagentActivity }) => {
  const isThinking = activity.kind === 'thinking';
  const Icon = isThinking ? Brain : MessageSquareText;

  return (
    <div className="flex gap-2 py-1">
      <Icon className={cn('mt-0.5 h-3 w-3 flex-shrink-0', isThinking ? 'text-muted-foreground/50' : 'text-muted-foreground/70')} />
      <div
        className={cn(
          'min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-relaxed',
          isThinking ? 'italic text-muted-foreground/70' : 'text-muted-foreground',
        )}
      >
        {activity.content}
      </div>
    </div>
  );
});
SubagentNote.displayName = 'SubagentNote';

/**
 * Rendered by SubagentPanel and WorkflowPanel for an agent's recorded
 * timeline — tool calls through the same router the main thread uses, prose
 * and reasoning as notes — with a "show more" step for long runs and a note
 * for the entries the backend left out of a truncated one.
 *
 * Only mount it while its panel is open: a run of a hundred tools is a
 * hundred tool renderers.
 */
export const SubagentTimeline = memo(({ activity, activityCount, onFileOpen, createDiff, selectedProject, showTimestamps = false }: SubagentTimelineProps) => {
  const isExporting = useIsExportingTranscript();
  // Raised by the "show more" step so a long run can be inspected in full
  // without paying for it up front.
  const [renderLimit, setRenderLimit] = useState(INITIALLY_RENDERED_ACTIVITIES);
  const effectiveRenderLimit = isExporting ? Number.POSITIVE_INFINITY : renderLimit;

  // The backend truncates very long timelines for transport; say so rather
  // than implying the agent stopped where the list does.
  const untransmittedCount = Math.max(0, (activityCount ?? activity.length) - activity.length);
  const visibleEntries = activity.slice(0, effectiveRenderLimit);
  const hiddenCount = activity.length - visibleEntries.length;

  return (
    <>
      {visibleEntries.length > 0 && (
        <div className="border-l border-border/60 pl-2">
          {visibleEntries.map((entry, index) => {
            const key = entry.kind === 'tool' ? entry.toolId ?? `activity-${index}` : `activity-${index}`;
            const step = entry.kind === 'tool' ? (
              // Rendered through the same router the main thread uses, so a
              // subagent's shell command or diff looks exactly like one the
              // top-level agent ran.
              <ToolRenderer
                key={key}
                toolName={entry.toolName || 'UnknownTool'}
                toolInput={entry.toolInput}
                toolResult={entry.toolResult}
                toolId={entry.toolId}
                mode="input"
                onFileOpen={onFileOpen}
                createDiff={createDiff}
                selectedProject={selectedProject}
              />
            ) : (
              <SubagentNote key={key} activity={entry} />
            );

            // The time sits in a column of its own beside the step rather than
            // inside it, since a step is any of the tool renderers; at phone
            // widths it takes a line under the step instead, as a nested step
            // has no width to spare. Only wrapped while shown, so with the
            // preference off the timeline's markup is exactly what it was
            // (flipping it therefore remounts the steps of an open timeline).
            return showTimestamps ? (
              <div key={key} className="flex flex-col sm:flex-row sm:items-start sm:gap-2">
                <div className="min-w-0 sm:flex-1">{step}</div>
                <TranscriptTimestamp
                  value={entry.timestamp}
                  className="mb-1 flex-shrink-0 text-[10px] leading-none text-muted-foreground/60 sm:mb-0 sm:mt-1.5"
                />
              </div>
            ) : step;
          })}
        </div>
      )}

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setRenderLimit((previous) => previous + INITIALLY_RENDERED_ACTIVITIES * 4)}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Show {hiddenCount} more {hiddenCount === 1 ? 'step' : 'steps'}
        </button>
      )}

      {untransmittedCount > 0 && hiddenCount === 0 && (
        <div className="text-[11px] text-muted-foreground/60">
          {untransmittedCount} earlier {untransmittedCount === 1 ? 'step is' : 'steps are'} not included
        </div>
      )}
    </>
  );
});
SubagentTimeline.displayName = 'SubagentTimeline';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Terminal } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import type { ChatMessage } from '../../types/types';
import { BashCommandDisplay } from './BashCommandDisplay';
import { ToolStatusBadge } from './ToolStatusBadge';
import type { ToolStatus } from './ToolStatusBadge';

interface CommandRunGroupProps {
  messages: ChatMessage[];
}

type ExtractedCommand = {
  key: string;
  command: string;
  description?: string;
  output: string;
  isError: boolean;
  status: ToolStatus;
};

function extractCommand(message: ChatMessage, index: number): ExtractedCommand {
  let command = '';
  let description: string | undefined;
  try {
    const parsed =
      typeof message.toolInput === 'string' ? JSON.parse(message.toolInput) : message.toolInput;
    command = parsed?.command || '';
    description = parsed?.description;
  } catch {
    command = typeof message.toolInput === 'string' ? message.toolInput : '';
  }

  const result = message.toolResult;
  const rawContent = result?.content;
  const output =
    typeof rawContent === 'string' ? rawContent : rawContent != null ? String(rawContent) : '';
  const isError = Boolean(result?.isError);
  const status: ToolStatus = !result ? 'running' : isError ? 'error' : 'completed';

  return {
    key: message.toolId || `${command}-${index}`,
    command,
    description,
    output,
    isError,
    status,
  };
}

/**
 * Groups a run of consecutive shell commands under a single collapsible header
 * (Codex-in-VSCode style). Collapsed by default so long command runs stay tidy;
 * expanding reveals every command in the run, each independently expandable for
 * its own output.
 */
export const CommandRunGroup: React.FC<CommandRunGroupProps> = ({ messages }) => {
  const commands = messages.map(extractCommand);
  const count = commands.length;
  const anyRunning = commands.some((c) => c.status === 'running');
  const anyError = commands.some((c) => c.isError);

  const [open, setOpen] = useState(false);

  // Surface failed runs without a click: open once when an error first appears.
  const autoAppliedRef = useRef(false);
  useEffect(() => {
    if (!autoAppliedRef.current && anyError) {
      autoAppliedRef.current = true;
      setOpen(true);
    }
  }, [anyError]);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-muted/30 transition-all duration-200',
        anyError ? 'border-red-500/30' : 'border-border/60',
        open && 'shadow-sm',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring"
      >
        <ChevronRight
          className={cn(
            'h-4 w-4 flex-shrink-0 text-muted-foreground/70 transition-transform duration-200',
            open && 'rotate-90',
          )}
        />
        <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Terminal className="h-3.5 w-3.5" />
        </span>
        <span className="flex-1 text-xs font-medium text-foreground">
          {anyRunning ? 'Running' : 'Ran'} <span className="text-muted-foreground">{count} commands</span>
        </span>
        {anyRunning && (
          <span className="h-2.5 w-2.5 flex-shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-emerald-400" />
        )}
        {anyError && <ToolStatusBadge status="error" className="flex-shrink-0" />}
      </button>

      {open && (
        <div className="settings-content-enter space-y-1 border-t border-border/50 p-2">
          {commands.map((cmd) => (
            <BashCommandDisplay
              key={cmd.key}
              command={cmd.command}
              description={cmd.description}
              output={cmd.output}
              isError={cmd.isError}
              status={cmd.status !== 'completed' ? cmd.status : undefined}
              defaultOpen={false}
            />
          ))}
        </div>
      )}
    </div>
  );
};

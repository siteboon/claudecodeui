import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type { ChatMessage, ToolResult } from '../../types/types';

type ClaudeStatusProps = {
  status: {
    text?: string;
    tokens?: number;
    can_interrupt?: boolean;
  } | null;
  onAbort?: () => void;
  isLoading: boolean;
  provider?: string;
  messages?: ChatMessage[];
};

const ACTION_KEYS = [
  'claudeStatus.actions.thinking',
  'claudeStatus.actions.processing',
  'claudeStatus.actions.analyzing',
  'claudeStatus.actions.working',
  'claudeStatus.actions.computing',
  'claudeStatus.actions.reasoning',
];
const DEFAULT_ACTION_WORDS = ['Thinking', 'Processing', 'Analyzing', 'Working', 'Computing', 'Reasoning'];

const PROVIDER_LABEL_KEYS: Record<string, string> = {
  claude: 'messageTypes.claude',
  codex: 'messageTypes.codex',
  cursor: 'messageTypes.cursor',
  gemini: 'messageTypes.gemini',
  opencode: 'messageTypes.opencode',
};

function formatElapsedTime(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return mins < 1 ? `${secs}s` : `${mins}m ${secs}s`;
}

/* ------------------------------------------------------------------ */
/*  Live activity feed (terminal / CLI style)                          */
/* ------------------------------------------------------------------ */

type ActivityKind = 'tool' | 'result' | 'thinking' | 'assistant';
interface ActivityLine {
  kind: ActivityKind;
  text: string;
}

function stripMd(value: unknown): string {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/^#+\s*/gm, '')
    .trim();
}

function firstLine(value: string): string {
  return value.split('\n').find((line) => line.trim()) || '';
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function summarizeToolInput(input: unknown): string {
  if (typeof input === 'string') {
    const line = firstLine(input.trim());
    return line ? `(${truncate(line, 90)})` : '';
  }
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  const candidate =
    obj.command ?? obj.file_path ?? obj.path ?? obj.pattern ?? obj.query ?? obj.url ?? obj.prompt ?? obj.description ?? obj.todos;
  if (typeof candidate === 'string' && candidate.trim()) {
    return `(${truncate(firstLine(candidate), 90)})`;
  }
  return '';
}

function previewToolResult(result: ToolResult | null | undefined): string {
  if (!result) return '';
  const content = (result as ToolResult).content;
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content.map((part) => (typeof part === 'string' ? part : (part as { text?: string })?.text || '')).join('\n');
  } else if (content && typeof content === 'object') {
    text = (content as { text?: string }).text || '';
  }
  const line = firstLine(stripMd(text));
  return line ? truncate(line, 110) : '';
}

// Build a compact CLI-style log of what the agent has done since the last user prompt.
function buildActivityLines(messages: ChatMessage[]): ActivityLine[] {
  if (!messages?.length) return [];

  let start = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.type === 'user') {
      start = i + 1;
      break;
    }
  }
  const turn = messages.slice(start);
  const lines: ActivityLine[] = [];

  for (const message of turn) {
    if (message.isThinking || message.type === 'thinking') {
      const text = stripMd(message.reasoning || message.displayText || message.content);
      if (text) lines.push({ kind: 'thinking', text: truncate(firstLine(text), 140) });
      continue;
    }

    if (message.isToolUse) {
      const name = message.toolName || 'Tool';
      lines.push({ kind: 'tool', text: `${name}${summarizeToolInput(message.toolInput)}` });
      const preview = previewToolResult(message.toolResult);
      if (preview) lines.push({ kind: 'result', text: preview });
      continue;
    }

    if (message.type === 'tool_result' || message.toolResult) {
      const preview = previewToolResult(message.toolResult);
      if (preview) lines.push({ kind: 'result', text: preview });
      continue;
    }

    if (message.type === 'assistant') {
      const text = stripMd(message.displayText || message.content);
      if (text) lines.push({ kind: 'assistant', text: truncate(text, 200) });
    }
  }

  // Cap to the most recent activity so the panel stays readable.
  return lines.slice(-40);
}

function ActivityRow({ line }: { line: ActivityLine }) {
  switch (line.kind) {
    case 'tool':
      return (
        <div className="flex items-start gap-1.5">
          <span className="select-none text-emerald-400">⏺</span>
          <span className="break-words text-slate-200">{line.text}</span>
        </div>
      );
    case 'result':
      return (
        <div className="flex items-start gap-1.5 pl-2">
          <span className="select-none text-slate-600">⎿</span>
          <span className="break-words text-slate-500">{line.text}</span>
        </div>
      );
    case 'thinking':
      return (
        <div className="flex items-start gap-1.5">
          <span className="select-none text-purple-400/80">✻</span>
          <span className="break-words italic text-slate-400">{line.text}</span>
        </div>
      );
    case 'assistant':
    default:
      return (
        <div className="flex items-start gap-1.5">
          <span className="select-none text-sky-400/80">⏺</span>
          <span className="break-words text-slate-300">{line.text}</span>
        </div>
      );
  }
}

export default function ClaudeStatus({
  status,
  onAbort,
  isLoading,
  provider = 'claude',
  messages = [],
}: ClaudeStatusProps) {
  const { t } = useTranslation('chat');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [dots, setDots] = useState('');
  const [expanded, setExpanded] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoading) {
      setElapsedTime(0);
      return;
    }
    const startTime = Date.now();
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    const dotTimer = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 500);

    return () => {
      clearInterval(timer);
      clearInterval(dotTimer);
    };
  }, [isLoading]);

  const activityLines = useMemo(
    () => (expanded ? buildActivityLines(messages) : []),
    [expanded, messages],
  );

  // Keep the terminal pinned to the latest activity as new lines stream in.
  useEffect(() => {
    if (expanded && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [expanded, activityLines.length]);

  if (!isLoading && !status) return null;

  const actionWords = ACTION_KEYS.map((key, i) => t(key, { defaultValue: DEFAULT_ACTION_WORDS[i] }));
  const statusText = (status?.text || actionWords[Math.floor(elapsedTime / 3) % actionWords.length]).replace(/[.]+$/, '');

  const providerLabel = t(PROVIDER_LABEL_KEYS[provider] || 'claudeStatus.providers.assistant', { defaultValue: 'Assistant' });

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 mb-3 w-full duration-500">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 overflow-hidden rounded-full border border-border/50 bg-slate-100 px-3 py-1.5 shadow-sm backdrop-blur-md dark:bg-slate-900">

        {/* Left Side: Identity & Status */}
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 ring-1 ring-primary/10">
            <SessionProviderLogo provider={provider} className="h-3.5 w-3.5" />
            {isLoading && (
              <span className="absolute inset-0 animate-pulse rounded-full ring-2 ring-emerald-500/20" />
            )}
          </div>

          <div className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
              {providerLabel}
            </span>
            <div className="flex items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5 rounded-full", isLoading ? "bg-emerald-500 animate-pulse" : "bg-amber-500")} />
              <p className="truncate text-xs font-medium text-foreground">
                {statusText}<span className="inline-block w-4 text-primary">{isLoading ? dots : ''}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Right Side: Metrics & Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            title={t(expanded ? 'claudeStatus.activity.hide' : 'claudeStatus.activity.show', {
              defaultValue: expanded ? 'Hide activity' : 'Show what the agent is doing',
            })}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', expanded && 'rotate-180')} />
          </button>

          {isLoading && status?.can_interrupt !== false && onAbort && (
            <>
              <div className="hidden items-center rounded-md bg-muted/50 px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground sm:flex">
                {formatElapsedTime(elapsedTime)}
              </div>

              <button
                type="button"
                onClick={onAbort}
                className="group flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-[10px] font-bold text-destructive transition-all hover:bg-destructive hover:text-destructive-foreground"
              >
                <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24">
                  <path d="M6 6h12v12H6z" />
                </svg>
                <span className="hidden sm:inline">STOP</span>
                <kbd className="hidden rounded bg-black/10 px-1 text-[9px] group-hover:bg-white/20 sm:block">
                  ESC
                </kbd>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expandable terminal-style activity panel */}
      {expanded && (
        <div className="animate-in fade-in slide-in-from-top-1 mx-auto mt-2 max-w-4xl overflow-hidden rounded-xl border border-border/50 bg-slate-950 shadow-lg duration-200">
          <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-500/70" />
              <span className="h-2 w-2 rounded-full bg-amber-500/70" />
              <span className="h-2 w-2 rounded-full bg-emerald-500/70" />
              <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                {t('claudeStatus.activity.title', { defaultValue: 'Live activity' })}
              </span>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-slate-600">{providerLabel}</span>
          </div>

          <div
            ref={logRef}
            className="max-h-64 space-y-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed"
          >
            {activityLines.length === 0 ? (
              <p className="text-slate-600">
                {t('claudeStatus.activity.waiting', { defaultValue: 'Waiting for activity…' })}
              </p>
            ) : (
              activityLines.map((line, index) => <ActivityRow key={index} line={line} />)
            )}
            {isLoading && (
              <span className="inline-block h-3 w-1.5 animate-pulse bg-emerald-400/80 align-middle" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

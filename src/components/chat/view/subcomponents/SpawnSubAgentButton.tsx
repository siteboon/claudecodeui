import { useCallback, useEffect, useRef, useState } from 'react';

import { Sparkles, X } from 'lucide-react';

import { PromptInputButton } from '../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../utils/api';

const SUBAGENT_TYPES: Array<{ id: string; label: string; description: string }> = [
  { id: 'general-purpose', label: 'General', description: 'Broad research, coding, multi-step tasks.' },
  { id: 'explore', label: 'Explore', description: 'Fast codebase exploration and file lookups.' },
  { id: 'plan', label: 'Plan', description: 'Design an implementation plan before writing code.' },
  { id: 'code-reviewer', label: 'Code review', description: 'Independent review of a diff or change.' },
];

type StreamEvent =
  | { type: 'start'; subAgentType: string; workingDir: string; promptLength: number }
  | { type: 'stdout'; chunk: string }
  | { type: 'stderr'; chunk: string }
  | { type: 'done'; code: number | null }
  | { type: 'error'; message: string };

interface SpawnSubAgentButtonProps {
  workingDir?: string;
  onInsertIntoInput?: (text: string) => void;
}

function parseSSEBuffer(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const events: Array<{ event: string; data: string }> = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    let evt = 'message';
    const dataLines: string[] = [];
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) {
        evt = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }
    events.push({ event: evt, data: dataLines.join('\n') });
  }
  return { events, rest };
}

export default function SpawnSubAgentButton({ workingDir, onInsertIntoInput }: SpawnSubAgentButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [subAgentType, setSubAgentType] = useState<string>(SUBAGENT_TYPES[0].id);
  const [prompt, setPrompt] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [doneCode, setDoneCode] = useState<number | null | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLPreElement | null>(null);

  const closeAndReset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsOpen(false);
    setIsRunning(false);
    setOutput('');
    setErrorMessage(null);
    setDoneCode(undefined);
    setPrompt('');
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isRunning) {
        closeAndReset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isRunning, closeAndReset]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleSubmit = useCallback(async () => {
    if (isRunning) {
      return;
    }
    setIsRunning(true);
    setOutput('');
    setErrorMessage(null);
    setDoneCode(undefined);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await authenticatedFetch('/api/mcp-bootstrap/spawn-sub-agent', {
        method: 'POST',
        body: JSON.stringify({ subAgentType, prompt, workingDir: workingDir || undefined }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        throw new Error(`Request failed (${response.status}): ${text}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let terminated = false;
      while (!terminated) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSSEBuffer(buffer);
        buffer = parsed.rest;
        for (const evt of parsed.events) {
          let payload: StreamEvent | null = null;
          try {
            payload = { type: evt.event as StreamEvent['type'], ...JSON.parse(evt.data) } as StreamEvent;
          } catch {
            continue;
          }
          if (payload.type === 'stdout' || payload.type === 'stderr') {
            setOutput((prev) => prev + payload.chunk);
          } else if (payload.type === 'error') {
            setErrorMessage(payload.message);
          } else if (payload.type === 'done') {
            setDoneCode(payload.code ?? 0);
            terminated = true;
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setErrorMessage((err as Error).message || 'Unknown error');
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, [isRunning, prompt, subAgentType, workingDir]);

  const handleCopyToInput = useCallback(() => {
    if (output && onInsertIntoInput) {
      onInsertIntoInput(output.trim());
      closeAndReset();
    }
  }, [closeAndReset, onInsertIntoInput, output]);

  return (
    <>
      <PromptInputButton
        tooltip={{ content: 'Spawn sub-agent' }}
        onClick={() => setIsOpen(true)}
        aria-label="Spawn sub-agent"
      >
        <Sparkles />
      </PromptInputButton>

      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm md:items-center md:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Spawn sub-agent"
        >
          <div
            className="ds-tile flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border md:rounded-2xl"
            data-accent="sky"
          >
            <div className="flex flex-shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Spawn sub-agent</h3>
              </div>
              <button
                type="button"
                onClick={closeAndReset}
                disabled={isRunning}
                className="inline-flex h-11 w-11 touch-manipulation items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-40"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              <div>
                <label className="mb-2 block text-xs font-medium text-muted-foreground" htmlFor="sub-agent-type">
                  Agent type
                </label>
                <div id="sub-agent-type" className="flex flex-wrap gap-2">
                  {SUBAGENT_TYPES.map((type) => {
                    const isActive = subAgentType === type.id;
                    return (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => setSubAgentType(type.id)}
                        disabled={isRunning}
                        className={`ds-chip min-h-[44px] ${isActive ? 'ds-chip-active' : ''}`}
                        aria-pressed={isActive}
                        title={type.description}
                      >
                        {type.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {SUBAGENT_TYPES.find((t) => t.id === subAgentType)?.description}
                </p>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium text-muted-foreground" htmlFor="sub-agent-prompt">
                  Prompt
                </label>
                <textarea
                  id="sub-agent-prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  disabled={isRunning}
                  rows={4}
                  placeholder="What should the sub-agent do?"
                  className="w-full resize-y rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none disabled:opacity-60"
                />
              </div>

              {(output || isRunning || errorMessage) && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      {isRunning ? 'Streaming…' : doneCode != null ? `Finished (exit ${doneCode})` : 'Output'}
                    </span>
                    {!isRunning && output && onInsertIntoInput && (
                      <button
                        type="button"
                        onClick={handleCopyToInput}
                        className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                      >
                        Copy to input
                      </button>
                    )}
                  </div>
                  <pre
                    ref={outputRef}
                    className="ds-tile-inset max-h-64 min-h-[4rem] overflow-auto whitespace-pre-wrap rounded-lg px-3 py-2 text-xs leading-relaxed text-foreground/90"
                  >
                    {output || (isRunning ? 'Starting…' : '')}
                  </pre>
                  {errorMessage && (
                    <p className="mt-2 text-xs text-destructive" role="alert">
                      {errorMessage}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-border/60 px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
              <button
                type="button"
                onClick={closeAndReset}
                disabled={isRunning}
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:opacity-40"
              >
                {isRunning ? 'Running…' : 'Close'}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isRunning || !prompt.trim()}
                className="btn-primary inline-flex min-h-[44px] items-center gap-2 px-4 text-sm disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                {isRunning ? 'Spawning…' : 'Spawn'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

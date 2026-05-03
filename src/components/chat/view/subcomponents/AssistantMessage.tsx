import { useState } from 'react';
import { Copy, Check, RotateCcw } from 'lucide-react';

type AssistantMessageProps = {
  content: string;
  isStreaming: boolean;
  timestamp: Date;
  provider: string;
  reasoning?: string;
  showThinking?: boolean;
  onCopy: () => void;
  onRetry?: () => void;
};

export default function AssistantMessage({
  content,
  isStreaming,
  timestamp,
  provider,
  reasoning,
  showThinking,
  onCopy,
  onRetry,
}: AssistantMessageProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div data-testid="assistant-message" className="group mb-3 animate-message-appear">
      <div className="max-w-[85%] sm:max-w-md lg:max-w-lg">
        {showThinking && reasoning && (
          <div className="mb-2 rounded-lg bg-thinking px-3 py-2 text-sm text-muted-foreground">
            {reasoning}
          </div>
        )}

        <div className="whitespace-pre-wrap text-base text-foreground">{content}</div>

        {isStreaming && (
          <div data-testid="streaming-indicator" className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            <span>Generating…</span>
          </div>
        )}

        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          <span>{timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="text-[10px] uppercase">{provider}</span>

          <button
            onClick={handleCopy}
            className="ml-auto rounded p-0.5 hover:bg-secondary"
            aria-label="Copy"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>

          {onRetry && (
            <button
              onClick={onRetry}
              className="rounded p-0.5 hover:bg-secondary"
              aria-label="Retry"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

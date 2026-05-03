import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Pencil, RotateCcw, ThumbsUp, ThumbsDown } from 'lucide-react';

type MessageActionsProps = {
  content: string;
  messageType: 'user' | 'assistant';
  onRetry?: () => void;
  onEdit?: () => void;
};

export default function MessageActions({ content, messageType, onRetry, onEdit }: MessageActionsProps) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border/50 bg-card/95 px-1 py-0.5 shadow-sm backdrop-blur-sm">
      <button
        type="button"
        onClick={handleCopy}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title={t('actions.copy', { defaultValue: 'Copy' })}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>

      {messageType === 'user' && onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t('actions.edit', { defaultValue: 'Edit' })}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}

      {messageType === 'assistant' && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t('actions.retry', { defaultValue: 'Retry' })}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}

      {messageType === 'assistant' && (
        <>
          <button
            type="button"
            onClick={() => setFeedback(feedback === 'up' ? null : 'up')}
            className={`rounded p-1 transition-colors ${
              feedback === 'up'
                ? 'text-green-500'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
            title={t('actions.helpful', { defaultValue: 'Helpful' })}
          >
            <ThumbsUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setFeedback(feedback === 'down' ? null : 'down')}
            className={`rounded p-1 transition-colors ${
              feedback === 'down'
                ? 'text-red-500'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
            title={t('actions.notHelpful', { defaultValue: 'Not helpful' })}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}

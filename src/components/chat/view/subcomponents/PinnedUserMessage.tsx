import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, MessageSquareIcon } from 'lucide-react';

interface PinnedUserMessageProps {
  lastUserMessage: string | null;
}

export default function PinnedUserMessage({ lastUserMessage }: PinnedUserMessageProps) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);

  if (!lastUserMessage || !lastUserMessage.trim()) return null;

  const truncated = lastUserMessage.length > 100
    ? lastUserMessage.slice(0, 100) + '...'
    : lastUserMessage;

  return (
    <div className="sticky top-2 z-10 mx-auto max-w-4xl px-3 sm:px-4">
      <div className="rounded-xl border border-border/50 bg-card/95 px-3 py-2 text-xs shadow-sm backdrop-blur-md">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-start gap-2 text-left"
        >
          {expanded ? <ChevronDown className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />}
          <MessageSquareIcon className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t('pinnedUserMessage.label', { defaultValue: 'Last prompt' })}
            </div>
            <div className={expanded ? 'whitespace-pre-wrap break-words text-foreground' : 'truncate text-foreground'}>
              {expanded ? lastUserMessage : truncated}
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}

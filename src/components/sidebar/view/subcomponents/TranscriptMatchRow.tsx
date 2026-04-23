import { Quote } from 'lucide-react';

import { CommandItem } from '../../../../shared/view/ui';
import type { TranscriptSessionResult } from '../../hooks/useTranscriptSearch';

type TranscriptMatchRowProps = {
  result: TranscriptSessionResult;
  onSelect: () => void;
};

function normalizeSnippet(raw: string): string {
  return raw
    .replace(/\.{3,}/g, '…')
    .replace(/…[\s.]*\./g, '…')
    .replace(/\.[\s.]*…/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function TranscriptMatchRow({ result, onSelect }: TranscriptMatchRowProps) {
  const title = result.sessionSummary || result.sessionId;
  const snippet = normalizeSnippet(result.match.snippet);

  return (
    <CommandItem
      value={`transcript ${title} ${snippet} ${result.projectDisplayName}`}
      alwaysVisible
      onSelect={onSelect}
      className="flex-col items-stretch gap-0.5"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Quote className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="flex-shrink-0 truncate text-[11px] text-muted-foreground">
          @{result.projectDisplayName}
        </span>
      </div>
      <span className="ml-6 truncate text-xs text-muted-foreground">{snippet}</span>
    </CommandItem>
  );
}

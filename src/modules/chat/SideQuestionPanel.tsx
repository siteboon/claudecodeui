import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Square, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Markdown } from '@/modules/chat/transcript/Markdown';
import type { useSideQuestion } from '@/modules/chat/hooks/useSideQuestion';

/** Used by ChatInterface to display CC's native /btw thread alongside the main transcript. */
export function SideQuestionPanel({ side }: { side: ReturnType<typeof useSideQuestion> }) {
  const { t } = useTranslation('chat');
  // The panel has its own draft so opening it preserves the main composer text.
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }); }, [side.exchanges, side.pending]);
  return (
    <aside aria-label={t('sideQuestion.title', { defaultValue: 'Side question' })}
      className="absolute inset-0 z-30 flex min-h-0 flex-col border-l border-border bg-background md:static md:z-auto md:w-[min(420px,42%)] md:shrink-0"
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); side.close(); } }}>
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <MessageSquare className="h-4 w-4" />
        <h2 className="flex-1 text-sm font-semibold">/btw</h2>
        <button type="button" onClick={side.clear} disabled={side.pending} className="rounded p-2 hover:bg-accent disabled:opacity-40"
          aria-label={t('sideQuestion.clear', { defaultValue: 'Clear side questions' })}><Trash2 className="h-4 w-4" /></button>
        <button type="button" onClick={side.close} className="rounded p-2 hover:bg-accent"
          aria-label={t('sideQuestion.close', { defaultValue: 'Close side question' })}><X className="h-4 w-4" /></button>
      </header>
      <p className="px-4 py-3 text-xs text-muted-foreground">{t('sideQuestion.description', {
        defaultValue: 'Claude Code’s native side question. Uses this conversation’s context, with no tools or changes to the main history.',
      })}</p>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4" aria-live="polite">
        {side.exchanges.map((entry, index) => <div key={index} className="space-y-2 text-sm">
          <div className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2">{entry.question}</div>
          {entry.response && <Markdown>{entry.response}</Markdown>}
          {entry.error && <p role="alert" className="whitespace-pre-wrap text-destructive">{entry.error}</p>}
        </div>)}
        {side.pending && <p role="status" className="text-sm text-muted-foreground">{t('sideQuestion.thinking', { defaultValue: 'Thinking…' })}</p>}
        <div ref={end} />
      </div>
      <form className="flex items-end gap-2 border-t border-border p-3" onSubmit={(event) => {
        event.preventDefault(); if (draft.trim() && side.ask(draft)) setDraft('');
      }}>
        <textarea ref={input} value={draft} onChange={(event) => setDraft(event.target.value)} rows={3}
          aria-label={t('sideQuestion.input', { defaultValue: 'Ask a side question' })}
          placeholder={t('sideQuestion.input', { defaultValue: 'Ask a side question' })}
          className="min-w-0 flex-1 resize-none rounded-lg border border-border bg-muted/30 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault(); if (!side.pending && draft.trim() && side.ask(draft)) setDraft('');
            }
          }} />
        {side.pending
          ? <button type="button" onClick={side.cancel} className="rounded-lg bg-muted p-2" aria-label={t('sideQuestion.stop', { defaultValue: 'Stop side question' })}><Square className="h-4 w-4" /></button>
          : <button type="submit" disabled={!draft.trim()} className="rounded-lg bg-primary p-2 text-primary-foreground disabled:opacity-40" aria-label={t('sideQuestion.send', { defaultValue: 'Send side question' })}><Send className="h-4 w-4" /></button>}
      </form>
    </aside>
  );
}

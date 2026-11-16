import { useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage } from '@/shared/types';
import { parseToolPayload } from '@/modules/chat/utils/messageTransforms';

const WRAP_UP_TOOL = 'mcp__ccd_turn__wrap_up';

type WrapUpContent = {
  recap: string;
  question: string;
  actions: string[];
};

/** Gives ChatMessagesPane the most recent Desktop wrap-up in the current turn. */
export function findDesktopWrapUp(messages: ChatMessage[]): (WrapUpContent & { message: ChatMessage }) | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.sideQuestion) continue;
    if (message.contextCleared || (message.type === 'user' && !message.isToolUse)) break;
    if (!message.isToolUse || message.toolName !== WRAP_UP_TOOL || message.toolResult?.isError) continue;
    const payload = parseToolPayload(message.toolInput);
    if (!payload || typeof payload !== 'object') continue;
    const { recap, ask, actions } = payload as Record<string, unknown>;
    const labels = Array.isArray(actions) ? actions.flatMap((action: unknown) => {
      if (!action || typeof action !== 'object' || !('label' in action) || typeof action.label !== 'string') return [];
      const label = action.label.trim();
      return label ? [label] : [];
    }) : [];
    const summary = typeof recap === 'string' ? recap.trim() : '';
    const question = typeof ask === 'string' ? ask.trim() : '';
    if (summary || question || labels.length) {
      return { message, recap: summary, question, actions: [...new Set(labels)] };
    }
  }
  return null;
}

/** Renders the active Desktop recap below the final assistant reply in ChatMessagesPane. */
export function DesktopWrapUpCard({ recap, question, actions, onChoose }: WrapUpContent & {
  onChoose?: (label: string) => void;
}) {
  const { t } = useTranslation('chat');
  // Remember explicit dismissal or selection for the mounted card.
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <aside className="rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          {recap && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{recap}</p>}
          {question && <p className="whitespace-pre-wrap break-words text-sm font-medium text-foreground">{question}</p>}
        </div>
        <button
          type="button"
          aria-label={t('session.dismissWrapUp', { defaultValue: 'Dismiss turn summary' })}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setDismissed(true)}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {onChoose && actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((label, index) => (
            <button
              key={label}
              type="button"
              className={`max-w-full whitespace-normal break-words rounded-md px-3 py-1.5 text-left text-sm font-medium ${
                index === 0 ? 'bg-foreground text-background hover:opacity-85' : 'bg-muted text-foreground hover:bg-muted/70'
              }`}
              onClick={() => { onChoose(label); setDismissed(true); }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

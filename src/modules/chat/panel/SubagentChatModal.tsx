import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader, X } from 'lucide-react';

import { api } from '@/shared/api';
import { cn } from '@/shared/utils';
import type { LLMProvider, NormalizedMessage, Project, SubagentSummary } from '@/shared/types';
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';
import {
  buildSubagentContinuationPrompt,
  extractLiveSubagentMessages,
  mergeSubagentMessages,
} from '@/modules/chat/utils/sessionSubagents';

/** Rows per history page — the agent's log is read tail-first, oldest upward. */
const HISTORY_PAGE_SIZE = 50;

type SubagentChatModalProps = {
  parentSessionId: string;
  summary: SubagentSummary;
  /** The parent session's live store rows; the agent's rows hide among them. */
  parentLiveMessages: NormalizedMessage[];
  provider: LLMProvider;
  selectedProject: Project | null;
  onClose: () => void;
  /** Starts the continuation session and navigates the workspace to it. */
  onContinue: (prompt: string) => Promise<boolean>;
};

/**
 * One agent's own conversation, opened from the info panel's roster.
 *
 * History comes from the dedicated endpoint (the parent's folded timeline
 * caps what it transmits; this is the complete record). Live rows are
 * derived from the parent's message slot by their spawn stamp and stamped
 * off before conversion, so they render as this agent's own messages rather
 * than folding back into the parent's Task card. Reading an agent is live
 * for free this way — the parent's websocket already carries every row.
 *
 * "Continue" cannot message the finished agent in place (it ran inside the
 * parent's SDK process, with no external input channel), so it opens a
 * brand-new session seeded with the agent's identity and its work log.
 */
export const SubagentChatModal = ({
  parentSessionId,
  summary,
  parentLiveMessages,
  provider,
  selectedProject,
  onClose,
  onContinue,
}: SubagentChatModalProps) => {
  const { t } = useTranslation('chat');
  const [history, setHistory] = useState<NormalizedMessage[]>([]);
  const [offset, setOffset] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const createDiff = useMemo(() => createCachedDiffCalculator(), []);

  // The newest page on open, then "load earlier" walks upward from there.
  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    void (async () => {
      try {
        const response = await api.providers.sessionSubagentMessages(parentSessionId, summary.agentId, {
          limit: HISTORY_PAGE_SIZE,
          offset: 0,
        });
        if (!response.ok) {
          if (!cancelled) {
            setHistory([]);
            setOffset(0);
          }
          return;
        }
        const payload = (await response.json()) as {
          data?: { messages?: NormalizedMessage[]; total?: number; offset?: number };
        };
        if (cancelled) return;
        const messages = payload.data?.messages ?? [];
        const totalCount = payload.data?.total ?? messages.length;
        setHistory(messages);
        // Rows already in hand are the tail; earlier pages start before them.
        setOffset(Math.max(0, totalCount - messages.length));
      } catch {
        if (!cancelled) {
          setHistory([]);
          setOffset(0);
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [parentSessionId, summary.agentId]);

  const live = useMemo(
    () => extractLiveSubagentMessages(parentLiveMessages, summary.toolUseId),
    [parentLiveMessages, summary.toolUseId],
  );
  const merged = useMemo(() => mergeSubagentMessages(history, live), [history, live]);
  const chatMessages = useMemo(() => normalizedToChatMessages(merged), [merged]);

  // Follow the newest row while it is at the bottom, the same courtesy the
  // main transcript extends to its own stream.
  const lastCountRef = useRef(0);
  useEffect(() => {
    if (chatMessages.length > lastCountRef.current) {
      const container = scrollRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    }
    lastCountRef.current = chatMessages.length;
  }, [chatMessages.length]);

  const loadEarlier = useCallback(async () => {
    if (offset <= 0 || historyLoading) return;
    setHistoryLoading(true);
    try {
      const from = Math.max(0, offset - HISTORY_PAGE_SIZE);
      const response = await api.providers.sessionSubagentMessages(parentSessionId, summary.agentId, {
        limit: HISTORY_PAGE_SIZE,
        offset: from,
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { data?: { messages?: NormalizedMessage[] } };
      const older = payload.data?.messages ?? [];
      if (older.length > 0) {
        // Prepending shifts the viewport; keep the reader on the row they had.
        const container = scrollRef.current;
        const previousHeight = container?.scrollHeight ?? 0;
        setHistory((current) => [...older, ...current]);
        setOffset(from);
        requestAnimationFrame(() => {
          if (container) container.scrollTop += container.scrollHeight - previousHeight;
        });
      } else {
        setOffset(0);
      }
    } finally {
      setHistoryLoading(false);
    }
  }, [offset, historyLoading, parentSessionId, summary.agentId]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const prompt = buildSubagentContinuationPrompt({
        summary,
        history,
        userText: text,
        copy: {
          identity: summary.agentType
            ? summary.description
              ? t('sessionInfoPanel.subagentsContinueIdentityWithDescription', {
                type: summary.agentType,
                description: summary.description,
              })
              : t('sessionInfoPanel.subagentsContinueIdentity', { type: summary.agentType })
            : summary.description
              ? t('sessionInfoPanel.subagentsContinueIdentityBare', { description: summary.description })
              : t('sessionInfoPanel.subagentsContinueIdentityPlain'),
          logIntro: t('sessionInfoPanel.subagentsContinueLogIntro'),
          askIntro: t('sessionInfoPanel.subagentsContinueAskIntro'),
        },
      });
      const launched = await onContinue(prompt);
      // The workspace took the packaged message; the overlay's job is done.
      if (launched) onClose();
    } finally {
      setSending(false);
    }
  }, [draft, sending, onContinue, onClose, summary, history, t]);

  // Escape closes the overlay, matching every other modal in the app.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={summary.description || summary.agentType || summary.agentId}
        className="flex h-[85%] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border/60 bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {summary.agentType || t('sessionInfoPanel.subagentsAgentLabel')}
            {summary.description && (
              <span className="ml-2 font-normal text-muted-foreground">{summary.description}</span>
            )}
          </h3>
          {summary.status === 'running' && (
            <span className="flex flex-shrink-0 items-center gap-1 text-[11px] text-purple-500">
              <Loader className="h-3 w-3 animate-spin" />
              {t('sessionInfoPanel.subagentsStatusRunning')}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t('sessionInfoPanel.subagentsCloseChat')}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {offset > 0 && (
            <button
              type="button"
              onClick={() => void loadEarlier()}
              disabled={historyLoading}
              className="mb-2 w-full rounded py-1 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
            >
              {historyLoading ? t('sessionInfoPanel.subagentsLoading') : t('sessionInfoPanel.subagentsLoadEarlier')}
            </button>
          )}
          {chatMessages.length === 0 && !historyLoading && (
            <div className="py-6 text-center text-xs text-muted-foreground">{t('sessionInfoPanel.empty')}</div>
          )}
          {chatMessages.map((message, index) => (
            <MessageComponent
              key={String(message.id ?? `msg-${index}`)}
              message={message}
              prevMessage={index > 0 ? chatMessages[index - 1] : null}
              createDiff={createDiff}
              provider={provider}
              selectedProject={selectedProject}
              showRawParameters={false}
              showThinking
            />
          ))}
        </div>

        <footer className="border-t border-border/40 p-2">
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              rows={2}
              placeholder={t('sessionInfoPanel.subagentsContinuePlaceholder')}
              className="min-h-9 flex-1 resize-none rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/50"
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!draft.trim() || sending}
              className={cn(
                'flex h-8 flex-shrink-0 items-center gap-1 rounded-md px-3 text-xs font-medium',
                'bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {sending && <Loader className="h-3 w-3 animate-spin" />}
              {t('sessionInfoPanel.subagentsContinueSend')}
            </button>
          </div>
          <p className="mt-1 px-1 text-[10px] text-muted-foreground/70">
            {t('sessionInfoPanel.subagentsContinueHint')}
          </p>
        </footer>
      </div>
    </div>
  );
};

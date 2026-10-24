import { useCallback, useEffect, useRef, useState } from 'react';

import { uploadAttachmentFiles } from '@/modules/chat/utils/uploadAttachments';
import { api } from '@/shared/api';
import type { ChatAttachment } from '@/shared/types';

/** One question of the /btw side chat and its answer (null while asked). */
export type SideChatEntry = {
  id: string;
  question: string;
  /** Browser-side previews of the pictures sent with the question. */
  previews: string[];
  answer: string | null;
  error: string | null;
};

type UseSideChatArgs = {
  sessionId: string | null;
  model: string;
  effort: string;
};

/**
 * The /btw side chat beside the main chat: questions about the conversation,
 * answered from a throwaway fork of it, never added to it. Nothing is saved on
 * the server, so the side chat lives here — one per main chat, for as long as
 * the page is open — and each question carries the earlier ones.
 */
export function useSideChat({ sessionId, model, effort }: UseSideChatArgs) {
  const [isOpen, setIsOpen] = useState(false);
  const [entriesBySession, setEntriesBySession] = useState<Map<string, SideChatEntry[]>>(() => new Map());
  const [busy, setBusy] = useState(false);
  // The side chat's own model and effort; they start as the main chat's.
  const [sideModel, setSideModel] = useState<string | null>(null);
  const [sideEffort, setSideEffort] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const key = sessionId ?? '';
  const entries = entriesBySession.get(key) ?? [];

  const updateEntries = useCallback((sessionKey: string, change: (previous: SideChatEntry[]) => SideChatEntry[]) => {
    setEntriesBySession((previous) => {
      const next = new Map(previous);
      next.set(sessionKey, change(previous.get(sessionKey) ?? []));
      return next;
    });
  }, []);

  // A question still running belongs to the chat it was asked in.
  useEffect(() => () => abortRef.current?.abort(), [key]);

  const ask = useCallback(
    async (question: string, files: File[] = []) => {
      setIsOpen(true);
      const text = question.trim();
      if (!text || busy) {
        return;
      }

      const sessionKey = key;
      const id = `btw_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const history = (entriesBySession.get(sessionKey) ?? [])
        .filter((entry) => entry.answer !== null)
        .map((entry) => ({ question: entry.question, answer: entry.answer as string }));
      const setEntry = (patch: Partial<SideChatEntry>) =>
        updateEntries(sessionKey, (previous) => previous.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));

      const previews = files.filter((file) => file.type.startsWith('image/')).map((file) => URL.createObjectURL(file));
      updateEntries(sessionKey, (previous) => [...previous, { id, question: text, previews, answer: null, error: null }]);
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const attachments = files.length > 0 ? (await uploadAttachmentFiles(files)) as ChatAttachment[] : [];
        const response = await api.providers.claudeSideQuestion(
          {
            sessionId: sessionId,
            question: text,
            model: sideModel ?? model,
            effort: sideEffort ?? effort,
            history,
            attachments,
          },
          { signal: controller.signal },
        );
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setEntry({ error: body?.error?.message || body?.message || `The side question failed (${response.status}).` });
          return;
        }
        setEntry({ answer: String(body?.data?.answer ?? '') });
      } catch (error) {
        setEntry({
          error: controller.signal.aborted
            ? 'Stopped.'
            : error instanceof Error ? error.message : 'The side question failed.',
        });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setBusy(false);
      }
    },
    [busy, effort, entriesBySession, key, model, sessionId, sideEffort, sideModel, updateEntries],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const clear = useCallback(() => {
    abortRef.current?.abort();
    updateEntries(key, (previous) => {
      previous.forEach((entry) => entry.previews.forEach((url) => URL.revokeObjectURL(url)));
      return [];
    });
  }, [key, updateEntries]);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return {
    isOpen,
    entries,
    busy,
    model: sideModel ?? model,
    effort: sideEffort ?? effort,
    setModel: setSideModel,
    setEffort: setSideEffort,
    ask,
    stop,
    clear,
    open,
    close,
  };
}

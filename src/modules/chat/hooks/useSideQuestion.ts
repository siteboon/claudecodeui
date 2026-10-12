import { useCallback, useEffect, useRef, useState } from 'react';

import { api, readApiJson } from '@/shared/api';

type Exchange = { question: string; response?: string; error?: string };
type SideState = { sessionId: string | null; open: boolean; exchanges: Exchange[]; pending: boolean };

/** Used by ChatInterface to keep native /btw answers outside the main message store. */
export function useSideQuestion(sessionId: string | null) {
  // Side history belongs to this panel/session and is never persisted as chat messages.
  const [state, setState] = useState<SideState>({ sessionId, open: false, exchanges: [], pending: false });
  const request = useRef<AbortController | null>(null);
  if (state.sessionId !== sessionId) {
    setState({ sessionId, open: false, exchanges: [], pending: false });
  }

  useEffect(() => {
    return () => { request.current?.abort(); request.current = null; };
  }, [sessionId]);

  const cancel = useCallback(() => {
    request.current?.abort();
  }, []);

  const ask = useCallback((question = '') => {
    if (!sessionId) return false;
    setState((previous) => ({ ...previous, open: true }));
    const text = question.trim();
    if (!text) return true;
    if (request.current) return false;
    const controller = new AbortController();
    request.current = controller;
    const history = state.sessionId === sessionId
      ? state.exchanges.filter((entry): entry is Exchange & { response: string } =>
        typeof entry.response === 'string' && !entry.error).slice(-20).map(({ question, response }) => ({ question, response }))
      : [];
    setState((previous) => ({ ...previous, pending: true, exchanges: [...previous.exchanges, { question: text }] }));
    void (async () => {
      try {
        const { data } = await readApiJson<{ data: { response: string; synthetic: boolean; refusalFallback?: { content: string } } }>(
          await api.askSideQuestion(sessionId, { question: text, history }, controller.signal),
        );
        if (request.current !== controller) return;
        const response = data.response + (data.refusalFallback?.content ? `\n\n${data.refusalFallback.content}` : '');
        setState((previous) => ({ ...previous, exchanges: previous.exchanges.map((entry, index) =>
          index === previous.exchanges.length - 1 ? { ...entry, ...(data.synthetic ? { error: response } : { response }) } : entry) }));
      } catch (error) {
        if (request.current !== controller) return;
        const message = controller.signal.aborted ? 'Cancelled' : error instanceof Error ? error.message : String(error);
        setState((previous) => ({ ...previous, exchanges: previous.exchanges.map((entry, index) =>
          index === previous.exchanges.length - 1 ? { ...entry, error: message } : entry) }));
      } finally {
        if (request.current === controller) {
          request.current = null;
          setState((previous) => ({ ...previous, pending: false }));
        }
      }
    })();
    return true;
  }, [sessionId, state.sessionId, state.exchanges]);

  return {
    ...(state.sessionId === sessionId ? state : { open: false, exchanges: [], pending: false }),
    ask,
    cancel,
    close: () => setState((previous) => ({ ...previous, open: false })),
    clear: () => { if (!request.current) setState((previous) => ({ ...previous, exchanges: [] })); },
  };
}

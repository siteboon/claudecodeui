import { createContext, useContext } from 'react';

/**
 * The app session id of the transcript being rendered.
 *
 * A workflow card fetches an agent's timeline on demand, and that request is
 * addressed by session. The card is rendered several components deep — a
 * message row, or a tool group inside one — and none of those know which
 * session they draw; ChatInterface provides it once, beside the markdown
 * workspace. Null outside a session (an exported document, a bare render),
 * where there is nothing to fetch from.
 */
export const TranscriptSessionContext = createContext<{ sessionId: string | null }>({ sessionId: null });

/** The app session id the transcript belongs to, or null outside a session. */
export function useTranscriptSessionId(): string | null {
  return useContext(TranscriptSessionContext).sessionId;
}

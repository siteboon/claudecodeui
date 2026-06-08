import { useEffect, useState } from 'react';

export type PendingSudoRequest = {
  requestId: string;
  prompt: string;
  sessionId?: string | null;
};

type SudoMessage = {
  kind?: string;
  type?: string;
  requestId?: string;
  prompt?: string;
  sessionId?: string | null;
} | null;

/**
 * Watches the realtime stream for sudo password prompts raised by chat agents
 * and exposes the currently-pending request so the UI can show a password modal.
 * Kept self-contained so it does not bloat the main realtime handler.
 */
export function useSudoPasswordPrompt(latestMessage: SudoMessage) {
  const [pendingSudoRequest, setPendingSudoRequest] = useState<PendingSudoRequest | null>(null);

  useEffect(() => {
    if (!latestMessage) {
      return;
    }
    const kind = latestMessage.kind || latestMessage.type;

    if (kind === 'sudo_password_request' && latestMessage.requestId) {
      setPendingSudoRequest({
        requestId: latestMessage.requestId,
        prompt: typeof latestMessage.prompt === 'string' ? latestMessage.prompt : '',
        sessionId: latestMessage.sessionId ?? null,
      });
    } else if (kind === 'sudo_password_cancelled' && latestMessage.requestId) {
      setPendingSudoRequest((prev) =>
        prev && prev.requestId === latestMessage.requestId ? null : prev,
      );
    }
  }, [latestMessage]);

  return {
    pendingSudoRequest,
    clearSudoRequest: () => setPendingSudoRequest(null),
  };
}

import type { ServerEvent } from '@/shared/types';

/**
 * How long a sent turn may go unacknowledged before the composer stops
 * waiting. The server acknowledges as soon as it admits the run, one round
 * trip on a healthy connection, so this only ever runs out for a lost frame.
 */
const CHAT_SEND_ACCEPTANCE_TIMEOUT_MS = 10_000;

/**
 * What became of a turn the composer sent: admitted by the server (or found
 * already admitted, when an earlier attempt's acknowledgement was lost),
 * refused by it (with its reason), or never confirmed either way — the frame
 * or its acknowledgement was lost, or the socket was replaced while waiting.
 */
type ChatSendOutcome =
  | { status: 'accepted'; duplicate: boolean }
  | { status: 'rejected'; error: string }
  | { status: 'unconfirmed' };

/**
 * Used by the chat composer to tag each turn it sends. `crypto.randomUUID`
 * exists only in secure contexts, and CloudCLI is often opened over plain
 * http on a LAN address, where `getRandomValues` is still available.
 */
export function createClientRequestId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Used by the chat composer to send a `chat.send`/`chat.edit-send` frame and
 * learn whether the server admitted it. `WebSocket.send()` returns as soon as
 * the frame is queued, so the only proof of delivery is the server's
 * `chat_send_accepted` for this `clientRequestId`; a `protocol_error` carrying
 * it settles the send at once as refused.
 *
 * A reconnect also ends the wait: the acknowledgement would have gone to the
 * socket that was replaced, so it can no longer arrive.
 */
export function sendChatTurnAwaitingAcceptance({
  frame,
  clientRequestId,
  sendMessage,
  subscribe,
}: {
  frame: Record<string, unknown>;
  clientRequestId: string;
  sendMessage: (message: unknown) => void;
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
}): Promise<ChatSendOutcome> {
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null;
    const settle = (outcome: ChatSendOutcome) => {
      clearTimeout(timer);
      unsubscribe?.();
      resolve(outcome);
    };
    const timer = setTimeout(() => settle({ status: 'unconfirmed' }), CHAT_SEND_ACCEPTANCE_TIMEOUT_MS);

    // Listening before sending, so an acknowledgement cannot slip past.
    unsubscribe = subscribe((event) => {
      if (event.kind === 'websocket_reconnected') {
        settle({ status: 'unconfirmed' });
      } else if (event.clientRequestId !== clientRequestId) {
        return;
      } else if (event.kind === 'chat_send_accepted') {
        settle({ status: 'accepted', duplicate: event.duplicate === true });
      } else if (event.kind === 'protocol_error') {
        settle({ status: 'rejected', error: String(event.error || event.code || 'Request failed') });
      }
    });
    sendMessage({ ...frame, clientRequestId });
  });
}

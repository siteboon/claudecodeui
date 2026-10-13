import { useCallback, useEffect, useRef, useState } from 'react';

import { IS_PLATFORM } from '@/shared/utils';
import { getStoredAuthToken } from '@/shared/authToken';

export type BrowserUseInput =
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle'; clickCount?: number }
  | { type: 'scroll'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'text'; text: string }
  | { type: 'key'; key: string }
  | { type: 'copy' };

function getBrowserUseStreamUrl(sessionId: string): string | null {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${protocol}//${window.location.host}/browser-use?sessionId=${encodeURIComponent(sessionId)}`;
  if (IS_PLATFORM) {
    return base;
  }
  const token = getStoredAuthToken();
  return token ? `${base}&token=${encodeURIComponent(token)}` : null;
}

/**
 * Opens the live stream of one Browser session: returns the latest frame as an object URL and a
 * `send` that forwards input over the same socket. `isLive` is false until the first frame arrives
 * (and after the socket drops), so callers can fall back to polled screenshots and HTTP input.
 */
export function useBrowserUseStream(
  sessionId: string | null,
  enabled: boolean,
  onClipboardText?: (text: string) => void,
) {
  const socketRef = useRef<WebSocket | null>(null);
  const onClipboardTextRef = useRef(onClipboardText);
  useEffect(() => {
    onClipboardTextRef.current = onClipboardText;
  }, [onClipboardText]);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    if (!enabled || !sessionId) {
      return undefined;
    }
    const url = getBrowserUseStreamUrl(sessionId);
    if (!url) {
      return undefined;
    }

    const socket = new WebSocket(url);
    socket.binaryType = 'blob';
    socketRef.current = socket;
    let currentFrameUrl: string | null = null;

    socket.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data) as { type?: string; text?: unknown };
          if (message.type === 'clipboard' && typeof message.text === 'string') {
            onClipboardTextRef.current?.(message.text);
          }
        } catch {
          // Ignore malformed messages.
        }
        return;
      }
      if (!(event.data instanceof Blob)) {
        return;
      }
      const nextUrl = URL.createObjectURL(event.data);
      const previousUrl = currentFrameUrl;
      currentFrameUrl = nextUrl;
      setFrameUrl(nextUrl);
      setIsLive(true);
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
    };
    socket.onclose = () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      setIsLive(false);
    };

    return () => {
      socket.onmessage = null;
      socket.onclose = null;
      socket.close();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      if (currentFrameUrl) {
        URL.revokeObjectURL(currentFrameUrl);
      }
      setFrameUrl(null);
      setIsLive(false);
    };
  }, [enabled, sessionId]);

  const send = useCallback((input: BrowserUseInput): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    socket.send(JSON.stringify(input));
    return true;
  }, []);

  return { frameUrl: isLive ? frameUrl : null, isLive, send };
}

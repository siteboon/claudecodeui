import { IS_PLATFORM } from '@/shared/utils';
import { getStoredAuthToken } from '@/shared/authToken';

type ShellInitMessage = {
  type: 'init';
  projectPath: string;
  sessionId: string | null;
  hasSession: boolean;
  provider: string;
  cols: number;
  rows: number;
  initialCommand: string | null | undefined;
  isPlainShell: boolean;
  forceRestart?: boolean;
  bypassPermissions?: boolean;
};

type ShellResizeMessage = {
  type: 'resize';
  cols: number;
  rows: number;
};

type ShellInputMessage = {
  type: 'input';
  data: string;
};

type ShellOutgoingMessage = ShellInitMessage | ShellResizeMessage | ShellInputMessage;

type ShellIncomingMessage =
  | { type: 'output'; data: string }
  // Sent instead of starting a PTY when the project path or session id is
  // rejected, so this is the only signal that the terminal will never start.
  | { type: 'error'; message?: string }
  | { type: 'auth_url'; url?: string }
  | { type: string; [key: string]: unknown };

export function getShellWebSocketUrl(): string | null {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (IS_PLATFORM) {
    return `${protocol}//${window.location.host}/shell`;
  }

  const token = getStoredAuthToken();
  if (!token) {
    console.error('No authentication token found for Shell WebSocket connection');
    return null;
  }

  return `${protocol}//${window.location.host}/shell?token=${encodeURIComponent(token)}`;
}

export function parseShellMessage(payload: string): ShellIncomingMessage | null {
  try {
    return JSON.parse(payload) as ShellIncomingMessage;
  } catch {
    return null;
  }
}

export function sendSocketMessage(ws: WebSocket | null, message: ShellOutgoingMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

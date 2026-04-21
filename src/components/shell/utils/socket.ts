import { IS_PLATFORM } from '../../../constants/config';
import { withBasePath } from '../../../utils/basePath.js';
import type { ShellIncomingMessage, ShellOutgoingMessage } from '../types/types';

export function getShellWebSocketUrl(): string | null {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const shellPath = withBasePath('/shell');

  if (IS_PLATFORM) {
    return `${protocol}//${window.location.host}${shellPath}`;
  }

  const token = localStorage.getItem('auth-token');
  if (!token) {
    console.error('No authentication token found for Shell WebSocket connection');
    return null;
  }

  return `${protocol}//${window.location.host}${shellPath}?token=${encodeURIComponent(token)}`;
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

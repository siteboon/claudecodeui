import type { ProjectSession } from '../../../types/app';
import { CODEX_DEVICE_AUTH_URL } from '../constants/constants';

export function isCodexLoginCommand(command: string | null | undefined): boolean {
  return typeof command === 'string' && /\bcodex\s+login\b/i.test(command);
}

export function resolveAuthUrlForDisplay(command: string | null | undefined, authUrl: string): string {
  if (isCodexLoginCommand(command)) {
    return CODEX_DEVICE_AUTH_URL;
  }

  return authUrl;
}

export function getSessionDisplayName(session: ProjectSession | null | undefined): string | null {
  if (!session) {
    return null;
  }

  return session.__provider === 'cursor'
    ? session.name || 'Untitled Session'
    : session.summary || 'New Session';
}
import type { ProjectSession } from '../../../types/app';

export function getSessionDisplayName(session: ProjectSession | null | undefined): string | null {
  if (!session) {
    return null;
  }

  return session.__provider === 'cursor'
    ? session.name || 'Untitled Session'
    : session.summary || 'New Session';
}

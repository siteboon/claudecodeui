import type { ProjectSession } from '../../../types/app';

export function getSessionDisplayName(session: ProjectSession | null | undefined): string | null {
  if (!session) {
    return null;
  }

  return session.summary || 'New Session';
}

import type { ProjectSession } from '../../../../types/app';

/**
 * Title shown in the main-content header for a session.
 *
 * Explicit rename (`customName`) wins over any CLI-derived fallback —
 * this is the "sticky name" contract. Presence of `customName` means the
 * user (or `/rename`) set it; absence means the session has never been
 * renamed and the title tracks whatever the CLI wrote.
 */
export function getSessionTitle(session: ProjectSession): string {
  if (session.customName) {
    return session.customName;
  }

  if (session.__provider === 'cursor') {
    return (session.name as string) || 'Untitled Session';
  }

  return (session.summary as string) || 'New Session';
}

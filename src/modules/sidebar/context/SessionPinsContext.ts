import { createContext } from 'react';

import type { PinnedConversationListItem } from '@/shared/types';

type SessionPinsState = {
  sessions: PinnedConversationListItem[];
  pinnedIds: ReadonlySet<string>;
  ready: boolean;
  hasError: boolean;
  pendingSessionId: string | null;
  refresh: () => Promise<void>;
  setPinned: (sessionId: string, isPinned: boolean) => Promise<void>;
};

/** The pin provider and sidebar hook share this context for confirmed server state. */
export const SessionPinsContext = createContext<SessionPinsState | null>(null);

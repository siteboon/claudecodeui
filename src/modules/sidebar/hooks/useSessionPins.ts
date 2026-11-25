import { useContext } from 'react';

import { SessionPinsContext } from '@/modules/sidebar/context/SessionPinsContext';

/** Pin buttons and both sidebar lists consume the same canonical state; isolated row callers may omit the provider. */
export function useSessionPins() {
  return useContext(SessionPinsContext);
}

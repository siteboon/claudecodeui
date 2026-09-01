import { useEffect, useState } from 'react';

import { readSelectedProvider } from '@/shared/selectedProvider';
import { subscribeToUserPreferences } from '@/shared/userSettings';
import type { LLMProvider } from '@/shared/types';

/**
 * The provider the user last chose, kept in step with the preference store.
 *
 * Reading storage during render would not re-render on a switch, and several
 * features branch on this value: the git panel attributes a generated commit
 * message, and the composer picks which dictation to use.
 *
 * One subscription covers a switch made in this tab and one hydrated from the
 * server, including a switch made on another device — the store notifies
 * synchronously in the writing tab too.
 */
export function useSelectedProvider(): LLMProvider {
  const [provider, setProvider] = useState(readSelectedProvider);

  useEffect(() => subscribeToUserPreferences(() => {
    setProvider(readSelectedProvider());
  }), []);

  return provider;
}

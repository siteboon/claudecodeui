import { useEffect, useState } from 'react';

import { readSelectedProvider } from '@/shared/selectedProvider';
import { subscribeToUserPreferences } from '@/shared/userSettings';
import type { LLMProvider } from '@/shared/types';

/** Used by the git panel to attribute a generated commit message to a provider. */
export function useSelectedProvider(): LLMProvider {
  // Mirrors the stored selection so the panel re-renders when it changes.
  // Reading storage during render would not, and this value decides which
  // provider a generated commit message is attributed to.
  const [provider, setProvider] = useState(readSelectedProvider);

  // One subscription covers a switch made in this tab and one hydrated from the
  // server, including a switch made on another device: the store notifies
  // synchronously in the writing tab too.
  useEffect(() => subscribeToUserPreferences(() => {
    setProvider(readSelectedProvider());
  }), []);

  return provider;
}

import { useEffect, useState } from 'react';

import {
  isSelectedProviderStorageEvent,
  readSelectedProvider,
  SELECTED_PROVIDER_CHANGED_EVENT,
} from '@/shared/selectedProvider';
import type { LLMProvider } from '@/shared/types';

/** Used by the git panel to attribute a generated commit message to a provider. */
export function useSelectedProvider(): LLMProvider {
  // Mirrors the stored selection so the panel re-renders when it changes.
  // Reading storage during render would not, and this value decides which
  // provider a generated commit message is attributed to.
  const [provider, setProvider] = useState(readSelectedProvider);

  useEffect(() => {
    const syncProvider = () => setProvider(readSelectedProvider());

    const handleStorageChange = (event: StorageEvent) => {
      if (isSelectedProviderStorageEvent(event)) {
        syncProvider();
      }
    };

    // The custom event covers this tab; `storage` covers the others.
    window.addEventListener(SELECTED_PROVIDER_CHANGED_EVENT, syncProvider);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener(SELECTED_PROVIDER_CHANGED_EVENT, syncProvider);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  return provider;
}

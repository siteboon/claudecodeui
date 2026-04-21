import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../utils/api';

/**
 * Node `process.platform` from the API host (e.g. win32, darwin, linux).
 * Null until loaded or if the request fails.
 */
export function useServerPlatform(): {
  serverPlatform: string | null;
  isWindowsServer: boolean;
} {
  const [serverPlatform, setServerPlatform] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await authenticatedFetch('/api/settings/server-env');
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as { platform?: string };
        if (!cancelled && typeof body.platform === 'string') {
          setServerPlatform(body.platform);
        }
      } catch {
        // Keep null: treat as unknown host.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    serverPlatform,
    isWindowsServer: serverPlatform === 'win32',
  };
}

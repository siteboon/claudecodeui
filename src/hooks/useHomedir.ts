import { useEffect, useState } from 'react';

import { api } from '../utils/api';

// Module-level cache: the server's home directory can't change while the app
// is open, so we fetch it at most once per session and share it across every
// consumer (a successful result is cached permanently; a failure is retried).
let cachedHomedir: string | null = null;
let inFlight: Promise<string | null> | null = null;

function fetchHomedir(): Promise<string | null> {
  if (cachedHomedir !== null) {
    return Promise.resolve(cachedHomedir);
  }
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const response = await api.systemHome();
        if (!response.ok) {
          return null;
        }
        const data = await response.json();
        const home =
          typeof data?.homedir === 'string' ? data.homedir.replace(/[/\\]+$/, '') : null;
        if (home) {
          cachedHomedir = home;
        }
        return home;
      } catch {
        return null;
      } finally {
        inFlight = null;
      }
    })();
  }
  return inFlight;
}

/**
 * Returns the server's home directory (trailing separators stripped), or
 * `null` until it has loaded / if the lookup failed. Used to render absolute
 * paths in the compact `~/…` form via {@link collapseHomePath}.
 */
export function useHomedir(): string | null {
  const [homedir, setHomedir] = useState<string | null>(cachedHomedir);

  useEffect(() => {
    if (homedir !== null) {
      return undefined;
    }
    let active = true;
    void fetchHomedir().then((home) => {
      if (active && home) {
        setHomedir(home);
      }
    });
    return () => {
      active = false;
    };
  }, [homedir]);

  return homedir;
}

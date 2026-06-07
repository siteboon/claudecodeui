import { useEffect, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';

// Whether the optional voice feature is configured on the server (VOICE_SIDECAR_URL set).
// Probed once and cached app-wide so the mic/speak controls can hide themselves when off.
let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

function probe(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  if (!inflight) {
    inflight = authenticatedFetch('/api/voice/health')
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => {
        cached = Boolean(d?.enabled);
        return cached;
      })
      .catch(() => {
        cached = false;
        return false;
      });
  }
  return inflight;
}

export function useVoiceAvailable(): boolean {
  const [available, setAvailable] = useState<boolean>(cached ?? false);
  useEffect(() => {
    let mounted = true;
    probe().then((v) => {
      if (mounted) setAvailable(v);
    });
    return () => {
      mounted = false;
    };
  }, []);
  return available;
}

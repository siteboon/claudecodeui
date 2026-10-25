import os from 'node:os';

/** Default fixed port for remote access, so a phone bookmark keeps working across restarts. */
export const REMOTE_PORT = 3917;

/** First Tailscale IPv4 address (100.64.0.0/10) on this machine, or null when Tailscale is not up. */
export function findTailscaleAddress(interfaces = os.networkInterfaces()) {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const [a, b] = entry.address.split('.').map(Number);
      if (a === 100 && b >= 64 && b <= 127) return entry.address;
    }
  }
  return null;
}

import { useState, useEffect } from 'react';
import { version } from '../../package.json';
import { ReleaseInfo } from '../shared/types';

// Three version sources feed two independent banners:
//
//   package.json `version`  ──┐ (baked into this bundle at build time)
//                             ├── differ? ──→ restartRequired  "restart the server"
//   GET /health .version    ──┘ (what the server process actually runs)
//
//   GET /health .updateCheckDisabled ──→ gate ──┐
//                                               ├── latest > current? ──→ updateAvailable
//   api.github.com releases/latest .tag_name ───┘                        "Update available"
//
// The gate only suppresses the GitHub poll (CLOUDCLI_DISABLE_UPDATE_CHECK /
// NO_UPDATE_NOTIFIER on the server). `restartRequired` makes no network call and
// is never suppressed. If `/health` fails or times out we fail open into the
// pre-flag behavior rather than muting update checks forever.

// Generous on purpose: this only has to break a connection a proxy is holding
// open. A tighter budget makes a cold or slow-but-healthy server look dead, and
// the bare catch below would then leave installMode at its 'git' default, which
// is what decides the upgrade command shown to the user.
const HEALTH_REQUEST_TIMEOUT_MS = 15000;

/**
 * Compare two semantic version strings
 * Works only with numeric versions separated by dots (e.g. "1.2.3")
 * @param {string} v1 
 * @param {string} v2
 * @returns positive if v1 > v2, negative if v1 < v2, 0 if equal
 */
const compareVersions = (v1: string, v2: string) => {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 !== p2) return p1 - p2;
  }
  return 0;
};

export type InstallMode = 'git' | 'npm';

export const useVersionCheck = (owner: string, repo: string) => {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo | null>(null);
  const [installMode, setInstallMode] = useState<InstallMode>('git');
  const [runningVersion, setRunningVersion] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const [healthChecked, setHealthChecked] = useState(false);
  const [updateCheckDisabled, setUpdateCheckDisabled] = useState(false);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await fetch('/health', { signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS) });
        const data = await response.json();
        if (data.installMode === 'npm' || data.installMode === 'git') {
          setInstallMode(data.installMode);
        }
        // `data.version` is the version the server process is actually running.
        // This module's `version` is baked into the frontend bundle at build
        // time, so it reflects the installed (on-disk) package. If they differ,
        // the package was updated but the server process was not restarted, and
        // DB-backed actions may silently fail until it is.
        if (typeof data.version === 'string' && data.version.length > 0) {
          setRunningVersion(data.version);
          setRestartRequired(data.version !== version);
        }
        setUpdateCheckDisabled(data.updateCheckDisabled === true);
      } catch {
        // Default to git / no restart hint on error
      } finally {
        // Set on both paths: a broken or hung /health must fail open into the
        // pre-flag behavior, never silently mute update checks forever.
        setHealthChecked(true);
      }
    };
    fetchHealth();
  }, []);

  useEffect(() => {
    if (!healthChecked || updateCheckDisabled) return;

    const checkVersion = async () => {
      try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
        const data = await response.json();

        // Handle the case where there might not be any releases
        if (data.tag_name) {
          const latest = data.tag_name.replace(/^v/, '');
          setLatestVersion(latest);
          // Only show update if latest version is actually newer
          setUpdateAvailable(compareVersions(latest, version) > 0);

          // Store release information
          setReleaseInfo({
            title: data.name || data.tag_name,
            body: data.body || '',
            htmlUrl: data.html_url || `https://github.com/${owner}/${repo}/releases/latest`,
            publishedAt: data.published_at
          });
        } else {
          // No releases found, don't show update notification
          setUpdateAvailable(false);
          setLatestVersion(null);
          setReleaseInfo(null);
        }
      } catch (error) {
        console.error('Version check failed:', error);
        // On error, don't show update notification
        setUpdateAvailable(false);
        setLatestVersion(null);
        setReleaseInfo(null);
      }
    };

    checkVersion();
    const interval = setInterval(checkVersion, 5 * 60 * 1000); // Check every 5 minutes
    return () => clearInterval(interval);
  }, [owner, repo, healthChecked, updateCheckDisabled]);

  return { updateAvailable, latestVersion, currentVersion: version, releaseInfo, installMode, runningVersion, restartRequired };
};

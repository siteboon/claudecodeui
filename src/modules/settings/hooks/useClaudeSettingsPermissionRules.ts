import { useEffect, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { ClaudeSettingsPermissionSource } from '@/shared/types';

type ClaudeSettingsPermissionsResponse = {
  data?: { sources?: ClaudeSettingsPermissionSource[] };
};

/**
 * Used by ClaudeSettingsFileRules (Claude permissions panel) to load the
 * permission rules the Claude CLI reads from its own settings files, once per
 * mount. Read-only: the app never edits those files.
 */
export function useClaudeSettingsPermissionRules() {
  // The files live on the server; null until it answers, so the panel shows a
  // loading line instead of claiming there are no rules.
  const [sources, setSources] = useState<ClaudeSettingsPermissionSource[] | null>(null);
  // The request itself failed (server unreachable or too old for the route),
  // which is different from one file being unreadable.
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await api.providers.claudeSettingsPermissions();
        const payload = await readApiJson<ClaudeSettingsPermissionsResponse>(response);
        if (!cancelled) {
          setSources(payload.data?.sources ?? []);
        }
      } catch (error) {
        console.error('Error loading Claude settings-file permission rules:', error);
        if (!cancelled) {
          setLoadFailed(true);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { sources, loadFailed };
}

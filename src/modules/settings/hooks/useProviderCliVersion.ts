import { useCallback, useEffect, useState } from 'react';

import { api, ApiRequestError, readApiJson } from '@/shared/api';
import type { AgentProvider, ProviderCliStatus, ProviderCliUpdateResult } from '@/shared/types';

type ProviderCliStatusResponse = { data: ProviderCliStatus };
type ProviderCliUpdateResponse = { data: ProviderCliUpdateResult };

/** Why an update request was not run at all, as opposed to a run that failed. */
type ProviderCliUpdateRequestError = {
  /** The server's error code, e.g. PROVIDER_CLI_BUSY, when it sent one. */
  code: string | null;
  message: string;
};

const fetchCliStatus = async (provider: AgentProvider): Promise<ProviderCliStatus> => {
  const response = await api.providers.cliStatus(provider);
  return (await readApiJson<ProviderCliStatusResponse>(response)).data;
};

/**
 * Used by ProviderCliVersion (settings account view) to load one provider
 * CLI's installed and latest version and to run its updater. The status is
 * reloaded after every update run, so the row shows the version the updater
 * actually left behind. Mount it once per provider (the view is keyed by
 * agent) so a run's result never lands on another agent's row.
 */
export function useProviderCliVersion(provider: AgentProvider) {
  // The server's answer; null while the first request is in flight or when it
  // failed, and the row then falls back to the version from the auth status.
  const [status, setStatus] = useState<ProviderCliStatus | null>(null);
  // An update run takes from seconds to minutes; this disables the button and
  // shows progress for the whole request.
  const [updating, setUpdating] = useState(false);
  // The last finished run (output, versions, failure), shown under the row
  // until the user switches agents.
  const [updateResult, setUpdateResult] = useState<ProviderCliUpdateResult | null>(null);
  // A request the server refused (busy session, platform mode) or that never
  // reached it; kept apart from updateResult because there is no run output.
  const [updateError, setUpdateError] = useState<ProviderCliUpdateRequestError | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchCliStatus(provider)
      .then((nextStatus) => {
        if (!cancelled) {
          setStatus(nextStatus);
        }
      })
      .catch((error: unknown) => {
        console.error(`Error loading the ${provider} CLI version:`, error);
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const runUpdate = useCallback(async () => {
    setUpdating(true);
    setUpdateResult(null);
    setUpdateError(null);
    try {
      const response = await api.providers.updateCli(provider);
      const payload = await readApiJson<ProviderCliUpdateResponse>(response);
      setUpdateResult(payload.data);
    } catch (error) {
      setUpdateError({
        code: error instanceof ApiRequestError ? error.code ?? null : null,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setUpdating(false);
    }
    try {
      setStatus(await fetchCliStatus(provider));
    } catch (error) {
      console.error(`Error reloading the ${provider} CLI version:`, error);
    }
  }, [provider]);

  return { status, updating, updateResult, updateError, runUpdate };
}

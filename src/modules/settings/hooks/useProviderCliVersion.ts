import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiRequestError, readApiJson } from '@/shared/api';
import type { AgentProvider, ProviderCliStatus, ProviderCliUpdateResult } from '@/shared/types';

type ProviderCliStatusResponse = { data: ProviderCliStatus };
type ProviderCliUpdateResponse = { data: ProviderCliUpdateResult };

/**
 * Why an update request left no run result. `refused`: the server answered
 * and did not start the updater (busy session, platform mode). `unconfirmed`:
 * no readable answer came back (the connection dropped, a proxy gave up on the
 * long request), so the updater may still have run.
 */
type ProviderCliUpdateRequestError = {
  kind: 'refused' | 'unconfirmed';
  /** The server's error code, e.g. PROVIDER_CLI_BUSY, when it sent one. */
  code: string | null;
  message: string;
};

type ProviderCliUpdateOutcome = {
  result: ProviderCliUpdateResult | null;
  error: ProviderCliUpdateRequestError | null;
  /** The status read while finding out what happened; null when it still has to be loaded. */
  status: ProviderCliStatus | null;
};

/** How often a row that follows a run it did not see finish asks whether the run is over. */
const UPDATE_POLL_INTERVAL_MS = 3000;

const fetchCliStatus = async (provider: AgentProvider): Promise<ProviderCliStatus> => {
  const response = await api.providers.cliStatus(provider);
  return (await readApiJson<ProviderCliStatusResponse>(response)).data;
};

const wait = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * Polls the CLI status until the server reports no update running, and returns
 * that status. Returns null when `isActive` turns false first (the row went away).
 */
async function waitForUpdateToEnd(
  provider: AgentProvider,
  isActive: () => boolean,
): Promise<ProviderCliStatus | null> {
  let current: ProviderCliStatus;
  do {
    await wait(UPDATE_POLL_INTERVAL_MS);
    if (!isActive()) {
      return null;
    }
    current = await fetchCliStatus(provider);
  } while (current.updateInProgress);
  return current;
}

/**
 * Sends the update request. Without a readable answer (a dropped connection,
 * or a proxy's 502/504 page after its read timeout) the updater may still be
 * running on the server, so the server is asked: a run that is still going is
 * followed to its end and its result returned.
 */
async function requestUpdate(provider: AgentProvider, isActive: () => boolean): Promise<ProviderCliUpdateOutcome> {
  let response: Response | null = null;
  try {
    response = await api.providers.updateCli(provider);
    const payload = await readApiJson<ProviderCliUpdateResponse>(response);
    return { result: payload.data, error: null, status: null };
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    // The server's own refusals always carry a code.
    if (error instanceof ApiRequestError && error.code) {
      return { result: null, error: { kind: 'refused', code: error.code, message }, status: null };
    }
    // A proxy's HTML error page fails to parse as JSON; its HTTP status says
    // more than the parser's message does.
    if (response && !response.ok && !(error instanceof ApiRequestError)) {
      message = `HTTP ${response.status} ${response.statusText}`.trim();
    }

    const unconfirmed: ProviderCliUpdateRequestError = { kind: 'unconfirmed', code: null, message };
    try {
      const current = await fetchCliStatus(provider);
      const final = current.updateInProgress ? await waitForUpdateToEnd(provider, isActive) : current;
      if (final?.lastUpdate && current.updateInProgress) {
        return { result: final.lastUpdate, error: null, status: final };
      }
      return { result: null, error: unconfirmed, status: final };
    } catch {
      return { result: null, error: unconfirmed, status: null };
    }
  }
}

/**
 * Used by ProviderCliVersion (settings account view) to load one provider
 * CLI's installed and latest version and to run its updater. The status is
 * reloaded after every update run, so the row shows the version the updater
 * actually left behind. An update outlives the row that started it, so a row
 * that mounts while the server reports one running shows it as running and
 * picks up its result. Mount it once per provider (the view is keyed by
 * agent) so a run's result never lands on another agent's row.
 */
export function useProviderCliVersion(provider: AgentProvider) {
  // The server's answer; null while the first request is in flight or when it
  // failed, and the row then falls back to the version from the auth status.
  const [status, setStatus] = useState<ProviderCliStatus | null>(null);
  // Set when the first status request failed, so the row stops saying it is
  // still checking the version.
  const [statusFailed, setStatusFailed] = useState(false);
  // An update run takes from seconds to minutes; this disables the button and
  // shows progress for the whole run, including one this row only follows.
  const [updating, setUpdating] = useState(false);
  // The last finished run (output, versions, failure), shown under the row
  // until the user switches agents.
  const [updateResult, setUpdateResult] = useState<ProviderCliUpdateResult | null>(null);
  // A request the server refused (busy session, platform mode) or whose answer
  // was lost; kept apart from updateResult because there is no run output.
  const [updateError, setUpdateError] = useState<ProviderCliUpdateRequestError | null>(null);
  // False once the row has unmounted: an update request or a poll can outlive
  // it by minutes, and their answers are then dropped (the next row asks the
  // server instead).
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loaded = false;
    const follow = async () => {
      try {
        const initial = await fetchCliStatus(provider);
        if (cancelled) {
          return;
        }
        loaded = true;
        setStatus(initial);
        if (!initial.updateInProgress) {
          return;
        }

        // Started before this row mounted (on another agent's tab, before
        // Settings was closed or the page reloaded) and still running.
        setUpdating(true);
        const final = await waitForUpdateToEnd(provider, () => !cancelled);
        if (!final || cancelled) {
          return;
        }
        setStatus(final);
        setUpdateResult(final.lastUpdate);
        setUpdating(false);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error(`Error loading the ${provider} CLI version:`, error);
        if (loaded) {
          // Lost track of a run this row was following.
          setUpdateError({
            kind: 'unconfirmed',
            code: null,
            message: error instanceof Error ? error.message : String(error),
          });
          setUpdating(false);
        } else {
          setStatusFailed(true);
        }
      }
    };
    void follow();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const runUpdate = useCallback(async () => {
    setUpdating(true);
    setUpdateResult(null);
    setUpdateError(null);
    const outcome = await requestUpdate(provider, () => mountedRef.current);
    if (!mountedRef.current) {
      return;
    }
    setUpdateResult(outcome.result);
    setUpdateError(outcome.error);
    setUpdating(false);
    if (outcome.status) {
      setStatus(outcome.status);
      return;
    }
    try {
      setStatus(await fetchCliStatus(provider));
    } catch (error) {
      console.error(`Error reloading the ${provider} CLI version:`, error);
    }
  }, [provider]);

  return { status, statusFailed, updating, updateResult, updateError, runUpdate };
}

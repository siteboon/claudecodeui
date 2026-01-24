import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../utils/api";

const POLL_INTERVAL = 10000; // 10 seconds

function useSessionsList(timeframe = "1w", enabled = true) {
  const [sessions, setSessions] = useState([]);
  const [meta, setMeta] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Store ETag for 304 support
  const etagRef = useRef(null);
  const pollIntervalRef = useRef(null);

  const fetchSessions = useCallback(async () => {
    if (!enabled) return;

    try {
      const response = await api.sessionsList(timeframe, etagRef.current);

      // Handle 304 Not Modified - data unchanged, no need to update state
      if (response.status === 304) {
        setIsLoading(false);
        return;
      }

      if (!response.ok) {
        // Handle 503 - cache not yet initialized
        if (response.status === 503) {
          const errorData = await response.json();
          setError(errorData.message || "Sessions cache not yet initialized");
          setIsLoading(false);
          return;
        }
        throw new Error(`Failed to fetch sessions: ${response.status}`);
      }

      // Store new ETag from response
      const newETag = response.headers.get("etag");
      if (newETag) {
        etagRef.current = newETag;
      }

      const data = await response.json();
      setSessions(data.sessions || []);
      setMeta(data.meta || null);
      setError(null);
    } catch (err) {
      console.error("[useSessionsList] Error:", err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [timeframe, enabled]);

  // Initial fetch and timeframe change
  useEffect(() => {
    if (!enabled) return;

    // Reset ETag when timeframe changes (new filter = new cache state)
    etagRef.current = null;
    setIsLoading(true);
    fetchSessions();
  }, [timeframe, enabled, fetchSessions]);

  // Set up polling
  useEffect(() => {
    if (!enabled) return;

    // Clear any existing interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    // Start polling
    pollIntervalRef.current = setInterval(fetchSessions, POLL_INTERVAL);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [enabled, fetchSessions]);

  // Force refresh function (clears ETag to force new data)
  const refresh = useCallback(() => {
    etagRef.current = null;
    setIsLoading(true);
    fetchSessions();
  }, [fetchSessions]);

  return {
    sessions,
    meta,
    isLoading,
    error,
    refresh,
  };
}

export default useSessionsList;

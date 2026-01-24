import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../utils/api";

const POLL_INTERVAL = 10000; // 10 seconds

/**
 * Hook for fetching slim projects list with ETag-based caching
 * Mirrors useSessionsList pattern for consistency
 *
 * @param {string} timeframe - Time filter: '1h' | '8h' | '1d' | '1w' | '2w' | '1m' | 'all'
 * @param {boolean} enabled - Whether to enable fetching and polling
 * @returns {Object} { projects, meta, isLoading, error, refresh }
 */
function useProjectsList(timeframe = "1w", enabled = true) {
  const [projects, setProjects] = useState([]);
  const [meta, setMeta] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Store ETag for 304 support
  const etagRef = useRef(null);
  const pollIntervalRef = useRef(null);

  const fetchProjects = useCallback(async () => {
    if (!enabled) return;

    try {
      const response = await api.projectsList(timeframe, etagRef.current);

      // Handle 304 Not Modified - data unchanged, no need to update state
      if (response.status === 304) {
        setIsLoading(false);
        return;
      }

      if (!response.ok) {
        // Handle 503 - cache not yet initialized
        if (response.status === 503) {
          const errorData = await response.json();
          setError(errorData.message || "Projects cache not yet initialized");
          setIsLoading(false);
          return;
        }
        throw new Error(`Failed to fetch projects: ${response.status}`);
      }

      // Store new ETag from response
      const newETag = response.headers.get("etag");
      if (newETag) {
        etagRef.current = newETag;
      }

      const data = await response.json();
      setProjects(data.projects || []);
      setMeta(data.meta || null);
      setError(null);
    } catch (err) {
      console.error("[useProjectsList] Error:", err);
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
    fetchProjects();
  }, [timeframe, enabled, fetchProjects]);

  // Set up polling
  useEffect(() => {
    if (!enabled) return;

    // Clear any existing interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    // Start polling
    pollIntervalRef.current = setInterval(fetchProjects, POLL_INTERVAL);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [enabled, fetchProjects]);

  // Force refresh function (clears ETag to force new data)
  const refresh = useCallback(() => {
    etagRef.current = null;
    setIsLoading(true);
    fetchProjects();
  }, [fetchProjects]);

  return {
    projects,
    meta,
    isLoading,
    error,
    refresh,
  };
}

export default useProjectsList;

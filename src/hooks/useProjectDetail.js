import { useState, useCallback, useRef } from "react";
import { api } from "../utils/api";

const CACHE_TTL = 30000; // 30 seconds

/**
 * Hook for fetching detailed project data on-demand
 * Uses in-memory cache with TTL to avoid redundant fetches
 *
 * @returns {Object} { getProjectDetail, isLoading, error, clearCache }
 */
function useProjectDetail() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // In-memory cache: { [projectName]: { data, timestamp } }
  const cacheRef = useRef({});

  /**
   * Get detailed project data, using cache if available and fresh
   * @param {string} projectName - The project name to fetch
   * @param {boolean} forceRefresh - Skip cache and fetch fresh data
   * @returns {Promise<Object|null>} Full project data or null on error
   */
  const getProjectDetail = useCallback(
    async (projectName, forceRefresh = false) => {
      const now = Date.now();
      const cached = cacheRef.current[projectName];

      // Return cached data if fresh
      if (!forceRefresh && cached && now - cached.timestamp < CACHE_TTL) {
        return cached.data;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await api.projectDetail(projectName);

        if (!response.ok) {
          if (response.status === 404) {
            setError("Project not found");
            return null;
          }
          throw new Error(`Failed to fetch project detail: ${response.status}`);
        }

        const data = await response.json();

        // Cache the result
        cacheRef.current[projectName] = {
          data,
          timestamp: now,
        };

        return data;
      } catch (err) {
        console.error("[useProjectDetail] Error:", err);
        setError(err.message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  /**
   * Clear cache for a specific project or all projects
   * @param {string|null} projectName - Project to clear, or null for all
   */
  const clearCache = useCallback((projectName = null) => {
    if (projectName) {
      delete cacheRef.current[projectName];
    } else {
      cacheRef.current = {};
    }
  }, []);

  /**
   * Invalidate cache entry (mark as stale but keep data)
   * Next fetch will get fresh data but can still return stale if fetch fails
   * @param {string} projectName - Project to invalidate
   */
  const invalidateCache = useCallback((projectName) => {
    const cached = cacheRef.current[projectName];
    if (cached) {
      cached.timestamp = 0; // Mark as expired
    }
  }, []);

  return {
    getProjectDetail,
    isLoading,
    error,
    clearCache,
    invalidateCache,
  };
}

export default useProjectDetail;

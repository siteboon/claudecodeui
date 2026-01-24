/**
 * SESSIONS CACHE MODULE
 * ====================
 *
 * In-memory cache for sessions data with ETag support.
 * Updated by the chokidar watcher when project files change.
 */

import crypto from "crypto";

// Cache state
let cachedSessions = [];
let cacheVersion = 0;
let cacheTimestamp = null;
let lastProjectsData = null;

/**
 * Timeframe definitions in milliseconds
 */
const TIMEFRAME_MS = {
  "1h": 60 * 60 * 1000,
  "8h": 8 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "2w": 14 * 24 * 60 * 60 * 1000,
  "1m": 30 * 24 * 60 * 60 * 1000,
  all: Infinity,
};

/**
 * Update the sessions cache from projects data
 * Called after getProjects() completes
 */
function updateSessionsCache(projects) {
  const sessions = [];

  for (const project of projects) {
    // Process Claude sessions
    if (project.sessions) {
      for (const session of project.sessions) {
        sessions.push({
          id: session.id,
          summary: session.summary || "New Session",
          lastActivity: session.lastActivity,
          messageCount: session.messageCount || 0,
          provider: "claude",
          cwd: session.cwd || project.path,
          project: {
            name: project.name,
            displayName: project.displayName,
            fullPath: project.fullPath || project.path,
          },
        });
      }
    }

    // Process Cursor sessions
    if (project.cursorSessions) {
      for (const session of project.cursorSessions) {
        sessions.push({
          id: session.id,
          summary: session.name || "Cursor Session",
          lastActivity: session.createdAt || session.lastActivity,
          messageCount: session.messageCount || 0,
          provider: "cursor",
          cwd: session.projectPath || project.path,
          project: {
            name: project.name,
            displayName: project.displayName,
            fullPath: project.fullPath || project.path,
          },
        });
      }
    }

    // Process Codex sessions
    if (project.codexSessions) {
      for (const session of project.codexSessions) {
        sessions.push({
          id: session.id,
          summary: session.summary || session.name || "Codex Session",
          lastActivity: session.lastActivity || session.createdAt,
          messageCount: session.messageCount || 0,
          provider: "codex",
          cwd: session.cwd || project.path,
          project: {
            name: project.name,
            displayName: project.displayName,
            fullPath: project.fullPath || project.path,
          },
        });
      }
    }
  }

  // Sort by lastActivity descending
  sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

  cachedSessions = sessions;
  cacheVersion++;
  cacheTimestamp = new Date().toISOString();
  lastProjectsData = projects;
}

/**
 * Get sessions filtered by timeframe
 */
function getSessionsByTimeframe(timeframe = "1w") {
  const now = Date.now();
  const cutoffMs = TIMEFRAME_MS[timeframe] || TIMEFRAME_MS["1w"];

  if (cutoffMs === Infinity) {
    return {
      sessions: cachedSessions,
      totalCount: cachedSessions.length,
      filteredCount: cachedSessions.length,
    };
  }

  const cutoffTime = now - cutoffMs;
  const filteredSessions = cachedSessions.filter((session) => {
    const sessionTime = new Date(session.lastActivity).getTime();
    return sessionTime >= cutoffTime;
  });

  return {
    sessions: filteredSessions,
    totalCount: cachedSessions.length,
    filteredCount: filteredSessions.length,
  };
}

/**
 * Generate ETag for current cache state + timeframe
 */
function generateETag(timeframe = "1w") {
  const hash = crypto.createHash("md5");
  hash.update(`${cacheVersion}-${cacheTimestamp}-${timeframe}`);
  return `"${hash.digest("hex")}"`;
}

/**
 * Get cache metadata
 */
function getCacheMeta() {
  return {
    version: cacheVersion,
    timestamp: cacheTimestamp,
    sessionCount: cachedSessions.length,
  };
}

/**
 * Check if cache is initialized
 */
function isCacheInitialized() {
  return cacheTimestamp !== null;
}

/**
 * Get the raw cached sessions (for initial load)
 */
function getCachedSessions() {
  return cachedSessions;
}

/**
 * Get last projects data (for refreshing the cache)
 */
function getLastProjectsData() {
  return lastProjectsData;
}

export {
  updateSessionsCache,
  getSessionsByTimeframe,
  generateETag,
  getCacheMeta,
  isCacheInitialized,
  getCachedSessions,
  getLastProjectsData,
  TIMEFRAME_MS,
};

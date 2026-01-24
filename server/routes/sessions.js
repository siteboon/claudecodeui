/**
 * SESSIONS API ROUTES
 * ===================
 *
 * GET /api/sessions/list
 * Returns a flat list of all sessions with optional timeframe filtering.
 * Supports ETag/304 caching for efficient polling.
 */

import express from "express";
import {
  getSessionsByTimeframe,
  generateETag,
  getCacheMeta,
  isCacheInitialized,
  TIMEFRAME_MS,
} from "../sessions-cache.js";

const router = express.Router();

/**
 * GET /api/sessions/list
 *
 * Query Parameters:
 * - timeframe: '1h' | '8h' | '1d' | '1w' | '2w' | '1m' | 'all' (default: '1w')
 *
 * Headers:
 * - If-None-Match: ETag from previous response (for 304 support)
 *
 * Response:
 * - 304 Not Modified (if ETag matches)
 * - 200 OK with sessions data
 */
router.get("/list", (req, res) => {
  try {
    // Check if cache is initialized
    if (!isCacheInitialized()) {
      return res.status(503).json({
        error: "Sessions cache not yet initialized",
        message: "Please wait for initial project scan to complete",
      });
    }

    // Get timeframe from query (validate against known values)
    const timeframe =
      TIMEFRAME_MS[req.query.timeframe] !== undefined
        ? req.query.timeframe
        : "1w";

    // Generate current ETag
    const currentETag = generateETag(timeframe);

    // Check If-None-Match header for conditional request
    const clientETag = req.headers["if-none-match"];
    if (clientETag && clientETag === currentETag) {
      // Data hasn't changed - return 304
      return res.status(304).end();
    }

    // Get sessions filtered by timeframe
    const { sessions, totalCount, filteredCount } =
      getSessionsByTimeframe(timeframe);
    const cacheMeta = getCacheMeta();

    // Set caching headers
    res.set({
      "Cache-Control": "private, max-age=10",
      ETag: currentETag,
    });

    // Return sessions data
    res.json({
      sessions,
      meta: {
        totalCount,
        filteredCount,
        timeframe,
        cacheTimestamp: cacheMeta.timestamp,
      },
    });
  } catch (error) {
    console.error("[ERROR] Sessions list endpoint error:", error);
    res.status(500).json({
      error: "Failed to retrieve sessions",
      message: error.message,
    });
  }
});

/**
 * GET /api/sessions/cache-status
 * Returns current cache status (for debugging/monitoring)
 */
router.get("/cache-status", (req, res) => {
  try {
    const meta = getCacheMeta();
    res.json({
      initialized: isCacheInitialized(),
      ...meta,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

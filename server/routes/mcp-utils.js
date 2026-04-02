/**
 * MCP UTILITIES API ROUTES
 * ========================
 * 
 * API endpoints for MCP server detection and configuration utilities.
 * These endpoints expose centralized MCP detection functionality.
 */

import express from 'express';
import { detectTaskMasterMCPServer, getAllMCPServers } from '../utils/mcp-detector.js';

const router = express.Router();

/**
 * GET /api/mcp-utils/taskmaster-server
 * Check if TaskMaster MCP server is configured
 */
router.get('/taskmaster-server', async (req, res) => {
    try {
        const result = await detectTaskMasterMCPServer();
        res.json(result);
    } catch (error) {
        console.error('TaskMaster MCP detection error:', error);
        res.status(500).json({
            error: 'Failed to detect TaskMaster MCP server',
            message: error.message
        });
    }
});

/**
 * GET /api/mcp-utils/all-servers
 * Get all configured MCP servers
 */
router.get('/all-servers', async (req, res) => {
    try {
        const result = await getAllMCPServers();
        res.json(result);
    } catch (error) {
        console.error('MCP servers detection error:', error);
        res.status(500).json({
            error: 'Failed to get MCP servers',
            message: error.message
        });
    }
});

export default router;
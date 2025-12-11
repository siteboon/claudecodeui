/**
 * SSH API Routes
 * Provides endpoints for SSH host discovery and configuration
 */

import express from 'express';
import { discoverSSHHosts, getSSHConfigPaths } from '../ssh-config-parser.js';

const router = express.Router();

/**
 * GET /api/ssh/hosts
 * Discover SSH hosts from ~/.ssh/config
 */
router.get('/hosts', (req, res) => {
    try {
        const hosts = discoverSSHHosts();
        const configPaths = getSSHConfigPaths();
        res.json({
            success: true,
            hosts,
            configPaths
        });
    } catch (error) {
        console.error('[SSH] Error discovering hosts:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/ssh/config
 * Get SSH config file paths and status
 */
router.get('/config', (req, res) => {
    try {
        const configPaths = getSSHConfigPaths();
        res.json({
            success: true,
            ...configPaths
        });
    } catch (error) {
        console.error('[SSH] Error getting config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;

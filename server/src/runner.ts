import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import fs from "fs";

import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { initializeDatabase } from '@/shared/database/init-db.js';
import { initializeWatcher } from '@/modules/sessions/sessions.watcher.js';
import { getConnectableHost } from '@/shared/utils/networkHosts.js';
import { logger } from '@/shared/utils/logger.js';
import { authRoutes } from '@/modules/auth/auth.routes.js';
import { userRoutes } from '@/modules/user/user.routes.js';
import { validateApiKey, authenticateToken } from '@/modules/auth/auth.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

const server = http.createServer(app);

const serverPortEnv = process.env.SERVER_PORT;
const SERVER_PORT = serverPortEnv ? Number.parseInt(serverPortEnv) : 3001;

if (Number.isNaN(SERVER_PORT)) {
    throw new Error(`Invalid SERVER_PORT value: ${serverPortEnv}`);
}
const HOST = process.env.HOST || '0.0.0.0';

const DISPLAY_HOST = getConnectableHost(HOST);
const VITE_PORT = process.env.VITE_PORT || 5173;

async function importRoute(relativePath: string): Promise<any> {
    const moduleUrl = new URL(relativePath, import.meta.url);
    const routeModule = await import(moduleUrl.href);
    return routeModule.default;
}

const [
    gitRoutes,
    mcpRoutes,
    cursorRoutes,
    taskmasterRoutes,
    mcpUtilsRoutes,
    commandsRoutes,
    settingsRoutes,
    apiKeysRoutes,
    credentialsRoutes,
    notificationPreferencesRoutes,
    pushSubRoutes,
    agentRoutes,
    projectsRoutes,
    cliAuthRoutes,
    codexRoutes,
    geminiRoutes,
    pluginsRoutes,
    messagesRoutes,
] = await Promise.all([
    importRoute('./modules/git/git.routes.js'),
    importRoute('./modules/mcp/mcp.routes.js'),
    importRoute('./modules/cursor/cursor.routes.js'),
    importRoute('./modules/taskmaster/taskmaster.routes.js'),
    importRoute('./modules/mcp-utils/mcp-utils.routes.js'),
    importRoute('./modules/commands/commands.routes.js'),
    importRoute('./modules/settings/settings.routes.js'),
    importRoute('./modules/api-keys/api-keys.routes.js'),
    importRoute('./modules/credentials/credentials.routes.js'),
    importRoute('./modules/notification-preferences/notification-preferences.routes.js'),
    importRoute('./modules/push-sub/push-sub.routes.js'),
    importRoute('./modules/agent/agent.routes.js'),
    importRoute('./modules/projects/projects.routes.js'),
    importRoute('./modules/cli-auth/cli-auth.routes.js'),
    importRoute('./modules/codex/codex.routes.js'),
    importRoute('./modules/gemini/gemini.routes.js'),
    importRoute('./modules/plugins/plugins.routes.js'),
    importRoute('./modules/messages/messages.routes.js'),
]);

// ---------- MIDDLEWARES ----------------
app.use(cors({ exposedHeaders: ['X-Refreshed-Token'] }));
app.use(express.json({
    limit: '50mb',
    type: (req) => {
        // Skip multipart/form-data requests (for file uploads like images)
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
            return false;
        }
        return contentType.includes('json');
    }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));


// Simple logging middleware to track all incoming requests
// TODO: REMOVE THIS LATER
app.use((req, res, next) => {
    // Only log API endpoints to avoid spamming the console with static file requests
    if (req.url.startsWith('/')) {
        console.log(`=============> [${new Date().toISOString()}] ${req.method} ${req.url}`);
    }
    next();
});


// Optional API key validation (if configured)
app.use('/api', validateApiKey);

// Authentication routes (public)
app.use('/api/auth', authRoutes);

// Projects API Routes (protected)
app.use('/api/projects', authenticateToken, projectsRoutes);

// Git API Routes (protected)
app.use('/api/git', authenticateToken, gitRoutes);

// MCP API Routes (protected)
app.use('/api/mcp', authenticateToken, mcpRoutes);

// Cursor API Routes (protected)
app.use('/api/cursor', authenticateToken, cursorRoutes);

// TaskMaster API Routes (protected)
app.use('/api/taskmaster', authenticateToken, taskmasterRoutes);

// MCP utilities
app.use('/api/mcp-utils', authenticateToken, mcpUtilsRoutes);

// Commands API Routes (protected)
app.use('/api/commands', authenticateToken, commandsRoutes);

// Settings API Routes (protected, legacy endpoint)
app.use('/api/settings', authenticateToken, settingsRoutes);

// Settings sub-modules API Routes (protected)
app.use('/api/api-keys', authenticateToken, apiKeysRoutes);
app.use('/api/credentials', authenticateToken, credentialsRoutes);
app.use('/api/notification-preferences', authenticateToken, notificationPreferencesRoutes);
app.use('/api/push-sub', authenticateToken, pushSubRoutes);

// CLI Authentication API Routes (protected)
app.use('/api/cli', authenticateToken, cliAuthRoutes);

// User API Routes (protected)
app.use('/api/user', authenticateToken, userRoutes);

// Codex API Routes (protected)
app.use('/api/codex', authenticateToken, codexRoutes);

// Gemini API Routes (protected)
app.use('/api/gemini', authenticateToken, geminiRoutes);

// Plugins API Routes (protected)
app.use('/api/plugins', authenticateToken, pluginsRoutes);

// Unified session messages route (protected)
app.use('/api/sessions', authenticateToken, messagesRoutes);

// Agent API Routes (uses API key authentication)
app.use('/api/agent', agentRoutes);

// This matches files found in the root public folder (like api-docs.html when we run `/api-docs.html`).
// If the file is found, it's automatically sent. If it is not, it passes it to the next route checker.
// This will run in production as well as development URLs.
app.use(express.static(path.join(__dirname, '../../public')));

// If the file is not in the public directory, it's checked if it exists in the root dist folder which was built from vite.
//  * Note: If the request is for `/` (i.e. homepage), `express.static` automatically maps the request to `/index.html`.
// This will fetch /index.html for `/` calls in production.
app.use(express.static(path.join(__dirname, '../../dist'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            // Prevent HTML caching to avoid service worker issues after builds
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else if (filePath.match(/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$/)) {
            // Vite injects a unique hash into the filenames of assets (e.g., main.a1b2c3d4.js). 
            // Since the filename changes every time the file's content changes, the browser can safely cache it forever
            // and it will know when the file changes and recache the changed content when it's necessary too.
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
}));

// Serve React app for all other routes (excluding static files)
// This will match routes like /sessions (UI navigation routes) in production builds
app.get('*', (req, res) => {
    // Skip requests for static assets (files with extensions)
    if (path.extname(req.path)) {
        return res.status(404).send('Not found');
    }

    // Only serve index.html for HTML routes, not for static assets
    // Static assets should already be handled by express.static middleware above
    const indexPath = path.join(__dirname, '../../dist/index.html');


    // Check if dist/index.html exists (production build available)
    if (fs.existsSync(indexPath)) {
        // Set no-cache headers for HTML to prevent service worker issues
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(indexPath);
    }
});



async function main() {
    try {
        await initializeDatabase();

        server.listen(SERVER_PORT, HOST, async () => {
            const appInstallPath = path.join(__dirname, '../..');
            const distIndexPath = path.join(__dirname, '../../dist/index.html');
            const hasProductionBuild = fs.existsSync(distIndexPath);

            if (hasProductionBuild) {
                logger.info(`To run in production mode, go to http://${DISPLAY_HOST}:${SERVER_PORT}`);
            }

            logger.info(`To run in development mode with hot-module replacement, go to http://${DISPLAY_HOST}:${VITE_PORT}`);
            logger.info('═'.repeat(63));
            logger.info('CloudCLI Server - Ready');
            logger.info('═'.repeat(63));
            logger.info(`Server URL: http://${DISPLAY_HOST}:${SERVER_PORT}`);
            logger.info(`Installed at: ${appInstallPath}`);
            logger.info('Run "cloudcli status" for full configuration details');

            await initializeWatcher();
        });

    } catch (error) {
        logger.error(`Failed to initialize database: ${error}`);
        process.exit(1);
    }
}

await main();

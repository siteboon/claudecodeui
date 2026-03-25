import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import fs from "fs";

import { initializeDatabase } from '@/shared/database/init-db.js';
import { initializeWatcher } from '@/modules/sessions/sessions.watcher.js';
import { getConnectableHost } from '@/shared/utils/networkHosts.js';


console.log("----------------Hello there, Refactored Runner!-------------------");

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


// This matches files found in the root public folder (like api-docs.html when we run `/api-docs.html`).
// If the file is found, it's automatically sent. If it is not, it passes it to the next route checker.
// This will run in production as well as development URLs.
app.use(express.static(path.join(__dirname, '../../public')));

// If the file is not in the public directory, it's checked if it exists in the root dist folder which was built from vite.
//  * Note: If the request is for `/` (i.e. homepage), `express.static` automatically maps the request to `/index.html`.
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
app.get('*', (req, res) => {
    // Skip requests for static assets (files with extensions)
    if (path.extname(req.path)) {
        return res.status(404).send('Not found');
    }
    
    // Only serve index.html for HTML routes, not for static assets
    // Static assets should already be handled by express.static middleware above
    const indexPath = path.join(__dirname, '../dist/index.html');

    // Check if dist/index.html exists (production build available)
    if (fs.existsSync(indexPath)) {
        // Set no-cache headers for HTML to prevent service worker issues
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(indexPath);
    } else {
        // In development, redirect to Vite dev server only if dist doesn't exist
        const redirectHost = getConnectableHost(req.hostname);
        res.redirect(`${req.protocol}://${redirectHost}:${VITE_PORT}`);
    }
});


async function main() {
    try {
        await initializeDatabase();

        server.listen(SERVER_PORT, HOST, async () => {
            console.log(`Server is running on http://${HOST}:${SERVER_PORT}`);

            await initializeWatcher();
        });

    } catch (error) {
        console.error("Failed to initialize database:", error);
        process.exit(1);
    }
}

await main();
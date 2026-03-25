import express from 'express';
import http from 'http';

import { userDb } from "@/shared/database/repositories/users.js";
import { initializeDatabase } from '@/shared/database/init-db.js';
import { initializeWatcher } from '@/modules/sessions/sessions.watcher.js';

console.log("----------------Hello there, Refactored Runner!-------------------");

const app = express();
const server = http.createServer(app);

const serverPortEnv = process.env.SERVER_PORT;
const SERVER_PORT = serverPortEnv ? Number.parseInt(serverPortEnv) : 3001;

if (Number.isNaN(SERVER_PORT)) {
    throw new Error(`Invalid SERVER_PORT value: ${serverPortEnv}`);
}
const HOST = process.env.HOST || '0.0.0.0';

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
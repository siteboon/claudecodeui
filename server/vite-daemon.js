#!/usr/bin/env node

import process from 'node:process';
import { createServer } from 'vite';

const DEFAULT_PORT = 5173;
const DEFAULT_HOST = '0.0.0.0';

function parseArgs(argv) {
    const parsed = {
        host: process.env.VITE_HOST || process.env.HOST || DEFAULT_HOST,
        port: Number(process.env.VITE_PORT || DEFAULT_PORT),
        strictPort: true,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--host') {
            parsed.host = argv[++i];
        } else if (arg.startsWith('--host=')) {
            parsed.host = arg.split('=')[1];
        } else if (arg === '--port' || arg === '-p') {
            parsed.port = Number(argv[++i]);
        } else if (arg.startsWith('--port=')) {
            parsed.port = Number(arg.split('=')[1]);
        } else if (arg === '--strictPort') {
            parsed.strictPort = true;
        } else if (arg === '--no-strictPort') {
            parsed.strictPort = false;
        } else if (arg === '--help' || arg === '-h') {
            console.log('Usage: node server/vite-daemon.js [--host 0.0.0.0] [--port 5173] [--strictPort]');
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65535) {
        throw new Error(`Invalid port "${parsed.port}". Expected an integer between 1 and 65535.`);
    }

    return parsed;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const server = await createServer({
        root: process.cwd(),
        server: {
            host: options.host,
            port: options.port,
            strictPort: options.strictPort,
        },
        clearScreen: false,
    });

    await server.listen();
    server.printUrls();

    const shutdown = async (signal) => {
        console.log(`[INFO] Frontend daemon received ${signal}, shutting down...`);
        await server.close();
        process.exit(0);
    };

    process.once('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
    process.once('SIGINT', () => {
        void shutdown('SIGINT');
    });
}

main().catch((error) => {
    const message = error?.stack || error?.message || String(error);
    console.error(`[ERROR] Frontend daemon failed to start: ${message}`);
    process.exit(1);
});

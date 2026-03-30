import chokidar from "chokidar";
import path from "path";
import os from "os";
import { promises as fsPromises } from "fs";
import { logger } from "@/shared/utils/logger.js";
import { processSessions } from "@/modules/sessions/sessions.service.js";
import { processClaudeSessionFile } from "@/modules/providers/claude/claude.session-processor.js";
import { processCodexSessionFile } from "@/modules/providers/codex/codex.session-processor.js";
import { processGeminiSessionFile } from "@/modules/providers/gemini/gemini.session-processor.js";
import { processCursorSessionFile } from "@/modules/providers/cursor/cursor.session-processor.js";
import { sessionsDb } from "@/shared/database/repositories/sessions.db.js";
import { LLMProvider } from "@/shared/types/app.js";

let projectsWatchers: any[] = [];

// File system watchers for provider project/session folders
const PROVIDER_WATCH_PATHS: { provider: LLMProvider; rootPath: string }[] = [
    {
        provider: "claude",
        rootPath: path.join(os.homedir(), ".claude", "projects"),
    },
    {
        provider: "cursor",
        rootPath: path.join(os.homedir(), ".cursor", "chats")
    },
    {
        provider: "codex",
        rootPath: path.join(os.homedir(), ".codex", "sessions"),
    },
    {
        provider: "gemini",
        rootPath: path.join(os.homedir(), ".gemini", "sessions"),
    },
    {
        provider: "gemini",
        rootPath: path.join(os.homedir(), ".gemini", "tmp"),
    },
];

const WATCHER_IGNORED_PATTERNS = [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/*.tmp",
    "**/*.swp",
    "**/.DS_Store",
];

type EventType = "add" | "change";

const onUpdate = async (
    eventType: EventType,
    filePath: string,
    provider: LLMProvider,
) => {
    try {
        console.log("[eventType] detected: ", eventType, " filePath: ", filePath, " provider: ", provider);

        switch (eventType) {
            case "add":
            case "change": {
                let sessionId: string | null = null;
                let workspacePath: string | null = null;
                let sessionName = `Untitled ${provider} Session`;

                switch (provider) {
                    case "claude": {
                        const result = await processClaudeSessionFile(filePath);
                        if (result) {
                            sessionId = result.sessionId;
                            workspacePath = result.workspacePath;
                            sessionName = result.sessionName || sessionName;
                        }
                        break;
                    }
                    case "codex": {
                        const result = await processCodexSessionFile(filePath);
                        if (result) {
                            sessionId = result.sessionId;
                            workspacePath = result.workspacePath;
                            sessionName = result.sessionName || sessionName;
                        }
                        break;
                    }
                    case "gemini": {
                        const result = await processGeminiSessionFile(filePath);
                        if (result) {
                            sessionId = result.sessionId;
                            workspacePath = result.workspacePath;
                            sessionName = result.sessionName || sessionName;
                        }
                        break;
                    }
                    case "cursor": {
                        const result = await processCursorSessionFile(filePath);
                        if (result) {
                            sessionId = result.sessionId;
                            workspacePath = result.workspacePath;
                            sessionName = result.sessionName || sessionName;
                        }
                        break;
                    }
                }

                if (sessionId && workspacePath) {
                    let createdAt: string | undefined;
                    let updatedAt: string | undefined;
                    try {
                        const stat = await fsPromises.stat(filePath);
                        createdAt = stat.birthtime.toISOString();
                        updatedAt = stat.mtime.toISOString();
                    } catch {
                        // Ignore stat failures and let DB defaults handle created_at/updated_at.
                    }

                    sessionsDb.createSession(
                        sessionId,
                        provider,
                        workspacePath,
                        sessionName,
                        createdAt,
                        updatedAt,
                    );
                }
                break;
            }
        }
    } catch (error: any) {
        logger.error(
            `[ERROR] Failed to handle ${provider} file change for ${filePath}:`,
            error,
        );
    }
};

// Setup file system watchers for Claude, Cursor, and Codex project/session folders
export async function initializeWatcher() {
    logger.info("Setting up project watchers for providers...");

    await processSessions();

    for (const { provider, rootPath } of PROVIDER_WATCH_PATHS) {
        try {
            // chokidar v4 emits ENOENT via the "error" event for missing roots and will not auto-recover.
            // Ensure provider folders exist before creating the watcher so watching stays active.
            await fsPromises.mkdir(rootPath, { recursive: true });

            logger.info(`Setting up watcher for ${provider} at: ${rootPath}`);

            const watcher = chokidar.watch(rootPath, {
                ignored: WATCHER_IGNORED_PATTERNS,
                persistent: true,
                ignoreInitial: true, // Don't fire events for existing files on startup
                followSymlinks: false,
                depth: 6, // Reasonable depth limit
                usePolling: true, // Use polling to fix Windows fs.watch buffering/batching issues. It now stops relying on the OS's native file-system events and instead manually checks the files for changes at a set interval. 
                interval: 2000, // Poll every 2000ms
                binaryInterval: 6000, // We set a high amount because checking large binary files for changes using polling is much more CPU-intensive than checking small text files.
                // Removed awaitWriteFinish to prevent delays when LLM streams to the file
                
            });

            // Set up event listeners
            watcher
                .on("add", (filePath) => onUpdate("add", filePath, provider))
                .on("change", (filePath) =>
                    onUpdate("change", filePath, provider),
                )
                .on("error", (error: any) => {
                    logger.error(`[ERROR] ${provider} watcher error: ${error.message}`);
                })
                .on("ready", () => { });

            projectsWatchers.push(watcher);
        } catch (error: any) {
            logger.error(
                `[ERROR] Failed to setup ${provider} watcher for ${rootPath}:`,
                error,
            );
        }
    }
}

import os from 'os';
import path from 'path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import readline from 'readline';
import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import crypto from 'node:crypto';
import { scanStateDb } from '@/shared/database/repositories/scan-state.db.js';

// ============================================================================
// 1. SHARED TYPES & UTILITIES
// ============================================================================
// By extracting file traversal and JSONL parsing, we remove 80% of the duplication.

type SessionData = {
    sessionId: string;
    workspacePath: string;
    sessionName?: string;
}

/**
 * Reads a JSONL file and builds a Map of Key -> Value.
 * Useful for index files like history.jsonl or session_index.jsonl.
 */
export async function buildLookupMap(filePath: string, keyField: string, valueField: string): Promise<Map<string, string>> {
    const lookup = new Map<string, string>();
    try {
        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        for await (const line of rl) {
            if (!line.trim()) continue;
            const data = JSON.parse(line);
            // We use the first occurrence. In history files, this is usually the start of the thread.
            if (data[keyField] && data[valueField] && !lookup.has(data[keyField])) {
                lookup.set(data[keyField], data[valueField]);
            }
        }
    } catch (e) { /* File might not exist yet */ }
    return lookup;
}

/**
 * Recursively walks a directory tree and returns a flat array of all files 
 * matching a specific extension (e.g., '.jsonl' or '.json').
 * It will only find the files created after
 */
async function findFilesRecursivelyCreatedAfterLastScan(
    dirPath: string,
    extension: string,
    fileList: string[] = []
): Promise<string[]> {
    try {
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                await findFilesRecursivelyCreatedAfterLastScan(fullPath, extension, fileList);
            } else if (entry.isFile() && entry.name.endsWith(extension)) {
                const lastScanDate = scanStateDb.getLastScannedAt();

                if (lastScanDate) {
                    // Check file CREATION time (birthtime) against our last scan time
                    const stats = await fsp.stat(fullPath);
                    if (stats.birthtime > lastScanDate) {
                        fileList.push(fullPath);
                        console.log("=====> full path is: ", fullPath)
                    }
                } else {
                    fileList.push(fullPath);
                }
            }
        }
    } catch (e) {
        // Fail silently for directories that don't exist or lack read permissions
    }
    return fileList;
}

/**
 * Reads a file line-by-line, parsing each line as JSON.
 * It passes the parsed JSON to a custom `extractorFn`. As soon as the extractor
 * successfully finds both a sessionId and workspacePath, it closes the file and returns.
 */
export async function extractFirstValidJsonlData(
    filePath: string,
    extractorFn: (parsedJson: any) => Partial<SessionData> | null | undefined
): Promise<SessionData | null> {
    try {
        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        for await (const line of rl) {
            if (!line.trim()) continue;
            const parsedData = JSON.parse(line);
            const extracted = extractorFn(parsedData);

            // If our custom extractor found what we need, return early
            if (extracted?.sessionId && extracted?.workspacePath) {
                rl.close();
                fileStream.close();
                return extracted as SessionData;
            }
        }
    } catch (e) {
        // Ignored errors
    }
    return null;
}
// ============================================================================
// 2. JSONL-BASED PROVIDERS (Claude & Codex)
// ============================================================================
// Now, these functions only need to define WHERE to look, and HOW to map the JSON.

// ----- Claude -----
export async function processClaudeSessionFile(file: string, nameMap?: Map<string, string>): Promise<SessionData | null> {
    if (!nameMap) {
        const base = path.join(os.homedir(), '.claude');
        nameMap = await buildLookupMap(path.join(base, 'history.jsonl'), 'sessionId', 'display');
    }

    // Claude puts cwd and sessionId directly on the root object
    return extractFirstValidJsonlData(file, (data) => ({
        workspacePath: data?.cwd,
        sessionId: data?.sessionId,
        sessionName: nameMap!.get(data?.sessionId) || 'Untitled Claude Session'
    }));
}

async function getClaudeSessions() {
    const base = path.join(os.homedir(), '.claude');
    // Pre-load names from history index
    const nameMap = await buildLookupMap(path.join(base, 'history.jsonl'), 'sessionId', 'display');

    const files = await findFilesRecursivelyCreatedAfterLastScan(path.join(base, 'projects'), '.jsonl');
    for (const file of files) {
        const result = await processClaudeSessionFile(file, nameMap);

        if (result) {
            sessionsDb.createSession(result.sessionId, 'claude', result.workspacePath, result.sessionName);
        }
    }
}

// ----- Codex -----
export async function processCodexSessionFile(file: string, nameMap?: Map<string, string>): Promise<SessionData | null> {
    if (!nameMap) {
        const base = path.join(os.homedir(), '.codex');
        nameMap = await buildLookupMap(path.join(base, 'session_index.jsonl'), 'id', 'thread_name');
    }

    // Codex nests the required data inside a `payload` object
    return extractFirstValidJsonlData(file, (data) => ({
        workspacePath: data?.payload?.cwd,
        sessionId: data?.payload?.id,
        sessionName: nameMap!.get(data?.payload?.id) || 'Untitled Codex Session'
    }));
}

async function getCodexSessions() {
    const base = path.join(os.homedir(), '.codex');
    // Use the thread_name attribute as requested
    const nameMap = await buildLookupMap(path.join(base, 'session_index.jsonl'), 'id', 'thread_name');

    const files = await findFilesRecursivelyCreatedAfterLastScan(path.join(base, 'sessions'), '.jsonl');

    for (const file of files) {
        const result = await processCodexSessionFile(file, nameMap);

        if (result) {
            sessionsDb.createSession(result.sessionId, 'codex', result.workspacePath, result.sessionName);
        }
    }
}
// ============================================================================
// 3. STANDARD JSON PROVIDERS (Gemini)
// ============================================================================

// ----- Gemini -----
export async function processGeminiSessionFile(file: string): Promise<SessionData | null> {
    try {
        // Gemini uses standard JSON (not JSONL), so we read the whole file at once

        const fileContent = await fsp.readFile(file, 'utf8');
        const data = JSON.parse(fileContent);
        if (data?.id && data?.projectPath) {
            return {
                sessionId: data.id,
                workspacePath: data.projectPath,
                sessionName: data.messages?.[0]?.content || 'New Gemini Chat'
            };
        }
    } catch (e) {
        // Ignore parsing error for gemini
    }
    return null;
}

async function getGeminiSessions() {
    const geminiPath = path.join(os.homedir(), '.gemini', 'sessions');
    const files = await findFilesRecursivelyCreatedAfterLastScan(geminiPath, '.json');

    for (const file of files) {
        const result = await processGeminiSessionFile(file);
        if (result) {
            sessionsDb.createSession(result.sessionId, 'gemini', result.workspacePath, result.sessionName);
        }
    }
}

// ============================================================================
// 4. COMPLEX CUSTOM PROVIDERS (Cursor)
// ============================================================================

// ----- Cursor -----
function md5(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex');
}

export async function extractWorkspacePathFromWorkerLog(filePath: string): Promise<string | null> {
    try {
        const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });

        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            const match = line.match(/workspacePath=(.*)$/);
            const firstMatch = match?.[1];

            if (firstMatch) {
                rl.close();
                fileStream.close();
                return firstMatch;
            }
        }
    } catch {
        // ignore errors
    }

    return null;
}

export async function processCursorSessionFile(file: string): Promise<SessionData | null> {
    const sessionId = path.basename(file, '.jsonl');
    const grandparentDir = path.dirname(path.dirname(file));
    const workerLogPath = path.join(grandparentDir, 'worker.log');
    const workspacePath = await extractWorkspacePathFromWorkerLog(workerLogPath);

    if (!workspacePath) return null;

    return extractFirstValidJsonlData(file, (lineJson) => {
        if (lineJson.role === 'user') {
            const rawText = lineJson.message?.content?.[0]?.text || '';
            // Strip <user_query> tags and trim
            const cleanName = rawText.replace(/<\/?user_query>/g, '').trim().split('\n');
            return { sessionId: sessionId as string, workspacePath, sessionName: cleanName[0] || "Untitled Cursor Session" };
        }
        return null;
    });
}

async function getCursorSessions() {
    try {
        const cursorBase = path.join(os.homedir(), '.cursor');
        const projectsDir = path.join(cursorBase, 'projects');
        const projectDirs = await fsp.readdir(projectsDir);
        const seenWorkspacePaths = new Set<string>();

        for (const projectDir of projectDirs) {
            const workerLogPath = path.join(projectsDir, projectDir, 'worker.log');
            const workspacePath = await extractWorkspacePathFromWorkerLog(workerLogPath);

            if (!workspacePath || seenWorkspacePaths.has(workspacePath)) continue;

            seenWorkspacePaths.add(workspacePath);
            const workspaceHash = md5(workspacePath);
            const chatsDir = path.join(cursorBase, 'chats', workspaceHash);

            const sessionFiles = await findFilesRecursivelyCreatedAfterLastScan(chatsDir, '.jsonl');

            for (const file of sessionFiles) {
                const result = await processCursorSessionFile(file);

                if (result) {
                    sessionsDb.createSession(result.sessionId, 'cursor', result.workspacePath, result.sessionName);
                }
            }
        }
    } catch (e) {
        // Base cursor directory or projects directory likely doesn't exist
    }
}


export async function getSessions() {

    // 1. Start the timer with a unique label
    console.time("🚀 Workspace sync total time");

    console.log("Starting workspace sync...");
    try {
        // Wrapping in Promise.all allows these to process concurrently, speeding up the boot time
        await Promise.allSettled([
            getClaudeSessions(),
            getCodexSessions(),
            getGeminiSessions(),
            getCursorSessions()
        ]);

        scanStateDb.updateLastScannedAt();
    } catch (error) {
        console.error("An error occurred during sync:", error);
    } finally {
        console.log("----------------------------------");
        // 2. Stop the timer using the exact same label
        // This will print: 🚀 Workspace sync total time: 123.456ms
        console.timeEnd("🚀 Workspace sync total time");
        console.log("Workspace synchronization complete.");
    }
}

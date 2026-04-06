import os from 'os';
import path from 'path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import readline from 'readline';
import crypto from 'node:crypto';
import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import { extractFirstValidJsonlData, findFilesRecursivelyCreatedAfterLastScan } from '@/modules/providers/shared/session-parser.utils.js';
import { SessionData } from '@/shared/types/session.js';

function md5(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex');
}

async function removeFileIfExists(filePath: string): Promise<boolean> {
    try {
        await fsp.unlink(filePath);
        return true;
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

async function removeDirectoryIfExists(directoryPath: string): Promise<boolean> {
    try {
        await fsp.rm(directoryPath, { recursive: true, force: false });
        return true;
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

async function listDirectoryEntriesSafe(directoryPath: string): Promise<import('node:fs').Dirent[]> {
    try {
        return await fsp.readdir(directoryPath, { withFileTypes: true });
    } catch {
        return [];
    }
}

async function findDirectoriesByName(rootPath: string, directoryName: string): Promise<string[]> {
    const matches: string[] = [];
    const stack = [rootPath];

    while (stack.length > 0) {
        const currentPath = stack.pop() as string;
        const entries = await listDirectoryEntriesSafe(currentPath);

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const fullPath = path.join(currentPath, entry.name);
            if (entry.name === directoryName) {
                matches.push(fullPath);
            }

            stack.push(fullPath);
        }
    }

    return matches;
}

async function findFilesByName(rootPath: string, fileName: string): Promise<string[]> {
    const matches: string[] = [];
    const stack = [rootPath];

    while (stack.length > 0) {
        const currentPath = stack.pop() as string;
        const entries = await listDirectoryEntriesSafe(currentPath);

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.isFile() && entry.name === fileName) {
                matches.push(fullPath);
            }
        }
    }

    return matches;
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

export async function processCursorSessions() {
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
                    let createdAt: string | undefined;
                    let updatedAt: string | undefined;
                    try {
                        const stat = await fsp.stat(file);
                        createdAt = stat.birthtime.toISOString();
                        updatedAt = stat.mtime.toISOString();
                    } catch {
                        // Ignore stat failures and let DB defaults handle created_at/updated_at.
                    }
                    sessionsDb.createSession(
                        result.sessionId,
                        'cursor',
                        result.workspacePath,
                        result.sessionName,
                        createdAt,
                        updatedAt,
                        file,
                    );
                }
            }
        }
    } catch (e) {
        // Base cursor directory or projects directory likely doesn't exist
    }
}

export async function deleteCursorSession(sessionId: string, workspacePath?: string): Promise<boolean> {
    const cursorChatsDir = path.join(os.homedir(), '.cursor', 'chats');
    let deleted = false;

    if (workspacePath) {
        const cwdId = md5(workspacePath);
        const candidateDir = path.join(cursorChatsDir, cwdId, sessionId);
        deleted = (await removeDirectoryIfExists(candidateDir)) || deleted;
    }

    const sessionDirs = await findDirectoriesByName(cursorChatsDir, sessionId);
    for (const directoryPath of sessionDirs) {
        deleted = (await removeDirectoryIfExists(directoryPath)) || deleted;
    }

    const jsonlFiles = await findFilesByName(cursorChatsDir, `${sessionId}.jsonl`);
    for (const filePath of jsonlFiles) {
        deleted = (await removeFileIfExists(filePath)) || deleted;
    }

    return deleted;
}

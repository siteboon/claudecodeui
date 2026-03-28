import os from 'os';
import path from 'path';
import fsp from 'node:fs/promises';
import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import { buildLookupMap, extractFirstValidJsonlData, findFilesRecursivelyCreatedAfterLastScan } from '@/modules/providers/shared/session-parser.utils.js';
import { SessionData } from '@/shared/types/session.js';

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

export async function processCodexSessions() {
    const base = path.join(os.homedir(), '.codex');
    // Use the thread_name attribute as requested
    const nameMap = await buildLookupMap(path.join(base, 'session_index.jsonl'), 'id', 'thread_name');

    const files = await findFilesRecursivelyCreatedAfterLastScan(path.join(base, 'sessions'), '.jsonl');

    for (const file of files) {
        const result = await processCodexSessionFile(file, nameMap);

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
                'codex',
                result.workspacePath,
                result.sessionName,
                createdAt,
                updatedAt,
            );
        }
    }
}

function buildCodexDatePathParts(createdAt: string): Array<{ year: string; month: string; day: string }> {
    const parsedDate = new Date(createdAt);
    if (Number.isNaN(parsedDate.getTime())) {
        return [];
    }

    const localDate = {
        year: String(parsedDate.getFullYear()),
        month: String(parsedDate.getMonth() + 1),
        day: String(parsedDate.getDate()),
    };

    const utcDate = {
        year: String(parsedDate.getUTCFullYear()),
        month: String(parsedDate.getUTCMonth() + 1),
        day: String(parsedDate.getUTCDate()),
    };

    if (
        localDate.year === utcDate.year &&
        localDate.month === utcDate.month &&
        localDate.day === utcDate.day
    ) {
        return [localDate];
    }

    return [localDate, utcDate];
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

async function listDirectoryEntriesSafe(directoryPath: string): Promise<import('node:fs').Dirent[]> {
    try {
        return await fsp.readdir(directoryPath, { withFileTypes: true });
    } catch {
        return [];
    }
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

export async function deleteCodexSession(sessionId: string, createdAt?: string): Promise<boolean> {
    const codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');
    const fileName = `${sessionId}.jsonl`;
    let deleted = false;

    if (createdAt) {
        const datePathParts = buildCodexDatePathParts(createdAt);
        for (const parts of datePathParts) {
            const candidateFilePath = path.join(
                codexSessionsDir,
                parts.year,
                parts.month,
                parts.day,
                fileName,
            );
            deleted = (await removeFileIfExists(candidateFilePath)) || deleted;
        }
    }

    if (!deleted) {
        const matches = await findFilesByName(codexSessionsDir, fileName);
        for (const filePath of matches) {
            deleted = (await removeFileIfExists(filePath)) || deleted;
        }
    }

    return deleted;
}

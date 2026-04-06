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
                file,
            );
        }
    }
}

function getPathNumberVariants(value: number): string[] {
    const unpadded = String(value);
    const padded = unpadded.padStart(2, '0');

    if (unpadded === padded) {
        return [unpadded];
    }

    return [unpadded, padded];
}

function buildCodexDatePathParts(createdAt: string): Array<{ year: string; month: string; day: string }> {
    const parsedDate = new Date(createdAt);
    if (Number.isNaN(parsedDate.getTime())) {
        return [];
    }

    const localDate = {
        year: String(parsedDate.getFullYear()),
        month: parsedDate.getMonth() + 1,
        day: parsedDate.getDate(),
    };

    const utcDate = {
        year: String(parsedDate.getUTCFullYear()),
        month: parsedDate.getUTCMonth() + 1,
        day: parsedDate.getUTCDate(),
    };

    const rawDateParts =
        localDate.year === utcDate.year &&
            localDate.month === utcDate.month &&
            localDate.day === utcDate.day
            ? [localDate]
            : [localDate, utcDate];

    const uniqueDateParts = new Map<string, { year: string; month: string; day: string }>();
    for (const datePart of rawDateParts) {
        const monthVariants = getPathNumberVariants(datePart.month);
        const dayVariants = getPathNumberVariants(datePart.day);

        for (const month of monthVariants) {
            for (const day of dayVariants) {
                uniqueDateParts.set(`${datePart.year}-${month}-${day}`, {
                    year: datePart.year,
                    month,
                    day,
                });
            }
        }
    }

    return [...uniqueDateParts.values()];
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

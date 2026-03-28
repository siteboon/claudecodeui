import os from 'os';
import path from 'path';
import fsp from 'node:fs/promises';
import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import { buildLookupMap, extractFirstValidJsonlData, findFilesRecursivelyCreatedAfterLastScan } from '@/modules/providers/shared/session-parser.utils.js';
import { SessionData } from '@/shared/types/session.js';

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

export async function processClaudeSessions() {
    const base = path.join(os.homedir(), '.claude');
    // Pre-load names from history index
    const nameMap = await buildLookupMap(path.join(base, 'history.jsonl'), 'sessionId', 'display');

    const files = await findFilesRecursivelyCreatedAfterLastScan(path.join(base, 'projects'), '.jsonl');
    for (const file of files) {
        const result = await processClaudeSessionFile(file, nameMap);

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
                'claude',
                result.workspacePath,
                result.sessionName,
                createdAt,
                updatedAt,
            );
        }
    }
}

function encodeClaudeProjectPath(projectPath: string): string {
    return projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
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

export async function deleteClaudeSession(sessionId: string, workspacePath?: string): Promise<boolean> {
    const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
    const fileName = `${sessionId}.jsonl`;
    let deleted = false;

    if (workspacePath) {
        const encodedPath = encodeClaudeProjectPath(workspacePath);
        const candidateFilePath = path.join(claudeProjectsDir, encodedPath, fileName);
        deleted = (await removeFileIfExists(candidateFilePath)) || deleted;
    }

    const matches = await findFilesByName(claudeProjectsDir, fileName);
    for (const filePath of matches) {
        deleted = (await removeFileIfExists(filePath)) || deleted;
    }

    return deleted;
}

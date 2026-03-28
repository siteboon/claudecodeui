import os from 'os';
import path from 'path';
import fsp from 'node:fs/promises';
import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import { findFilesRecursivelyCreatedAfterLastScan } from '@/modules/providers/shared/session-parser.utils.js';
import { SessionData } from '@/shared/types/session.js';

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

export async function processGeminiSessions() {
    const geminiPath = path.join(os.homedir(), '.gemini', 'sessions');
    const files = await findFilesRecursivelyCreatedAfterLastScan(geminiPath, '.json');

    for (const file of files) {
        const result = await processGeminiSessionFile(file);
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
                'gemini',
                result.workspacePath,
                result.sessionName,
                createdAt,
                updatedAt,
            );
        }
    }
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

export async function deleteGeminiSession(sessionId: string): Promise<boolean> {
    const geminiHome = path.join(os.homedir(), '.gemini');
    const geminiSessionsDir = path.join(geminiHome, 'sessions');
    const geminiTmpDir = path.join(geminiHome, 'tmp');
    let deleted = false;

    deleted = (await removeFileIfExists(path.join(geminiSessionsDir, `${sessionId}.json`))) || deleted;
    deleted = (await removeFileIfExists(path.join(geminiSessionsDir, `${sessionId}.jsonl`))) || deleted;

    const projectDirs = await listDirectoryEntriesSafe(geminiTmpDir);
    for (const projectDir of projectDirs) {
        if (!projectDir.isDirectory()) {
            continue;
        }

        const chatsDir = path.join(geminiTmpDir, projectDir.name, 'chats');
        const chatFiles = await listDirectoryEntriesSafe(chatsDir);

        for (const chatFile of chatFiles) {
            if (!chatFile.isFile() || !chatFile.name.endsWith('.json')) {
                continue;
            }

            const chatFilePath = path.join(chatsDir, chatFile.name);
            if (chatFile.name === `${sessionId}.json`) {
                deleted = (await removeFileIfExists(chatFilePath)) || deleted;
                continue;
            }

            try {
                const content = await fsp.readFile(chatFilePath, 'utf8');
                const parsed = JSON.parse(content);
                const parsedId = parsed?.sessionId || parsed?.id;
                if (parsedId === sessionId) {
                    deleted = (await removeFileIfExists(chatFilePath)) || deleted;
                }
            } catch {
                // Ignore unreadable/malformed session files.
            }
        }
    }

    return deleted;
}

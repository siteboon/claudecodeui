import os from 'os';
import path from 'path';
import fsp from 'node:fs/promises';
import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import { findFilesRecursivelyCreatedAfterLastScan } from '@/modules/providers/shared/session-parser.utils.js';
import { SessionData } from '@/shared/types/session.js';

export async function processGeminiSessionFile(file: string): Promise<SessionData | null> {
    try {
        const fileContent = await fsp.readFile(file, 'utf8');
        const data = JSON.parse(fileContent);

        // Check for new format: data.sessionId
        // Fallback for old format: data.id and data.projectPath
        if (data?.sessionId || (data?.id && data?.projectPath)) {
            let sessionId = data.sessionId || data.id;
            let workspacePath = data.projectPath || '';
            let sessionName = 'New Gemini Chat';

            // Extract workspacePath for new format
            if (data?.sessionId && file.includes(`${path.sep}chats${path.sep}`)) {
                const chatsDir = path.dirname(file);
                const workspaceDir = path.dirname(chatsDir);
                const projectRootFile = path.join(workspaceDir, '.project_root');
                
                try {
                    const rootContent = await fsp.readFile(projectRootFile, 'utf8');
                    if (rootContent) {
                        workspacePath = rootContent.trim();
                    }
                } catch (e) {
                    // Ignore if .project_root doesn't exist
                }
            }

            // Extract sessionName
            if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
                const firstMessage = data.messages[0];
                if (firstMessage?.content && Array.isArray(firstMessage.content) && firstMessage.content.length > 0) {
                    sessionName = firstMessage.content[0]?.text?.trim() || sessionName;
                } else if (firstMessage?.content && typeof firstMessage.content === 'string') {
                    sessionName = firstMessage.content.trim() || sessionName;
                }
            } else if (data.messages?.[0]?.content) {
                // old format fallback
                sessionName = data.messages[0].content;
            }

            // Clean up sessionName
            if (sessionName) {
                sessionName = sessionName.replace(/\n/g, ' ').trim().substring(0, 100);
            }

            return {
                sessionId,
                workspacePath,
                sessionName
            };
        }
    } catch (e) {
        // Ignore parsing error for gemini
    }
    return null;
}

export async function processGeminiSessions() {
    const geminiHome = path.join(os.homedir(), '.gemini');
    
    // Process old sessions directory
    const oldGeminiPath = path.join(geminiHome, 'sessions');
    const oldFiles = await findFilesRecursivelyCreatedAfterLastScan(oldGeminiPath, '.json');
    
    // Process new tmp/chats directories
    const tmpGeminiPath = path.join(geminiHome, 'tmp');
    const tmpFiles = await findFilesRecursivelyCreatedAfterLastScan(tmpGeminiPath, '.json');
    
    const files = [...oldFiles, ...tmpFiles];

    for (const file of files) {
        // For tmp files, only process those inside a 'chats' directory
        if (file.startsWith(tmpGeminiPath) && !file.includes(`${path.sep}chats${path.sep}`)) {
            continue;
        }

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

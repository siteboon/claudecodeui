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
            sessionsDb.createSession(result.sessionId, 'gemini', result.workspacePath, result.sessionName);
        }
    }
}

import os from 'os';
import path from 'path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import readline from 'readline';
import crypto from 'node:crypto';
import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import { extractFirstValidJsonlData, findFilesRecursivelyCreatedAfterLastScan, SessionData } from '@/modules/sessions/sessions.utils.js';

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

export async function getCursorSessions() {
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

import os from 'os';
import path from 'path';
import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import { buildLookupMap, extractFirstValidJsonlData, findFilesRecursivelyCreatedAfterLastScan, SessionData } from '@/modules/sessions/sessions.utils.js';

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

export async function getCodexSessions() {
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

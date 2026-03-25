import os from 'os';
import path from 'path';
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
            sessionsDb.createSession(result.sessionId, 'claude', result.workspacePath, result.sessionName);
        }
    }
}

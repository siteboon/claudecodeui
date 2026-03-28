import { scanStateDb } from '@/shared/database/repositories/scan-state.db.js';
import { sessionsDb } from '@/shared/database/repositories/sessions.db.js';
import { processClaudeSessions, deleteClaudeSession } from '@/modules/providers/claude/claude.session-processor.js';
import { processCodexSessions, deleteCodexSession } from '@/modules/providers/codex/codex.session-processor.js';
import { processGeminiSessions, deleteGeminiSession } from '@/modules/providers/gemini/gemini.session-processor.js';
import { processCursorSessions, deleteCursorSession } from '@/modules/providers/cursor/cursor.session-processor.js';

const SESSION_ID_PATTERN = /^[a-zA-Z0-9._-]{1,120}$/;

function sanitizeSessionId(sessionId: string): string {
    const value = String(sessionId || '').trim();
    if (!SESSION_ID_PATTERN.test(value)) {
        throw new Error('Invalid session ID format');
    }
    return value;
}

export async function processSessions() {

    // 1. Start the timer with a unique label
    console.time('Workspace sync total time');

    console.log('Starting workspace sync...');
    try {
        // Wrapping in Promise.all allows these to process concurrently, speeding up the boot time
        await Promise.allSettled([
            processClaudeSessions(),
            processCodexSessions(),
            processGeminiSessions(),
            processCursorSessions()
        ]);

        scanStateDb.updateLastScannedAt();
    } catch (error) {
        console.error('An error occurred during sync:', error);
    } finally {
        console.log('----------------------------------');
        // 2. Stop the timer using the exact same label
        // This will print: Workspace sync total time: 123.456ms
        console.timeEnd('Workspace sync total time');
        console.log('Workspace synchronization complete.');
    }
}

export async function deleteSession(sessionId: string): Promise<void> {
    const safeSessionId = sanitizeSessionId(sessionId);
    const existingSession = sessionsDb.getSessionById(safeSessionId);
    const workspacePath = existingSession?.workspace_path;
    const createdAt = existingSession?.created_at;

    const deletionResults = await Promise.allSettled([
        deleteClaudeSession(safeSessionId, workspacePath),
        deleteCodexSession(safeSessionId, createdAt),
        deleteGeminiSession(safeSessionId),
        deleteCursorSession(safeSessionId, workspacePath),
    ]);

    const rejectedResult = deletionResults.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
    if (rejectedResult) {
        throw rejectedResult.reason;
    }

    sessionsDb.deleteSession(safeSessionId);
}

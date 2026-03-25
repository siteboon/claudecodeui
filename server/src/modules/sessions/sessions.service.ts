import { scanStateDb } from '@/shared/database/repositories/scan-state.db.js';
import { getClaudeSessions } from '@/modules/providers/claude/claude.session-parser.js';
import { getCodexSessions } from '@/modules/providers/codex/codex.session-parser.js';
import { getGeminiSessions } from '@/modules/providers/gemini/gemini.session-parser.js';
import { getCursorSessions } from '@/modules/providers/cursor/cursor.session-parser.js';

export async function getSessions() {

    // 1. Start the timer with a unique label
    console.time("🚀 Workspace sync total time");

    console.log("Starting workspace sync...");
    try {
        // Wrapping in Promise.all allows these to process concurrently, speeding up the boot time
        await Promise.allSettled([
            getClaudeSessions(),
            getCodexSessions(),
            getGeminiSessions(),
            getCursorSessions()
        ]);

        scanStateDb.updateLastScannedAt();
    } catch (error) {
        console.error("An error occurred during sync:", error);
    } finally {
        console.log("----------------------------------");
        // 2. Stop the timer using the exact same label
        // This will print: 🚀 Workspace sync total time: 123.456ms
        console.timeEnd("🚀 Workspace sync total time");
        console.log("Workspace synchronization complete.");
    }
}

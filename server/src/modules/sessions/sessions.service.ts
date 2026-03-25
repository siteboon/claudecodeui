import { scanStateDb } from '@/shared/database/repositories/scan-state.db.js';
import { processClaudeSessions } from '@/modules/providers/claude/claude.session-parser.js';
import { processCodexSessions } from '@/modules/providers/codex/codex.session-parser.js';
import { processGeminiSessions } from '@/modules/providers/gemini/gemini.session-parser.js';
import { processCursorSessions } from '@/modules/providers/cursor/cursor.session-parser.js';

export async function processSessions() {

    // 1. Start the timer with a unique label
    console.time("🚀 Workspace sync total time");

    console.log("Starting workspace sync...");
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
        console.error("An error occurred during sync:", error);
    } finally {
        console.log("----------------------------------");
        // 2. Stop the timer using the exact same label
        // This will print: 🚀 Workspace sync total time: 123.456ms
        console.timeEnd("🚀 Workspace sync total time");
        console.log("Workspace synchronization complete.");
    }
}

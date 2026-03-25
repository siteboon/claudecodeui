import fs from 'node:fs';
import fsp from 'node:fs/promises';
import readline from 'readline';
import path from 'path';
import { scanStateDb } from '@/shared/database/repositories/scan-state.db.js';

// ============================================================================
// SHARED TYPES & UTILITIES
// ============================================================================

export type SessionData = {
    sessionId: string;
    workspacePath: string;
    sessionName?: string;
}

/**
 * Reads a JSONL file and builds a Map of Key -> Value.
 * Useful for index files like history.jsonl or session_index.jsonl.
 */
export async function buildLookupMap(filePath: string, keyField: string, valueField: string): Promise<Map<string, string>> {
    const lookup = new Map<string, string>();
    try {
        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        for await (const line of rl) {
            if (!line.trim()) continue;
            const data = JSON.parse(line);
            // We use the first occurrence. In history files, this is usually the start of the thread.
            if (data[keyField] && data[valueField] && !lookup.has(data[keyField])) {
                lookup.set(data[keyField], data[valueField]);
            }
        }
    } catch (e) { /* File might not exist yet */ }
    return lookup;
}

/**
 * Recursively walks a directory tree and returns a flat array of all files 
 * matching a specific extension (e.g., '.jsonl' or '.json').
 * It will only find the files created after the last scan date.
 */
export async function findFilesRecursivelyCreatedAfterLastScan(
    dirPath: string,
    extension: string,
    fileList: string[] = []
): Promise<string[]> {
    try {
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                await findFilesRecursivelyCreatedAfterLastScan(fullPath, extension, fileList);
            } else if (entry.isFile() && entry.name.endsWith(extension)) {
                const lastScanDate = scanStateDb.getLastScannedAt();

                if (lastScanDate) {
                    // Check file CREATION time (birthtime) against our last scan time
                    const stats = await fsp.stat(fullPath);
                    if (stats.birthtime > lastScanDate) {
                        fileList.push(fullPath);
                    }
                } else {
                    fileList.push(fullPath);
                }
            }
        }
    } catch (e) {
        // Fail silently for directories that don't exist or lack read permissions
    }
    return fileList;
}

/**
 * Reads a file line-by-line, parsing each line as JSON.
 * It passes the parsed JSON to a custom `extractorFn`. As soon as the extractor
 * successfully finds both a sessionId and workspacePath, it closes the file and returns.
 */
export async function extractFirstValidJsonlData(
    filePath: string,
    extractorFn: (parsedJson: any) => Partial<SessionData> | null | undefined
): Promise<SessionData | null> {
    try {
        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        for await (const line of rl) {
            if (!line.trim()) continue;
            const parsedData = JSON.parse(line);
            const extracted = extractorFn(parsedData);

            // If our custom extractor found what we need, return early
            if (extracted?.sessionId && extracted?.workspacePath) {
                rl.close();
                fileStream.close();
                return extracted as SessionData;
            }
        }
    } catch (e) {
        // Ignored errors
    }
    return null;
}

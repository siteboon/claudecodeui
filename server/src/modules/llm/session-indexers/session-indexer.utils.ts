import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
/**
 * Keeps extracted session names compact and UI-safe.
 */
export function normalizeSessionName(rawValue: string | undefined, fallback: string): string {
  const normalized = (rawValue ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, 120);
}

/**
 * Returns directory entries or an empty array when the directory does not exist.
 */
export async function listDirectoryEntriesSafe(
  directoryPath: string,
): Promise<import('node:fs').Dirent[]> {
  try {
    return await fsp.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Builds a lookup map from a JSONL index file by extracting a key/value pair per row.
 * The first occurrence of a key wins so we preserve earliest metadata.
 */
export async function buildLookupMap(
  filePath: string,
  keyField: string,
  valueField: string,
): Promise<Map<string, string>> {
  const lookup = new Map<string, string>();

  try {
    const fileStream = fs.createReadStream(filePath);
    const lineReader = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of lineReader) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const key = parsed[keyField];
      const value = parsed[valueField];

      if (typeof key === 'string' && typeof value === 'string' && !lookup.has(key)) {
        lookup.set(key, value);
      }
    }
  } catch {
    // Missing index files are normal for users who have not used a provider yet.
  }

  return lookup;
}

/**
 * Recursively scans for files with a given extension and optionally filters
 * them to only files created after `lastScanAt`.
 */
export async function findFilesRecursivelyCreatedAfter(
  rootDir: string,
  extension: string,
  lastScanAt: Date | null,
  fileList: string[] = [],
): Promise<string[]> {
  try {
    console.log("HEY THERE!")
    const entries = await fsp.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);

      if (entry.isDirectory()) {
        await findFilesRecursivelyCreatedAfter(fullPath, extension, lastScanAt, fileList);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(extension)) {
        continue;
      }

      if (!lastScanAt) {
        fileList.push(fullPath);
        continue;
      }

      const stats = await fsp.stat(fullPath);
      if (stats.birthtime > lastScanAt) {
        fileList.push(fullPath);
      }
    }
  } catch {
    // Missing provider directories should not fail the full sync.
  }

  return fileList;
}

/**
 * Reads JSONL rows until the extractor yields a valid session identity.
 */
export async function extractFirstValidJsonlData<T>(
  filePath: string,
  extractor: (parsedJson: unknown) => T | null | undefined,
): Promise<T | null> {
  try {
    const fileStream = fs.createReadStream(filePath);
    const lineReader = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of lineReader) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const parsed = JSON.parse(trimmed);
      const extracted = extractor(parsed);
      if (extracted) {
        lineReader.close();
        fileStream.close();
        return extracted;
      }
    }
  } catch {
    // Ignore malformed session files and continue scanning.
  }

  return null;
}

/**
 * Reads filesystem timestamps for DB metadata fields.
 */
export async function readFileTimestamps(
  filePath: string,
): Promise<{ createdAt?: string; updatedAt?: string }> {
  try {
    const stat = await fsp.stat(filePath);
    return {
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
    };
  } catch {
    return {};
  }
}

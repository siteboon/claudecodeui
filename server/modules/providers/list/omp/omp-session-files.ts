import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// id → path, because a scan readdirs EVERY project slug and both callers need the
// path repeatedly: a turn resolves it twice (token usage, then the staleness
// fingerprint) and history resolves it per read. The filename embeds the id and
// omp never moves the file, so the mapping is permanent; one stat re-validates it
// in case the file was deleted.
const sessionFileByIdCache = new Map<string, string>();

/**
 * Locates a session's jsonl transcript by its exact native omp session id.
 *
 * Files are named `<ISO-ts>_<id>.jsonl`, so the id is the last `_`-delimited
 * segment of the basename — matched exactly, because `endsWith` would also match
 * a longer id that happens to end with this one.
 *
 * Consumed by the omp runtime provider (token usage and the staleness
 * fingerprint) and the omp sessions provider (history reads); it lives here so
 * those two cannot drift apart.
 */
export async function locateOmpSessionFile(sessionId: string): Promise<string | null> {
  const cached = sessionFileByIdCache.get(sessionId);
  if (cached) {
    try {
      await fsp.stat(cached);
      return cached;
    } catch {
      sessionFileByIdCache.delete(sessionId);
    }
  }

  const root = path.join(os.homedir(), '.omp', 'agent', 'sessions');
  let slugs: string[];
  try {
    slugs = await fsp.readdir(root);
  } catch {
    return null;
  }

  for (const slug of slugs) {
    const files = await fsp.readdir(path.join(root, slug)).catch(() => []);
    const match = files.find((file) => file.endsWith('.jsonl') && file.slice(0, -6).split('_').pop() === sessionId);
    if (match) {
      const found = path.join(root, slug, match);
      sessionFileByIdCache.set(sessionId, found);
      return found;
    }
  }

  return null;
}

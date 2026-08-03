import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import {
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  normalizeProviderTimestamp,
} from '@/shared/utils.js';

import { PiPaths } from './pi-paths.provider.js';
import { PiSessionStore } from './pi-session-store.provider.js';

const FALLBACK_SESSION_NAME = 'Untitled Pi Session';

/**
 * Session indexer for Pi transcript artifacts.
 *
 * Scans the resolved Pi session root(s) for `.jsonl` files, parses each into an
 * immutable snapshot, and upserts its metadata into the shared sessions table.
 * A single unreadable/corrupt file is logged and skipped so one bad artifact
 * never aborts the rest of the scan.
 */
export class PiSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'pi' as const;
  private readonly paths = new PiPaths();

  /**
   * Scans every Pi session root and upserts discovered sessions into DB.
   */
  async synchronize(since?: Date): Promise<number> {
    let processed = 0;
    for (const root of this.paths.getSessionRoots()) {
      const files = await findFilesRecursivelyCreatedAfter(root, '.jsonl', since ?? null);
      for (const filePath of files) {
        try {
          const sessionId = this.indexFile(filePath);
          if (sessionId) {
            processed += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn('[PiProvider] Failed to synchronize session file:', filePath, message);
        }
      }
    }

    return processed;
  }

  /**
   * Parses and upserts one Pi session JSONL file.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }

    try {
      return this.indexFile(filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[PiProvider] Failed to synchronize session file:', filePath, message);
      return null;
    }
  }

  /**
   * Parses a snapshot and upserts its metadata. Returns the stored session id.
   */
  private indexFile(filePath: string): string | null {
    const snapshot = PiSessionStore.load(filePath);
    const sessionId = snapshot.header.id;
    const projectPath = snapshot.header.cwd;
    if (!sessionId || !projectPath) {
      return null;
    }

    const existingName = (
      sessionsDb.getSessionByProviderSessionId(sessionId) ?? sessionsDb.getSessionById(sessionId)
    )?.custom_name;
    const nextName = existingName && existingName !== FALLBACK_SESSION_NAME ? existingName : undefined;

    const storedId = sessionsDb.createSession(
      sessionId,
      this.provider,
      projectPath,
      normalizeSessionName(nextName, FALLBACK_SESSION_NAME),
      normalizeProviderTimestamp(snapshot.header.timestamp),
      normalizeProviderTimestamp(snapshot.header.timestamp),
      filePath,
    );

    if (snapshot.currentModel) {
      sessionsDb.setSessionModel(
        storedId,
        `${snapshot.currentModel.provider}/${snapshot.currentModel.modelId}`,
      );
    }

    return storedId;
  }
}

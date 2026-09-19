import fsSync from 'node:fs';

import Database from 'better-sqlite3';

import type { IProviderFork } from '@/shared/interfaces.js';
import { AppError, getOpenCodeDatabasePath } from '@/shared/utils.js';
import { openCodeServer } from '@/modules/providers/list/opencode/opencode-server.client.js';

/**
 * Branches an OpenCode conversation into an independent session.
 *
 * The copy is performed by `opencode serve`'s own fork endpoint (see
 * opencode-server.client.ts for why this app does not touch opencode.db
 * itself). The endpoint cuts EXCLUSively at the message it names, which is
 * exactly what this contract's anchor asks for — everything before the
 * anchored message, without it — so the anchor goes straight through as the
 * cut point.
 */
export class OpenCodeForkProvider implements IProviderFork {
  readonly transcriptIsSharedDatabase = true;

  async forkSession(input: {
    providerSessionId: string;
    jsonlPath: string | null;
    projectPath: string;
    upToAnchorId?: string;
    title?: string;
  }): Promise<{ providerSessionId: string; jsonlPath: string | null }> {
    // `title` is deliberately not forwarded. The sidebar name lives in this
    // app's own session row, and OpenCode names the copy itself ("... (fork
    // #1)"), which a later rename of the app row already overrides.
    if (input.upToAnchorId) {
      await this.assertAnchorIsNotFirst(input.providerSessionId, input.upToAnchorId);
    }

    const forked = await openCodeServer.forkSession({
      sessionId: input.providerSessionId,
      ...(input.upToAnchorId ? { cutBeforeMessageId: input.upToAnchorId } : {}),
      ...(input.projectPath ? { directory: input.projectPath } : {}),
    });

    // No path: the copy is rows in the shared opencode.db, and naming no file
    // is what keeps deleting this app row from deleting everybody's database.
    return { providerSessionId: forked.sessionId, jsonlPath: null };
  }

  /**
   * Rejects the two anchors the exclusive endpoint cannot honour.
   *
   * The endpoint answers an unknown messageID by copying everything, so a
   * stale anchor (the UI was open across a rollback) would silently fork the
   * whole conversation instead of the prefix the user asked for — it is
   * reported instead. An anchor that is the session's first message leaves
   * nothing to keep before it, and the endpoint's no-cut behaviour (copy
   * everything) is the exact opposite of what that fork means.
   *
   * Checking against opencode.db with the same ORDER BY fetchHistory uses
   * guarantees "first" means first in what the user actually sees.
   */
  private async assertAnchorIsNotFirst(providerSessionId: string, anchorId: string): Promise<void> {
    const dbPath = getOpenCodeDatabasePath();
    if (!fsSync.existsSync(dbPath)) {
      throw new AppError('OpenCode has no session database, so this fork cannot be cut.', {
        code: 'FORK_FAILED',
        statusCode: 502,
      });
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare(`
        SELECT id FROM message
        WHERE session_id = ?
        ORDER BY COALESCE(time_created, 0), id
      `).all(providerSessionId) as { id: string }[];

      const anchorIndex = rows.findIndex((row) => row.id === anchorId);
      if (anchorIndex < 0) {
        throw new AppError('The message to fork from is no longer in this OpenCode session.', {
          code: 'FORK_ANCHOR_NOT_FOUND',
          statusCode: 409,
        });
      }
      if (anchorIndex === 0) {
        throw new AppError('Forking from the first message would copy nothing. Fork the whole session instead.', {
          code: 'FORK_NOTHING_TO_COPY',
          statusCode: 409,
        });
      }
    } finally {
      db.close();
    }
  }
}

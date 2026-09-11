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
 * itself). The endpoint cuts EXCLUSively at the message it names, while this
 * contract's `upToAnchorId` means "keep this message and its answer", so the
 * anchor is translated here into "the id to cut before" — the message
 * following the anchored one in the same order fetchHistory reads them.
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
    const cutBeforeMessageId = input.upToAnchorId
      ? await this.resolveCutPoint(input.providerSessionId, input.upToAnchorId)
      : undefined;

    const forked = await openCodeServer.forkSession({
      sessionId: input.providerSessionId,
      ...(cutBeforeMessageId ? { cutBeforeMessageId } : {}),
      ...(input.projectPath ? { directory: input.projectPath } : {}),
    });

    // No path: the copy is rows in the shared opencode.db, and naming no file
    // is what keeps deleting this app row from deleting everybody's database.
    return { providerSessionId: forked.sessionId, jsonlPath: null };
  }

  /**
   * Turns "keep up to and including this message" into the endpoint's
   * "everything before this message".
   *
   * Reading the order straight from opencode.db with the same ORDER BY
   * fetchHistory uses guarantees the cut point is the row the user would see
   * next. When the anchor is the very last message there is nothing to cut
   * before, which is exactly a whole-session copy — reported as undefined so
   * the endpoint is asked without a messageID at all.
   */
  private async resolveCutPoint(providerSessionId: string, anchorId: string): Promise<string | undefined> {
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

      return rows[anchorIndex + 1]?.id;
    } finally {
      db.close();
    }
  }
}

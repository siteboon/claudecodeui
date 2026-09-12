import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import * as readline from 'node:readline';
import path from 'node:path';

import { forkSession as forkClaudeSession } from '@anthropic-ai/claude-agent-sdk';

import type { IProviderFork } from '@/shared/interfaces.js';
import { AppError } from '@/shared/utils.js';

/**
 * Branches a Claude conversation by copying its transcript into a new session
 * file.
 *
 * The SDK owns this: it remaps every message uuid and rewrites the parentUuid
 * chain, which is what makes the copy resumable rather than just a duplicate
 * file. `upToMessageId` is inclusive of the row it names, while the fork
 * contract's anchor must NOT be kept — so the adapter hands the SDK the
 * anchor row's `parentUuid`, which cuts exactly above the message the user
 * forked from.
 */
export class ClaudeForkProvider implements IProviderFork {
  async forkSession(input: {
    providerSessionId: string;
    jsonlPath: string;
    projectPath: string;
    upToAnchorId?: string;
    title?: string;
  }): Promise<{ providerSessionId: string; jsonlPath: string }> {
    const upToMessageId = input.upToAnchorId
      ? await this.resolveParentOf(input.jsonlPath, input.upToAnchorId)
      : undefined;

    // `dir` is the session's working directory, which the SDK encodes into the
    // `~/.claude/projects/<encoded>` folder name itself — passing that folder
    // makes it encode an already-encoded path and find nothing.
    const { sessionId } = await forkClaudeSession(input.providerSessionId, {
      dir: input.projectPath,
      ...(upToMessageId ? { upToMessageId } : {}),
      title: input.title,
    });

    if (!sessionId) {
      throw new AppError('Claude did not return a session id for the fork.', {
        code: 'FORK_FAILED',
        statusCode: 502,
      });
    }

    // Confirmed rather than assumed: the caller is about to write a database
    // row claiming this file exists, and a half-created row would show up in
    // the sidebar as a session that can never be opened.
    // The fork lands beside the transcript it was copied from.
    const forkedPath = path.join(path.dirname(input.jsonlPath), `${sessionId}.jsonl`);
    try {
      await stat(forkedPath);
    } catch {
      throw new AppError('Claude reported a fork but wrote no transcript for it.', {
        code: 'FORK_FAILED',
        statusCode: 502,
      });
    }

    return { providerSessionId: sessionId, jsonlPath: forkedPath };
  }

  /**
   * The row before the anchored one, which is what an inclusive cut keeps:
   * everything up to the anchored message, without it.
   *
   * Scanning the transcript rather than asking the SDK to resolve the anchor
   * is what surfaces the two failures the fork contract promises: an anchor
   * that rolled out of the file (stale UI) and an anchor that is the first
   * row, where the copy would be empty.
   */
  private async resolveParentOf(jsonlPath: string, anchorId: string): Promise<string> {
    const stream = createReadStream(jsonlPath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let found = false;
    let parentUuid: string | null = null;
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        let entry: { uuid?: unknown; parentUuid?: unknown };
        try {
          entry = JSON.parse(line) as { uuid?: unknown; parentUuid?: unknown };
        } catch {
          continue;
        }
        if (entry?.uuid === anchorId) {
          found = true;
          parentUuid = typeof entry.parentUuid === 'string' && entry.parentUuid ? entry.parentUuid : null;
          break;
        }
      }
    } finally {
      lines.close();
      stream.destroy();
    }

    if (!found) {
      throw new AppError('The message to fork from is no longer in this Claude session.', {
        code: 'FORK_ANCHOR_NOT_FOUND',
        statusCode: 409,
      });
    }
    if (!parentUuid) {
      throw new AppError('Forking from the first message would copy nothing. Fork the whole session instead.', {
        code: 'FORK_NOTHING_TO_COPY',
        statusCode: 409,
      });
    }
    return parentUuid;
  }
}

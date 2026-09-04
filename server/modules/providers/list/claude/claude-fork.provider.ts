import { stat } from 'node:fs/promises';
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
 * file. `upToMessageId` is inclusive of the row it names.
 */
export class ClaudeForkProvider implements IProviderFork {
  async forkSession(input: {
    providerSessionId: string;
    jsonlPath: string;
    projectPath: string;
    upToAnchorId?: string;
    title?: string;
  }): Promise<{ providerSessionId: string; jsonlPath: string }> {
    // `dir` is the session's working directory, which the SDK encodes into the
    // `~/.claude/projects/<encoded>` folder name itself — passing that folder
    // makes it encode an already-encoded path and find nothing.
    const { sessionId } = await forkClaudeSession(input.providerSessionId, {
      dir: input.projectPath,
      upToMessageId: input.upToAnchorId,
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
}

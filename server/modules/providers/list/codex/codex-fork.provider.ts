import { codexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';
import type { IProviderFork } from '@/shared/interfaces.js';
import { AppError } from '@/shared/utils.js';

import { readCodexLiveTurnIds } from './codex-sessions.provider.js';

/**
 * Branches a Codex conversation into an independent thread.
 *
 * `thread/fork` writes a real rollout with its own thread id and a
 * `forked_from_id` back-reference, which is what makes the copy resumable
 * rather than an inert duplicate of the file.
 *
 * The contract's anchor is the turn a user message belongs to, and the fork
 * must NOT include it — the whole point of forking from a message is to retake
 * that turn differently. `thread/fork`'s `lastTurnId` is inclusive of the turn
 * it names and cuts by turn (a turn is written as one thing; there is no cut
 * between a prompt and its answer), so the adapter asks for the turn BEFORE the
 * anchored one. Forking from the first message then has nothing to keep, which
 * is reported rather than silently copying the whole conversation.
 */
export class CodexForkProvider implements IProviderFork {
  async forkSession(input: {
    providerSessionId: string;
    jsonlPath: string | null;
    projectPath: string;
    upToAnchorId?: string;
    title?: string;
  }): Promise<{ providerSessionId: string; jsonlPath: string }> {
    // `title` is deliberately not forwarded. The sidebar name lives in this
    // app's own session row, and naming the thread inside Codex would mean a
    // second call that could fail after the fork already succeeded.
    const lastTurnId = input.upToAnchorId
      ? await this.resolveLastTurnToKeep(input.jsonlPath, input.upToAnchorId)
      : undefined;

    const fork = await codexAppServer.forkThread({
      threadId: input.providerSessionId,
      ...(lastTurnId ? { lastTurnId } : {}),
      cwd: input.projectPath,
    });

    // The path is the one the server reported and already confirmed on disk,
    // not one derived from the source: a fork lands in today's date directory
    // rather than beside the transcript it was copied from.
    return { providerSessionId: fork.threadId, jsonlPath: fork.path };
  }

  /**
   * The turn before the anchored one, which is what an inclusive cut keeps:
   * everything up to the anchored turn, without it.
   */
  private async resolveLastTurnToKeep(jsonlPath: string | null, anchorTurnId: string): Promise<string | undefined> {
    if (!jsonlPath) {
      throw new AppError('This Codex session has no transcript to fork from.', {
        code: 'FORK_FAILED',
        statusCode: 502,
      });
    }

    // The same live-turn pass the edit anchor uses: rolled-back turns are not
    // part of the thread and the fork endpoint would refuse to cut at one,
    // so an anchor among them is simply not found.
    const liveTurnIds = await readCodexLiveTurnIds(jsonlPath);
    const anchorIndex = liveTurnIds.indexOf(anchorTurnId);
    if (anchorIndex < 0) {
      throw new AppError('The message to fork from is no longer in this Codex session.', {
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

    // The turn before it, or nothing at all when the anchored turn is the
    // only live one and there is an empty-prefix case the endpoint would
    // reject — anchorIndex === 0 already covers that.
    return liveTurnIds[anchorIndex - 1];
  }
}

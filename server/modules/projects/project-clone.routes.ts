import express, { type Request } from 'express';

import type { PendingCloneRequests } from '@/modules/projects/services/project-clone-request.service.js';
import type { startCloneProject } from '@/modules/projects/services/project-clone.service.js';
import { AppError, asyncHandler } from '@/shared/utils.js';

type ProjectCloneRouterDependencies = {
  startCloneProject: typeof startCloneProject;
  pendingCloneRequests: PendingCloneRequests;
};

type AuthenticatedUser = {
  id?: number | string;
};

function requireAuthenticatedUserId(req: Request): number | string {
  const authenticatedUser = (req as Request & { user?: AuthenticatedUser }).user;
  const userId = authenticatedUser?.id;
  if (userId === undefined || userId === null) {
    throw new AppError('Authenticated user is required', {
      code: 'AUTHENTICATION_REQUIRED',
      statusCode: 401,
    });
  }

  return userId;
}

function resolveRouteErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Failed to clone repository';
}

/**
 * Creates the two halves of a repository clone. The browser's EventSource can
 * only issue a bare GET, and a GET's URL is written to access logs, proxy logs
 * and browser history — so the request that carries the GitHub token is a
 * POST, and the stream's URL names it by an opaque id.
 */
export function createProjectCloneRouter(dependencies: ProjectCloneRouterDependencies): express.Router {
  const router = express.Router();

  /**
   * Parks the request under a fresh id for `/clone-progress` to pick up.
   * Nothing is spawned here; the stream that follows runs and reports it.
   */
  router.post(
    '/clone',
    asyncHandler(async (req, res) => {
      const userId = requireAuthenticatedUserId(req);
      const requestBody = req.body as Record<string, unknown>;
      const cloneId = dependencies.pendingCloneRequests.add(userId, {
        workspacePath: typeof requestBody.path === 'string' ? requestBody.path : '',
        githubUrl: typeof requestBody.githubUrl === 'string' ? requestBody.githubUrl : '',
        githubTokenId: typeof requestBody.githubTokenId === 'number' ? requestBody.githubTokenId : null,
        newGithubToken: typeof requestBody.newGithubToken === 'string' ? requestBody.newGithubToken : null,
      });

      res.json({ cloneId });
    }),
  );

  /**
   * Claims the request the id names before any stream headers go out, so a
   * stale or foreign id gets an ordinary 404 instead of an empty stream.
   */
  router.get(
    '/clone-progress',
    asyncHandler(async (req, res) => {
      const userId = requireAuthenticatedUserId(req);
      const cloneId = typeof req.query.cloneId === 'string' ? req.query.cloneId : '';
      const cloneRequest = dependencies.pendingCloneRequests.claim(cloneId, userId);
      if (!cloneRequest) {
        throw new AppError('Clone request not found or expired', {
          code: 'CLONE_REQUEST_NOT_FOUND',
          statusCode: 404,
        });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const sendEvent = (type: string, data: Record<string, unknown>) => {
        if (res.writableEnded) {
          return;
        }

        res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
      };

      // The client can go away while the clone is still validating its
      // input and preparing the directory — before there is an operation to
      // cancel. Remember that it did, so the git process is cancelled the
      // moment it exists rather than left cloning for nobody: the id was
      // claimed above, so no reconnect can ever reach this run.
      let cloneOperation: Awaited<ReturnType<typeof startCloneProject>> | null = null;
      let clientGone = false;
      const closeListener = () => {
        clientGone = true;
        cloneOperation?.cancel();
      };
      req.on('close', closeListener);

      try {
        cloneOperation = await dependencies.startCloneProject(
          { ...cloneRequest, userId },
          {
            onProgress: (message) => {
              sendEvent('progress', { message });
            },
            onComplete: ({ project, message }) => {
              sendEvent('complete', { project, message });
            },
          },
        );
        if (clientGone) {
          cloneOperation.cancel();
        }

        await cloneOperation.waitForCompletion;
      } catch (error) {
        sendEvent('error', { message: resolveRouteErrorMessage(error) });
      } finally {
        req.off('close', closeListener);
        if (!res.writableEnded) {
          res.end();
        }
      }
    }),
  );

  return router;
}

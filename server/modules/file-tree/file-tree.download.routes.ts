import express from 'express';
import type { Request } from 'express';

import { createRouteHandler } from '@/modules/file-tree/file-tree.routes.js';
import type { DownloadClaim, FileTreeLogger, FileTreeServices } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

function readDownloadClaim(request: Request): DownloadClaim {
  const claim = (request as Request & { downloadClaim?: DownloadClaim }).downloadClaim;
  if (!claim || typeof claim.projectId !== 'string' || typeof claim.path !== 'string') {
    throw new AppError('Invalid download token', {
      code: 'DOWNLOAD_TOKEN_INVALID',
      statusCode: 401,
    });
  }
  return claim;
}

/**
 * Native browser download router, mounted separately at `/api/download` because
 * it is authenticated by a scoped capability token rather than the session
 * token that guards `/api/file-tree`.
 *
 * The file path comes only from the signed claim, never from the query string,
 * so this route has no caller-supplied path to validate.
 */
export function createFileDownloadRouter(
  services: FileTreeServices,
  logger: FileTreeLogger,
): express.Router {
  const router = express.Router();

  router.get('/file', createRouteHandler(async (request, response) => {
    const claim = readDownloadClaim(request);
    // Re-resolve: the file may have been deleted since the ticket was issued.
    const target = await services.resolveDownloadTarget(claim.projectId, claim.path);

    // `res.download` delegates to `send`, whose legacy dotfile rule answers 404
    // for any file whose own name starts with a dot. Project trees are full of
    // them (.env, .gitignore, .nvmrc), and the path is already confined to the
    // project root, so serve them exactly like the inline content route does.
    response.download(target.path, target.name, { dotfiles: 'allow' }, (error) => {
      if (!error) return;

      if (!response.headersSent) {
        logger.error('Error sending File Tree download', error);
        response.status(500).json({ error: 'Error reading file' });
        return;
      }

      // The client hung up on its own — cancelling a download or closing the
      // tab is a normal outcome for this route, not a server failure, and the
      // response is already gone, so there is nothing to log or to send.
      const code = (error as NodeJS.ErrnoException).code;
      if (request.destroyed || code === 'ECONNABORTED' || code === 'EPIPE') return;

      // A genuine read failure mid-transfer: the headers, including
      // Content-Length, are already on the wire, so the only honest signal left
      // is to break the connection. The browser then marks the download failed
      // instead of saving a silently truncated file.
      logger.error('File Tree download failed after headers were sent', error);
      response.destroy();
    });
  }, logger));

  return router;
}

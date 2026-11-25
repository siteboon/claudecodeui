import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';
import multer from 'multer';

type UploadOptions = {
  kind: 'images' | 'files';
  maxBytes: number;
  maxFiles: number;
};

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVALID_IMAGE_TYPE = 'Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed.';

/** Used by the assets routes to correlate uploads and report safe, actionable failures. */
export function createAssetUploadMiddleware(
  upload: RequestHandler,
  options: UploadOptions,
  logger: Pick<Console, 'info' | 'warn'> = console,
): RequestHandler {
  return (request, response, next) => {
    // Accept only UUIDs: arbitrary header values must never enter diagnostic logs.
    const suppliedId = request.headers['x-upload-request-id'];
    const requestId = typeof suppliedId === 'string' && REQUEST_ID_PATTERN.test(suppliedId)
      ? suppliedId : randomUUID();
    response.setHeader('X-Upload-Request-ID', requestId);
    const started = Date.now();
    let terminalLogged = false;
    const logTerminal = (event: string) => {
      if (terminalLogged) return;
      terminalLogged = true;
      // Deliberately omit names, paths, bodies, headers, query strings and raw errors.
      logger.info({
        event, requestId, kind: options.kind, durationMs: Date.now() - started,
        status: response.writableFinished ? response.statusCode : undefined,
        requestComplete: request.complete,
      });
    };
    response.once('finish', () => logTerminal('attachment_upload_finished'));
    request.once('aborted', () => logTerminal('attachment_upload_aborted'));
    response.once('close', () => {
      if (!response.writableFinished) logTerminal('attachment_upload_disconnected');
    });

    upload(request, response, (error?: unknown) => {
      if (!error) return next();

      let status = 500;
      let code = 'UPLOAD_FAILED';
      let message = 'Upload failed. Please try again.';
      if (error instanceof multer.MulterError) {
        status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        code = error.code;
        message = error.code === 'LIMIT_FILE_SIZE'
          ? `Each file must be ${options.maxBytes / (1024 * 1024)} MB or smaller.`
          : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
            ? `Upload at most ${options.maxFiles} files using the attachment picker.`
            : 'The upload request could not be read. Please select the files again.';
      } else if (error instanceof Error && /Unexpected end of|Boundary not found|Multipart:/i.test(error.message)) {
        status = 400;
        code = 'UPLOAD_INCOMPLETE';
        message = 'The upload was interrupted. Please try again.';
      } else if (options.kind === 'images' && error instanceof Error && error.message === INVALID_IMAGE_TYPE) {
        status = 400;
        code = 'UPLOAD_INVALID_TYPE';
        message = INVALID_IMAGE_TYPE;
      } else if (error && typeof error === 'object' && 'code' in error
        && typeof error.code === 'string'
        && ['ENOSPC', 'EDQUOT', 'EACCES', 'EROFS', 'EPERM'].includes(error.code)) {
        status = 503;
        code = 'UPLOAD_STORAGE_UNAVAILABLE';
        message = 'File storage is temporarily unavailable. Please try again later.';
      }

      logger.warn({ event: 'attachment_upload_failed', requestId, kind: options.kind, code, status });
      // A disconnected client cannot receive JSON; do not write to its closed socket.
      if (response.destroyed || response.headersSent) return;
      response.status(status).json({ error: message, code, requestId });
    });
  };
}

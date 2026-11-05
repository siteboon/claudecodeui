import express from 'express';
import multer from 'multer';

import {
  buildStoredAttachmentRecords,
  buildStoredImageRecords,
  ensureImageAssetsDir,
  isAllowedImageMimeType,
  openStoredAttachmentAsset,
} from '@/modules/assets/services/image-assets.service.js';

const router = express.Router();

/** Per-file chat attachment limit, in megabytes, when CHAT_ATTACHMENT_MAX_SIZE_MB is unset. */
const DEFAULT_CHAT_ATTACHMENT_MAX_SIZE_MB = 10;
const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * Reads the per-file chat attachment limit, in megabytes, from the
 * CHAT_ATTACHMENT_MAX_SIZE_MB value the server was started with.
 *
 * Unset or blank means the 10 MB default. Anything that is not a whole number
 * of at least 1 (a unit suffix, a fraction, zero, a negative number, or a value
 * too large to count in bytes exactly) falls back to the default with a warning,
 * rather than silently disabling the limit or rejecting every upload.
 *
 * Exported for the assets module's tests; the router reads the variable once, at load.
 */
export function resolveChatAttachmentMaxSizeMb(
  rawValue: string | undefined,
  warn: (message: string) => void = console.warn,
): number {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) {
    return DEFAULT_CHAT_ATTACHMENT_MAX_SIZE_MB;
  }

  const megabytes = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  // The byte count must stay an exact integer, including the +1 multer is given below.
  if (megabytes >= 1 && Number.isSafeInteger(megabytes * BYTES_PER_MEGABYTE + 1)) {
    return megabytes;
  }

  warn(
    `[Assets] Ignoring CHAT_ATTACHMENT_MAX_SIZE_MB="${value}": expected a whole number of megabytes, `
    + `at least 1 (for example 50). Using the default of ${DEFAULT_CHAT_ATTACHMENT_MAX_SIZE_MB} MB.`,
  );
  return DEFAULT_CHAT_ATTACHMENT_MAX_SIZE_MB;
}

const chatAttachmentMaxSizeMb = resolveChatAttachmentMaxSizeMb(process.env.CHAT_ATTACHMENT_MAX_SIZE_MB);
const chatAttachmentMaxSizeBytes = chatAttachmentMaxSizeMb * BYTES_PER_MEGABYTE;

// Multer writes uploads straight into the global assets folder; the service
// owns the folder location and the response record shape.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureImageAssetsDir()
      .then((assetsDir) => cb(null, assetsDir))
      .catch((error) => cb(error as Error, ''));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uniqueSuffix}-${sanitizedName}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (isAllowedImageMimeType(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed.'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 5,
  },
});

const attachmentUpload = multer({
  storage,
  limits: {
    // Busboy rejects a file as soon as its byte count reaches `fileSize`, so the
    // limit given to multer is one past the largest accepted size: a file of
    // exactly the advertised maximum is accepted, as the composer's check assumes.
    fileSize: chatAttachmentMaxSizeBytes + 1,
    files: 10,
  },
});

/**
 * Stores chat image attachments in the global `~/.cloudcli/assets` folder and
 * returns their absolute paths for use in provider prompts and chat history.
 */
router.post('/images', (req, res) => {
  upload.array('images', 5)(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      return res.status(400).json({ error: message });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'No image files provided' });
    }

    res.json({ images: buildStoredImageRecords(files) });
  });
});

/**
 * Reports the chat attachment limits the composer checks files against before
 * uploading, so the browser never carries its own copy of a limit the
 * operator can change with CHAT_ATTACHMENT_MAX_SIZE_MB.
 */
router.get('/limits', (req, res) => {
  res.json({ maxFileSizeBytes: chatAttachmentMaxSizeBytes });
});

/**
 * Stores provider-neutral chat attachments. Files of any MIME type are
 * accepted because providers inspect them as data through their file-reading
 * tools; uploads are capped at 10 files and CHAT_ATTACHMENT_MAX_SIZE_MB
 * (default 10 MB) per file.
 */
router.post('/files', (req, res) => {
  attachmentUpload.array('files', 10)(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: `File too large. Maximum size is ${chatAttachmentMaxSizeMb} MB.`,
        });
      }
      const message = err instanceof Error ? err.message : 'Upload failed';
      return res.status(400).json({ error: message });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    res.json({ attachments: buildStoredAttachmentRecords(files) });
  });
});

/**
 * Serves one stored image asset by filename. Only files directly inside the
 * global assets folder are reachable; traversal attempts resolve to null.
 */
router.get('/images/:filename', async (req, res) => {
  const asset = await openStoredAttachmentAsset(req.params.filename);
  if (asset.status === 'invalid') {
    return res.status(400).json({ error: 'Invalid asset filename' });
  }
  if (asset.status === 'missing') {
    return res.status(404).json({ error: 'Asset not found' });
  }

  res.setHeader('Content-Type', asset.contentType);
  // Stored-XSS hardening: never let the browser sniff a different type, and
  // force SVGs (which can carry scripts when rendered as a document) to
  // download instead of rendering inline. The chat UI is unaffected — it
  // fetches assets as blobs and shows them through <img>, where SVG scripts
  // never execute.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (asset.contentType === 'image/svg+xml') {
    res.setHeader('Content-Disposition', 'attachment');
  }
  asset.stream.pipe(res);
  asset.stream.on('error', (error) => {
    console.error('Error streaming image asset:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error reading asset' });
    }
  });
});

/**
 * Downloads one stored non-image attachment. Content-Disposition prevents
 * uploaded HTML or other active formats from rendering in the application.
 */
router.get('/files/:filename', async (req, res) => {
  const asset = await openStoredAttachmentAsset(req.params.filename);
  if (asset.status === 'invalid') {
    return res.status(400).json({ error: 'Invalid asset filename' });
  }
  if (asset.status === 'missing') {
    return res.status(404).json({ error: 'Asset not found' });
  }

  res.setHeader('Content-Type', asset.contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename.replace(/["\r\n]/g, '_')}"`);
  asset.stream.pipe(res);
  asset.stream.on('error', (error) => {
    console.error('Error streaming attachment asset:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error reading asset' });
    }
  });
});

export default router;

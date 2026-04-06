import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '@/shared/utils/app-error.js';

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

type UploadedImage = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

export type StoredImageAsset = {
  originalName: string;
  storedName: string;
  absolutePath: string;
  relativePath: string;
  mimeType: string;
  size: number;
};

/**
 * Persists uploaded images in `.cloudcli/assets` and returns resolved paths for provider calls.
 */
export const llmAssetsService = {
  async storeUploadedImages(
    images: UploadedImage[],
    options?: {
      workspacePath?: string;
    },
  ): Promise<StoredImageAsset[]> {
    if (!images.length) {
      throw new AppError('At least one image file is required.', {
        code: 'IMAGE_REQUIRED',
        statusCode: 400,
      });
    }

    const workspaceRoot = path.resolve(options?.workspacePath ?? process.cwd());
    const assetsDirectory = path.join(workspaceRoot, '.cloudcli', 'assets');
    await mkdir(assetsDirectory, { recursive: true });

    const storedAssets: StoredImageAsset[] = [];
    for (const image of images) {
      if (!SUPPORTED_IMAGE_MIME_TYPES.has(image.mimetype)) {
        throw new AppError(`Unsupported image type "${image.mimetype}".`, {
          code: 'UNSUPPORTED_IMAGE_TYPE',
          statusCode: 400,
        });
      }

      const extension = (MIME_TO_EXTENSION[image.mimetype] ?? path.extname(image.originalname)) || '.img';
      const storedName = `${Date.now()}-${randomUUID()}${extension}`;
      const absolutePath = path.join(assetsDirectory, storedName);

      await writeFile(absolutePath, image.buffer);

      storedAssets.push({
        originalName: image.originalname,
        storedName,
        absolutePath,
        relativePath: path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/'),
        mimeType: image.mimetype,
        size: image.size,
      });
    }

    return storedAssets;
  },
};

import { randomUUID } from 'node:crypto';
import os from 'node:os';

import multer from 'multer';

import { FLAT_MULTIPART_FIELD_NESTING_DEPTH } from '@/shared/utils.js';

const MAXIMUM_UPLOAD_SIZE_MEGABYTES = 200;
const MAXIMUM_UPLOAD_SIZE_BYTES = MAXIMUM_UPLOAD_SIZE_MEGABYTES * 1024 * 1024;
const MAXIMUM_UPLOAD_FILE_COUNT = 20;

/** File Tree upload limits shared by production composition and route tests. */
export const fileTreeUploadLimits = {
  maximumFileSizeMegabytes: MAXIMUM_UPLOAD_SIZE_MEGABYTES,
  maximumFileCount: MAXIMUM_UPLOAD_FILE_COUNT,
};

/** File Tree multipart parser shared by production composition and route tests. */
export const fileTreeUploadMiddleware = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_request, _file, callback) => {
      callback(null, `cloudcli-file-upload-${randomUUID()}`);
    },
  }),
  limits: {
    fieldNestingDepth: FLAT_MULTIPART_FIELD_NESTING_DEPTH,
    fileSize: MAXIMUM_UPLOAD_SIZE_BYTES,
    files: MAXIMUM_UPLOAD_FILE_COUNT,
  },
}).array('files', MAXIMUM_UPLOAD_FILE_COUNT);

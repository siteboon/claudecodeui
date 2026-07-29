import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import express from 'express';
import multer from 'multer';

import { FLAT_MULTIPART_FIELD_NESTING_DEPTH } from '../multipart-upload-limits.js';

test('flat multipart uploads reject nested fields', async () => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fieldNestingDepth: FLAT_MULTIPART_FIELD_NESTING_DEPTH,
    },
  });
  const app = express();
  app.post('/upload', (request, response) => {
    upload.none()(request, response, (error: unknown) => {
      const code = (
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && typeof error.code === 'string'
      )
        ? error.code
        : 'NO_ERROR';
      response.statusCode = code === 'LIMIT_FIELD_NESTING' ? 422 : 500;
      response.end(code);
    });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const form = new FormData();
    form.set('nested[value]', 'blocked');
    const response = await fetch(`http://127.0.0.1:${address.port}/upload`, {
      method: 'POST',
      body: form,
    });

    assert.equal(response.status, 422);
    assert.equal(await response.text(), 'LIMIT_FIELD_NESTING');
  } finally {
    server.close();
    await once(server, 'close');
  }
});

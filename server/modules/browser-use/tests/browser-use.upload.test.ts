import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';

// File validation runs before the session lookup, so these cases need no browser runtime.
const upload = (paths: string[]) => browserUseService.agentUploadFiles('missing-session', { paths });

test('upload rejects an empty file list', async () => {
  await assert.rejects(upload([]), /at least one file/i);
});

test('upload rejects relative paths', async () => {
  await assert.rejects(upload(['banner.png']), /must be absolute/i);
});

test('upload rejects missing files and directories', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-upload-'));
  try {
    await assert.rejects(upload([path.join(dir, 'nope.png')]), /file not found/i);
    await assert.rejects(upload([dir]), /not a regular file/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('upload rejects more than ten files', async () => {
  const many = Array.from({ length: 11 }, (_, index) => `/tmp/file-${index}.png`);
  await assert.rejects(upload(many), /at most 10/i);
});

// Whether agent tools are enabled depends on saved settings, so either message proves the files passed validation.
test('upload accepts a valid file and then fails on the unknown session', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-upload-'));
  const file = path.join(dir, 'icon.png');
  fs.writeFileSync(file, 'x');
  try {
    await assert.rejects(upload([file]), /disabled|session not found/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

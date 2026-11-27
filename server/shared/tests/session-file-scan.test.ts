import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findFilesRecursivelyModifiedAfter } from '../utils.js';

test('incremental scan continues after one disappearing entry and propagates unexpected errors', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-entry-'));
  const original = fs.stat;
  try {
    for (const name of ['a.jsonl', 'b.jsonl']) await fs.writeFile(path.join(root, name), '{}');
    fs.stat = (async (file: string, ...args: unknown[]) => {
      if (String(file).endsWith('a.jsonl')) throw Object.assign(new Error('disappeared'), { code: 'ENOENT' });
      return original(file, ...args as []);
    }) as typeof fs.stat;
    syncBuiltinESMExports();
    assert.deepEqual(await findFilesRecursivelyModifiedAfter(root, '.jsonl', new Date(0)), [path.join(root, 'b.jsonl')]);
    fs.stat = (async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }) as typeof fs.stat;
    syncBuiltinESMExports();
    await assert.rejects(findFilesRecursivelyModifiedAfter(root, '.jsonl', new Date(0)), { code: 'EACCES' });
  } finally {
    fs.stat = original;
    syncBuiltinESMExports();
    await fs.rm(root, { recursive: true, force: true });
  }
});

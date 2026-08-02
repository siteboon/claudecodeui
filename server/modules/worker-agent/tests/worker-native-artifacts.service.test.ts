import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createWorkerNativeArtifactsService } from '../worker-native-artifacts.service.js';

test('ensureNative restores a Claude jsonl from cloud turns', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'worker-native-claude-'));
  try {
    const service = createWorkerNativeArtifactsService({
      getHomeDirectory: () => home,
    });

    const projectPath = '/home/aaron/demo';
    const providerSessionId = 'claude-sess-1';
    const result = await service.ensureNative({
      provider: 'claude',
      providerSessionId,
      projectPath,
      messages: [
        {
          id: 'm1',
          sessionId: 'app-1',
          timestamp: '2026-08-02T01:00:00.000Z',
          provider: 'claude',
          kind: 'text',
          role: 'user',
          content: 'hello from cloud',
        },
        {
          id: 'm2',
          sessionId: 'app-1',
          timestamp: '2026-08-02T01:00:01.000Z',
          provider: 'claude',
          kind: 'text',
          role: 'assistant',
          content: 'hi back',
        },
      ],
    });

    assert.equal(result.success, true);
    assert.equal(result.restored, true);
    assert.ok(result.jsonlPath);
    const body = await readFile(result.jsonlPath!, 'utf8');
    assert.match(body, /hello from cloud/);
    assert.match(body, /hi back/);
    assert.match(body, /claude-sess-1/);

    const second = await service.ensureNative({
      provider: 'claude',
      providerSessionId,
      projectPath,
      messages: [],
    });
    assert.equal(second.restored, false);
    assert.equal(second.jsonlPath, result.jsonlPath);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('ensureNative drops Cursor provider id when store.db is missing', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'worker-native-cursor-'));
  try {
    const service = createWorkerNativeArtifactsService({
      getHomeDirectory: () => home,
    });
    const result = await service.ensureNative({
      provider: 'cursor',
      providerSessionId: 'cursor-1',
      projectPath: '/tmp/project',
      messages: [],
    });
    assert.equal(result.success, true);
    assert.equal(result.dropProviderSessionId, true);
    assert.equal(result.jsonlPath, null);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

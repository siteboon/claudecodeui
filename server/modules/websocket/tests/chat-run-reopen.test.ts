import assert from 'node:assert/strict';
import test from 'node:test';

import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';

/**
 * A provider process held open after its run completed can start another
 * turn; the run is reported as running again for it, keeping its event log.
 */

const start = (sessionId: string) => {
  const run = chatRunRegistry.startRun({
    appSessionId: sessionId,
    provider: 'claude',
    providerSessionId: null,
    connection: null,
    userId: 1,
  });
  assert.ok(run);
  return run;
};

test('a completed run reopens, keeps its sequence, and completes again', () => {
  chatRunRegistry.clearAll();
  const run = start('reopen-1');
  run.writer.sendComplete({ exitCode: 0 });
  assert.equal(chatRunRegistry.isProcessing('reopen-1'), false);
  const seqAfterFirst = run.lastSeq;

  assert.equal(run.writer.reopen(), true);
  assert.equal(chatRunRegistry.isProcessing('reopen-1'), true);
  assert.deepEqual(chatRunRegistry.listRunningRuns().map((entry) => entry.sessionId), ['reopen-1']);

  run.writer.sendComplete({ exitCode: 0 });
  assert.equal(chatRunRegistry.isProcessing('reopen-1'), false);
  assert.equal(run.lastSeq, seqAfterFirst + 1, 'the second complete is delivered, not dropped as a duplicate');
  chatRunRegistry.clearAll();
});

test('a run does not reopen over a newer run of the same session', () => {
  chatRunRegistry.clearAll();
  const old = start('reopen-2');
  old.writer.sendComplete({ exitCode: 0 });
  const newer = start('reopen-2');

  assert.equal(old.writer.reopen(), false);
  assert.equal(chatRunRegistry.getRun('reopen-2'), newer);
  chatRunRegistry.clearAll();
});

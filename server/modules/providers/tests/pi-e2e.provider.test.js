import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rmdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  sessionsDb,
} from '@/modules/database/index.js';
import {
  providerModelsService,
  providerRuntimeService,
  sessionsService,
} from '@/modules/providers/index.js';
import { chatRunRegistry, connectedClients } from '@/modules/websocket/index.js';
import { getPiSessionDir } from '@/shared/utils.js';

/**
 * Opt-in end-to-end coverage: a real `pi` CLI on PATH talking to a real model
 * through the exact production stack (provider runtime service → gateway run
 * registry → gateway writer → isolated app database).
 *
 * Skipped unless the caller opts in, because every turn costs real tokens:
 *
 *   PI_E2E=1 PI_E2E_MODEL=glm-5.3 npm test -- pi-e2e
 *
 * The model id and the credentials both come from the environment (plus the
 * user's own `~/.pi/agent/models.json`); nothing is hardcoded here.
 */
const enabled = process.env.PI_E2E === '1';
const model = process.env.PI_E2E_MODEL;
const skipReason = !enabled
  ? 'opt-in: set PI_E2E=1 to run against a real pi CLI'
  : !model
    ? 'opt-in: set PI_E2E_MODEL=<provider/model> to choose the real model'
    : false;

// Real model turns take seconds to tens of seconds; a hung child must not
// wedge the suite forever either.
const TEST_TIMEOUT_MS = 5 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Isolated database + production gateway stand-ins
// ---------------------------------------------------------------------------

let databaseReady = false;
let databaseDir = null;

/**
 * Points the app database at a throwaway file so the e2e never touches the
 * developer's real sessions (same isolation the websocket tests use).
 */
async function ensureIsolatedDatabase() {
  if (databaseReady) {
    return;
  }

  databaseDir = await mkdtemp(path.join(os.tmpdir(), 'pi-e2e-db-'));
  process.env.DATABASE_PATH = path.join(databaseDir, 'auth.db');
  closeConnection();
  await initializeDatabase();
  databaseReady = true;
}

after(() => {
  connectedClients.clear();
  chatRunRegistry.clearAll();
  if (databaseReady) {
    closeConnection();
    databaseReady = false;
  }
  if (databaseDir) {
    void rm(databaseDir, { recursive: true, force: true });
    databaseDir = null;
  }
});

/**
 * Minimal stand-in for a websocket connection: collects the exact JSON frames
 * a browser would receive, so assertions run against the client-visible
 * protocol (app session ids, seq numbers) rather than runtime internals.
 */
class FakeConnection {
  readyState = 1; // WS_OPEN_STATE

  frames = [];

  send(data) {
    this.frames.push(JSON.parse(data));
  }
}

/**
 * Drives one turn exactly the way `dispatchRun` (chat-websocket.service.ts)
 * does: reserve the run in the registry, record the model selection, dispatch
 * through the production runtime service, and apply the same safety-net
 * complete. Returns what the client would have seen.
 */
async function runProductionTurn({ appSessionId, prompt, cwd, model: turnModel }) {
  const session = sessionsDb.getSessionById(appSessionId);
  assert.ok(session, 'the app session row must exist before a turn runs');

  const connection = new FakeConnection();
  const run = chatRunRegistry.startRun({
    appSessionId,
    provider: session.provider,
    providerSessionId: session.provider_session_id,
    connection,
    userId: null,
  });
  assert.ok(run, 'the session must not already have a run in progress');

  // dispatchRun records the picked model on the row before dispatching, which
  // is what makes the resume turn resolve its model from the database.
  if (turnModel) {
    providerModelsService.setSessionModel(session.provider, appSessionId, turnModel);
  }

  let failure = null;
  try {
    await providerRuntimeService.run(
      session.provider,
      prompt,
      {
        sessionId: appSessionId,
        cwd,
        projectPath: cwd,
        model: turnModel,
      },
      run.writer,
    );
  } catch (error) {
    // dispatchRun swallows runtime rejections the same way and relies on the
    // terminal complete (its own or the abort handler's) to unstick the UI.
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    chatRunRegistry.completeRunIfCurrent(run, { exitCode: 1 });
  }

  const recorded = chatRunRegistry.getRun(appSessionId);
  return {
    connection,
    failure,
    events: recorded ? [...recorded.events] : [],
    stillProcessing: chatRunRegistry.isProcessing(appSessionId),
  };
}

// ---------------------------------------------------------------------------
// pi session file helpers
// ---------------------------------------------------------------------------

/**
 * Locates the transcript pi wrote for one provider session id.
 *
 * pi stores every session of a working directory flat inside
 * `~/.pi/agent/sessions/<encoded cwd>/`, so the encoded directory is asserted
 * indirectly: it must sit directly under the sessions root and carry a
 * mangled form of the temp cwd (the test's mkdtemp leaf name survives any
 * dash encoding pi applies).
 */
async function findPiTranscript(providerSessionId, cwdLeafName) {
  const root = getPiSessionDir();
  let rootEntries = [];
  try {
    rootEntries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of rootEntries) {
    if (!entry.isDirectory() || !entry.name.includes(cwdLeafName)) {
      continue;
    }

    const encodedDir = path.join(root, entry.name);
    const files = await readdir(encodedDir);
    const transcript = files.find(
      (name) => name.endsWith('.jsonl') && name.includes(providerSessionId),
    );
    if (transcript) {
      return { transcriptPath: path.join(encodedDir, transcript), encodedDir };
    }
  }

  return null;
}

/**
 * Removes the transcript and its (now likely empty) encoded cwd directory so
 * e2e runs do not accumulate test sessions in the developer's real pi data
 * directory. Non-recursive on purpose: a directory that still holds anything
 * else is left alone.
 */
async function cleanupPiTranscript(encodedDir, transcriptPath) {
  await rm(transcriptPath, { force: true });
  try {
    await rmdir(encodedDir);
  } catch {
    // Still has content (or is gone) — leave it be.
  }
}

/**
 * Best-effort teardown for one scenario: resolves the session's provider id
 * through the same row the gateway wrote and deletes the transcript pi left
 * behind (an aborted run still writes its header).
 */
async function cleanupSessionArtifacts(appSessionId, cwdLeafName) {
  const providerSessionId = sessionsDb.getSessionById(appSessionId)?.provider_session_id;
  if (!providerSessionId) {
    return;
  }

  const transcript = await findPiTranscript(providerSessionId, cwdLeafName);
  if (transcript) {
    await cleanupPiTranscript(transcript.encodedDir, transcript.transcriptPath);
  }
}

// ---------------------------------------------------------------------------
// The e2e scenarios
// ---------------------------------------------------------------------------

test(
  'pi e2e: run → stream → complete → session file → resume → history',
  { skip: skipReason, timeout: TEST_TIMEOUT_MS },
  async () => {
    await ensureIsolatedDatabase();
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'pi-e2e-run-'));
    const cwdLeafName = path.basename(workDir);
    const appSessionId = `pi-e2e-${randomUUID()}`;
    sessionsDb.createAppSession(appSessionId, 'pi', workDir);

    let transcript = null;
    try {
      // --- turn 1: fresh session, streamed reply, terminal complete -------
      const first = await runProductionTurn({
        appSessionId,
        prompt: 'Reply with exactly: e2e-hello',
        cwd: workDir,
        model,
      });

      // The gateway swallows `session_created` and maps the provider-native id
      // onto the app row instead; the client-visible frames carry the app id.
      const mappedProviderId = sessionsDb.getSessionById(appSessionId).provider_session_id;
      assert.ok(mappedProviderId, 'the gateway must persist the provider session mapping');
      assert.notEqual(mappedProviderId, appSessionId);

      const streamedText = first.connection.frames
        .filter((frame) => frame.kind === 'stream_delta')
        .map((frame) => frame.content)
        .join('');
      assert.match(streamedText, /e2e-hello/);
      assert.ok(
        first.connection.frames.every((frame) => frame.sessionId === appSessionId),
        'every client frame must be remapped to the app session id',
      );

      const completes = first.connection.frames.filter((frame) => frame.kind === 'complete');
      assert.equal(completes.length, 1, 'exactly one terminal complete per run');
      assert.equal(completes[0].aborted, false);
      assert.equal(completes[0].success, true);
      assert.equal(completes[0].provider, 'pi');
      assert.equal(first.failure, null);
      assert.equal(first.stillProcessing, false);

      const tokenBudget = first.connection.frames.find(
        (frame) => frame.kind === 'status' && frame.text === 'token_budget',
      );
      assert.ok(tokenBudget, 'the run must report a token budget from pi usage');
      assert.ok(tokenBudget.tokenBudget.used > 0);

      // --- session transcript: one jsonl under the cwd-encoded directory ---
      transcript = await findPiTranscript(mappedProviderId, cwdLeafName);
      assert.ok(transcript, 'pi must persist the session under ~/.pi/agent/sessions');
      assert.equal(
        path.dirname(transcript.encodedDir),
        getPiSessionDir(),
        'pi keeps all sessions of one cwd flat in a single directory',
      );
      const siblings = await readdir(transcript.encodedDir);
      assert.equal(
        siblings.filter((name) => name.endsWith('.jsonl')).length,
        1,
        'a fresh pi session writes exactly one transcript for its cwd',
      );

      // --- turn 2: resume through the same app session id ------------------
      const second = await runProductionTurn({
        appSessionId,
        prompt: 'What exact phrase did I ask you to reply with in this session? Quote it.',
        cwd: workDir,
        model,
      });

      const resumedText = second.connection.frames
        .filter((frame) => frame.kind === 'stream_delta')
        .map((frame) => frame.content)
        .join('');
      assert.match(resumedText, /e2e-hello/);
      assert.equal(second.connection.frames.filter((frame) => frame.kind === 'complete').length, 1);
      assert.equal(second.failure, null);
      // Resume reuses the provider transcript instead of starting a new one.
      assert.equal(
        sessionsDb.getSessionById(appSessionId).provider_session_id,
        mappedProviderId,
        'resume keeps the provider-native session id',
      );
      const resumedSiblings = await readdir(transcript.encodedDir);
      assert.equal(
        resumedSiblings.filter((name) => name.endsWith('.jsonl')).length,
        1,
        'resumed turns append to the same session file',
      );

      // --- history: the production REST read path over the JSONL ----------
      const history = await sessionsService.fetchHistory(appSessionId, {});
      const historyText = history.messages
        .filter((message) => message.kind === 'text')
        .map((message) => message.content)
        .join('\n');
      assert.match(historyText, /e2e-hello/);
      assert.ok(
        history.messages.some((message) => message.kind === 'text' && message.role === 'user'),
        'history must contain the user prompt',
      );
      assert.ok(history.tokenUsage && history.tokenUsage.used > 0);
    } finally {
      await cleanupSessionArtifacts(appSessionId, cwdLeafName);
      await rm(workDir, { recursive: true, force: true });
      chatRunRegistry.clearAll();
    }
  },
);

test(
  'pi e2e: a tool turn pairs every tool_use with its tool_result',
  { skip: skipReason, timeout: TEST_TIMEOUT_MS },
  async () => {
    await ensureIsolatedDatabase();
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'pi-e2e-tool-'));
    const appSessionId = `pi-e2e-${randomUUID()}`;
    sessionsDb.createAppSession(appSessionId, 'pi', workDir);

    try {
      await mkdir(path.join(workDir, 'pi-e2e-marker-dir'), { recursive: true });

      const turn = await runProductionTurn({
        appSessionId,
        prompt:
          'Use the bash tool to run exactly this one command, then answer with the command output: ls -a',
        cwd: workDir,
        model,
      });

      const toolUses = turn.connection.frames.filter((frame) => frame.kind === 'tool_use');
      const toolResults = turn.connection.frames.filter((frame) => frame.kind === 'tool_result');
      assert.ok(toolUses.length > 0, 'the run must report tool activity from pi');
      assert.ok(toolResults.length > 0, 'the run must report tool results from pi');

      // Every tool call pi starts must be closed by a result keyed by the same id.
      for (const toolUse of toolUses) {
        const paired = toolResults.filter((frame) => frame.toolId === toolUse.toolId);
        assert.equal(paired.length, 1, `tool_use ${toolUse.toolId} must pair with one tool_result`);
        assert.equal(paired[0].toolName, toolUse.toolName);
      }

      const bashResult = toolUses.some((frame) => frame.toolName === 'bash')
        ? toolResults.find((frame) => frame.toolName === 'bash')
        : toolResults[0];
      assert.ok(bashResult, 'the bash tool result must reach the client');
      assert.equal(bashResult.toolResult.isError, false);
      assert.match(bashResult.toolResult.content, /pi-e2e-marker-dir/);

      // Calibration observation (docs/pi-notes.md): pi finalizes one assistant
      // message per tool round, so a tool turn streams more than one
      // stream_end. Logged for the e2e calibration notes, not asserted.
      const streamEnds = turn.connection.frames.filter((frame) => frame.kind === 'stream_end');
      console.log(`[pi-e2e] tool turn stream_end count: ${streamEnds.length}`);

      assert.equal(turn.connection.frames.filter((frame) => frame.kind === 'complete').length, 1);
      assert.equal(turn.failure, null);

      // The persisted history carries the same pairing back after the run.
      const history = await sessionsService.fetchHistory(appSessionId, {});
      const historyToolUses = history.messages.filter((message) => message.kind === 'tool_use');
      const historyToolResults = history.messages.filter((message) => message.kind === 'tool_result');
      assert.ok(historyToolUses.length > 0, 'history must contain the tool call');
      assert.ok(historyToolResults.length > 0, 'history must contain the tool result');
      for (const toolUse of historyToolUses) {
        assert.ok(
          historyToolResults.some((frame) => frame.toolId === toolUse.toolId),
          'history tool_result must be keyed by the same tool id',
        );
      }
    } finally {
      await cleanupSessionArtifacts(appSessionId, path.basename(workDir));
      await rm(workDir, { recursive: true, force: true });
      chatRunRegistry.clearAll();
    }
  },
);

test(
  'pi e2e: aborting a long run SIGTERMs pi and the client sees one aborted complete',
  { skip: skipReason, timeout: TEST_TIMEOUT_MS },
  async () => {
    await ensureIsolatedDatabase();
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'pi-e2e-abort-'));
    const appSessionId = `pi-e2e-${randomUUID()}`;
    sessionsDb.createAppSession(appSessionId, 'pi', workDir);

    try {
      const connection = new FakeConnection();
      const run = chatRunRegistry.startRun({
        appSessionId,
        provider: 'pi',
        providerSessionId: sessionsDb.getSessionById(appSessionId).provider_session_id,
        connection,
        userId: null,
      });
      assert.ok(run);

      let failure = null;
      const runPromise = providerRuntimeService.run(
        'pi',
        'Count slowly from 1 to 100, one number per line.',
        { sessionId: appSessionId, cwd: workDir, projectPath: workDir, model },
        run.writer,
      ).catch((error) => {
        failure = error instanceof Error ? error.message : String(error);
      });

      // Poll like a user hammering Stop: the process row appears as soon as pi
      // is spawned, then give the turn a second so there is something to cut.
      let aborted = false;
      for (let attempt = 0; attempt < 100 && !aborted; attempt += 1) {
        aborted = await providerRuntimeService.abort('pi', appSessionId);
        if (!aborted) {
          await sleep(100);
        }
      }
      assert.equal(aborted, true, 'the running pi process must be abortable by app session id');
      await sleep(1000);
      assert.equal(await providerRuntimeService.abort('pi', appSessionId), false);

      // handleChatAbort's exact sequence: the gateway emits the terminal
      // complete on the run's behalf because aborted runtimes stay silent.
      chatRunRegistry.completeRun(appSessionId, { exitCode: 0, aborted: true });

      await runPromise;
      assert.match(failure || '', /terminated|exited with code/);

      const completes = connection.frames.filter((frame) => frame.kind === 'complete');
      assert.equal(completes.length, 1, 'exactly one complete reaches the client');
      assert.equal(completes[0].aborted, true);
      assert.equal(completes[0].provider, 'pi');
      assert.equal(chatRunRegistry.isProcessing(appSessionId), false, 'the session must not stay stuck');
    } finally {
      await cleanupSessionArtifacts(appSessionId, path.basename(workDir));
      await rm(workDir, { recursive: true, force: true });
      chatRunRegistry.clearAll();
    }
  },
);

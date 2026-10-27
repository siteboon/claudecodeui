import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ClaudeBackgroundWorkProvider } from '@/modules/providers/list/claude/claude-background-work.provider.js';
import type { SessionSubagent, SessionTranscriptRef } from '@/shared/types.js';

/**
 * The agents panel reads a chat's subagents and heartbeats from the files the
 * CLI writes: the chat's transcript (launches, resumes, reports, cron calls
 * and fires) and each agent's own transcript and sidecar under
 * `<native id>/subagents/`. These script those files in the shapes recorded
 * from CLI 2.1.310 and read them through the provider, with the live process
 * stood in for.
 */

const APP_ID = 'app-agents-panel';
const NATIVE_ID = 'native-agents-panel';

type LiveWork = {
  processLive: boolean;
  runStartedAt: number | null;
  reportedTaskIds: Set<string> | null;
  trackedTaskIds: Set<string>;
};

const NO_PROCESS: LiveWork = { processLive: false, runStartedAt: null, reportedTaskIds: null, trackedTaskIds: new Set() };

async function withChat(run: (chat: {
  session: SessionTranscriptRef;
  writeChat: (rows: object[]) => Promise<void>;
  appendChat: (rows: object[]) => Promise<void>;
  writeAgent: (agentId: string, rows: object[], meta?: object) => Promise<string>;
  appendAgent: (agentId: string, text: string) => Promise<void>;
}) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'claude-agents-panel-'));
  const jsonlPath = path.join(directory, `${NATIVE_ID}.jsonl`);
  const subagents = path.join(directory, NATIVE_ID, 'subagents');
  await mkdir(subagents, { recursive: true });
  const lines = (rows: object[]) => rows.map((row) => `${JSON.stringify(row)}\n`).join('');
  try {
    await run({
      session: { sessionId: APP_ID, providerSessionId: NATIVE_ID, jsonlPath },
      writeChat: (rows) => writeFile(jsonlPath, lines(rows)),
      appendChat: (rows) => appendFile(jsonlPath, lines(rows)),
      writeAgent: async (agentId, rows, meta) => {
        const transcriptPath = path.join(subagents, `agent-${agentId}.jsonl`);
        await writeFile(transcriptPath, lines(rows));
        if (meta) {
          await writeFile(path.join(subagents, `agent-${agentId}.meta.json`), JSON.stringify(meta));
        }
        return transcriptPath;
      },
      appendAgent: (agentId, text) => appendFile(path.join(subagents, `agent-${agentId}.jsonl`), text),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

let rowNumber = 0;
const stamp = (minute: number) => new Date(Date.UTC(2026, 9, 27, 12, minute)).toISOString();
const base = (minute: number) => ({ sessionId: NATIVE_ID, uuid: `row-${(rowNumber += 1)}`, timestamp: stamp(minute) });

/** The tool result that acknowledges a background launch. */
const launch = (minute: number, agentId: string, toolUseId: string, description: string) => ({
  ...base(minute),
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text: 'Async agent launched successfully.' }] }] },
  toolUseResult: { isAsync: true, status: 'async_launched', agentId, description, resolvedModel: 'claude-haiku-5-5' },
});

/** A SendMessage that brought a stopped agent back. */
const resume = (minute: number, agentId: string, toolUseId: string) => ({
  ...base(minute),
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: `Resuming agent ${agentId.slice(0, 7)}` }] },
  toolUseResult: { success: true, message: `Resuming agent ${agentId.slice(0, 7)}`, resumedAgentId: agentId },
});

const notificationText = (agentId: string, status: string, summary: string, toolUseId?: string) =>
  `<task-notification>\n<task-id>${agentId}</task-id>\n${toolUseId ? `<tool-use-id>${toolUseId}</tool-use-id>\n` : ''}<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`;

/** A report as a user turn, which is how one delivered between turns is written. */
const report = (minute: number, agentId: string, status: string, summary: string, toolUseId?: string) => ({
  ...base(minute),
  type: 'user',
  message: { role: 'user', content: notificationText(agentId, status, summary, toolUseId) },
});

/** A report as a queue record, which is how one the session never delivered is written. */
const queuedReport = (minute: number, agentId: string, status: string, summary: string) => ({
  type: 'queue-operation',
  operation: 'enqueue',
  sessionId: NATIVE_ID,
  timestamp: stamp(minute),
  content: notificationText(agentId, status, summary),
});

const toolCall = (minute: number, toolUseId: string, name: string, input: object) => ({
  ...base(minute),
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name, input }] },
});

const toolResult = (minute: number, toolUseId: string, content: string, toolUseResult: object) => ({
  ...base(minute),
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] },
  toolUseResult,
});

const fire = (minute: number, taskId: string, cron: string) => ({
  ...base(minute),
  type: 'system',
  subtype: 'scheduled_task_fire',
  content: 'Running scheduled task',
  taskId,
  cron,
  prompt: 'Heartbeat: check the jobs',
});

/** Rows of an agent's own transcript: its prompt, then steps. */
const agentPrompt = (minute: number, agentId: string) => ({ ...base(minute), agentId, isSidechain: true, type: 'user', message: { role: 'user', content: 'Do the task.' } });
const agentTool = (minute: number, agentId: string, toolUseId: string, name: string, input: object) => ({
  ...base(minute), agentId, isSidechain: true, type: 'assistant',
  message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: toolUseId, name, input }] },
});
const agentToolResult = (minute: number, agentId: string, toolUseId: string, content: string) => ({
  ...base(minute), agentId, isSidechain: true, type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] },
});
const agentText = (minute: number, agentId: string, text: string) => ({
  ...base(minute), agentId, isSidechain: true, type: 'assistant',
  message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }] },
});

const byId = (subagents: SessionSubagent[]) => new Map(subagents.map((agent) => [agent.agentId, agent]));

test('an agent is settled by its latest report unless the live process still runs it', async () => {
  await withChat(async ({ session, writeChat, writeAgent }) => {
    await writeChat([
      launch(1, 'a-done', 'toolu_done', 'Survey the repo'),
      launch(2, 'a-killed', 'toolu_killed', 'Long build'),
      launch(3, 'a-resumed', 'toolu_resumed', 'Encoder diagnosis'),
      launch(4, 'a-orphan', 'toolu_orphan', 'Lost one'),
      report(10, 'a-done', 'completed', 'Agent "Survey the repo" completed', 'toolu_done'),
      report(11, 'a-killed', 'killed', 'Agent "Long build" was stopped by user', 'toolu_killed'),
      report(12, 'a-resumed', 'failed', 'Agent "Encoder diagnosis" failed: usage limit', 'toolu_resumed'),
      // The session ended under it; this report names no call.
      queuedReport(13, 'a-resumed', 'stopped', 'Background agent "Encoder diagnosis" didn\'t finish'),
      resume(14, 'a-resumed', 'toolu_send'),
    ]);
    await writeAgent('a-done', [agentPrompt(1, 'a-done'), agentText(9, 'a-done', 'All done.')], { agentType: 'Explore', description: 'Survey the repo', toolUseId: 'toolu_done', spawnDepth: 1, requestShape: 'background', finished: true });
    await writeAgent('a-resumed', [agentPrompt(3, 'a-resumed'), agentTool(15, 'a-resumed', 'toolu_r1', 'Bash', { command: 'python diag.py', description: 'Run the diagnosis' })], { agentType: 'general-purpose', description: 'Encoder diagnosis', spawnDepth: 1, requestShape: 'background' });

    // No process: nothing can be running, so the resumed agent that never
    // reported again is stopped, and so is the one nothing ever settled.
    const offline = new ClaudeBackgroundWorkProvider({ getLiveWork: () => NO_PROCESS });
    const work = await offline.readSessionWork(session);
    const agents = byId(work.subagents);
    assert.equal(work.processLive, false);
    assert.deepEqual(
      [...agents.values()].map((agent) => [agent.agentId, agent.status]).sort(),
      [['a-done', 'completed'], ['a-killed', 'stopped'], ['a-orphan', 'stopped'], ['a-resumed', 'stopped']],
    );
    assert.equal(agents.get('a-done')?.agentType, 'Explore');
    assert.equal(agents.get('a-done')?.summary, 'Agent "Survey the repo" completed');
    assert.equal(agents.get('a-done')?.lastActivity, 'All done.');
    assert.equal(agents.get('a-resumed')?.resumeCount, 1);
    assert.equal(agents.get('a-resumed')?.lastActivity, 'Bash · Run the diagnosis');
    assert.equal(agents.get('a-resumed')?.model, 'claude-opus-5-5', 'the model that ran, not the alias asked for');
    assert.equal(agents.get('a-orphan')?.activityCount, 0);

    // The live process lists the resumed agent among its tasks: it runs, and
    // the reports from before its resume say nothing about it.
    const live = new ClaudeBackgroundWorkProvider({
      getLiveWork: (sessionId) => sessionId === APP_ID
        ? { processLive: true, runStartedAt: Date.parse(stamp(13)), reportedTaskIds: new Set(['a-resumed']), trackedTaskIds: new Set() }
        : NO_PROCESS,
    });
    const liveWork = await live.readSessionWork(session);
    assert.equal(liveWork.processLive, true);
    assert.equal(liveWork.subagents[0]?.agentId, 'a-resumed', 'running agents come first');
    assert.equal(liveWork.subagents[0]?.status, 'running');
    assert.equal(liveWork.subagents[0]?.stoppable, true);
    assert.equal(byId(liveWork.subagents).get('a-orphan')?.status, 'stopped', 'a live process that does not list it is not running it');
  });
});

test('without a reported task set, an agent the live run launched or resumed is running', async () => {
  await withChat(async ({ session, writeChat }) => {
    await writeChat([
      launch(1, 'a-old', 'toolu_old', 'From an earlier process'),
      launch(20, 'a-new', 'toolu_new', 'From this process'),
    ]);
    const provider = new ClaudeBackgroundWorkProvider({
      getLiveWork: () => ({ processLive: true, runStartedAt: Date.parse(stamp(15)), reportedTaskIds: null, trackedTaskIds: new Set() }),
    });
    const agents = byId((await provider.readSessionWork(session)).subagents);
    assert.equal(agents.get('a-new')?.status, 'running');
    assert.equal(agents.get('a-new')?.stoppable, false, 'nothing in the process names it, so nothing can stop it');
    assert.equal(agents.get('a-old')?.status, 'stopped');
  });
});

test('copies of old reports and rows of another session do not settle an agent', async () => {
  await withChat(async ({ session, writeChat }) => {
    await writeChat([
      launch(1, 'a-one', 'toolu_one', 'One'),
      report(2, 'a-one', 'failed', 'failed early', 'toolu_one'),
      resume(3, 'a-one', 'toolu_send'),
      // The CLI logs the requests it sends, with copies of earlier turns.
      { type: 'api-request-blob', message: { role: 'user', content: notificationText('a-one', 'completed', 'old copy') } },
      { ...report(4, 'a-one', 'completed', 'from the fork source'), sessionId: 'another-session' },
    ]);
    const provider = new ClaudeBackgroundWorkProvider({
      getLiveWork: () => ({ processLive: true, runStartedAt: Date.parse(stamp(0)), reportedTaskIds: new Set(['a-one']), trackedTaskIds: new Set() }),
    });
    const [agent] = (await provider.readSessionWork(session)).subagents;
    assert.equal(agent?.status, 'running');
    assert.equal(agent?.summary, 'failed early');
  });
});

test('an agent\'s summary follows its transcript as it grows, a half-written line included', async () => {
  await withChat(async ({ session, writeChat, writeAgent, appendAgent }) => {
    await writeChat([launch(1, 'a-grow', 'toolu_grow', 'Grow')]);
    await writeAgent('a-grow', [agentPrompt(1, 'a-grow'), agentTool(2, 'a-grow', 'toolu_g1', 'Read', { file_path: '/repo/src/index.ts' })]);
    const provider = new ClaudeBackgroundWorkProvider({ getLiveWork: () => NO_PROCESS });

    let [agent] = (await provider.readSessionWork(session)).subagents;
    assert.equal(agent?.activityCount, 1);
    assert.equal(agent?.lastActivity, 'Read · index.ts');
    assert.equal(agent?.startedAt, stamp(1));

    const next = JSON.stringify(agentText(3, 'a-grow', 'Found the entry point.'));
    await appendAgent('a-grow', next.slice(0, 20));
    [agent] = (await provider.readSessionWork(session)).subagents;
    assert.equal(agent?.activityCount, 1, 'a line still being written is not read yet');

    await appendAgent('a-grow', `${next.slice(20)}\n`);
    [agent] = (await provider.readSessionWork(session)).subagents;
    assert.equal(agent?.activityCount, 2);
    assert.equal(agent?.lastActivity, 'Found the entry point.');
    assert.equal(agent?.lastActivityAt, stamp(3));
  });
});

test('a timeline cursor returns only the entries added or changed since', async () => {
  await withChat(async ({ session, writeChat, writeAgent, appendAgent }) => {
    await writeChat([launch(1, 'a-live', 'toolu_live', 'Live one')]);
    const transcriptPath = await writeAgent('a-live', [
      agentPrompt(1, 'a-live'),
      agentText(2, 'a-live', 'Starting.'),
      agentTool(3, 'a-live', 'toolu_l1', 'Bash', { command: 'npm test' }),
    ]);
    const provider = new ClaudeBackgroundWorkProvider({ getLiveWork: () => NO_PROCESS });

    const first = await provider.readSubagentTimeline(session, 'a-live');
    assert.ok(first);
    assert.equal(first.reset, true);
    assert.equal(first.activityCount, 2);
    assert.deepEqual(first.entries.map((entry) => [entry.index, entry.kind]), [[0, 'text'], [1, 'tool']]);
    assert.equal(first.entries[1]?.toolResult, undefined);
    assert.equal(first.agent.description, 'Live one');
    assert.equal(first.prompt, 'Do the task.');

    // The command's result lands and the agent writes on.
    await appendAgent('a-live', `${JSON.stringify(agentToolResult(4, 'a-live', 'toolu_l1', '12 passing'))}\n${JSON.stringify(agentText(5, 'a-live', 'Tests pass.'))}\n`);
    const second = await provider.readSubagentTimeline(session, 'a-live', first.cursor);
    assert.ok(second);
    assert.equal(second.reset, false);
    assert.equal(second.activityCount, 3);
    assert.deepEqual(second.entries.map((entry) => entry.index), [1, 2]);
    assert.deepEqual(second.entries[0]?.toolResult, { content: '12 passing', isError: false });

    const unchanged = await provider.readSubagentTimeline(session, 'a-live', second.cursor);
    assert.deepEqual(unchanged?.entries, []);
    assert.equal(unchanged?.reset, false);

    // A cursor from elsewhere, or a transcript replaced under it, starts over.
    assert.equal((await provider.readSubagentTimeline(session, 'a-live', 'zzz.3'))?.reset, true);
    await writeFile(`${transcriptPath}.new`, `${JSON.stringify(agentText(6, 'a-live', 'Rewritten.'))}\n`);
    await rename(`${transcriptPath}.new`, transcriptPath);
    const rewritten = await provider.readSubagentTimeline(session, 'a-live', second.cursor);
    assert.equal(rewritten?.reset, true);
    assert.deepEqual(rewritten?.entries.map((entry) => entry.content), ['Rewritten.']);

    assert.equal(await provider.readSubagentTimeline(session, 'a-missing'), null);
  });
});

test('heartbeats follow CronCreate, CronDelete, CronList and their fires', async () => {
  await withChat(async ({ session, writeChat, appendChat }) => {
    await writeChat([
      toolCall(1, 'toolu_c1', 'CronCreate', { cron: '7,37 * * * *', prompt: 'Heartbeat: check the jobs' }),
      toolResult(1, 'toolu_c1', 'Scheduled recurring job job-one', { id: 'job-one', humanSchedule: '7,37 * * * *', recurring: true, durable: false, nextFireAt: 1 }),
      toolCall(2, 'toolu_c2', 'CronCreate', { cron: '30 14 27 10 *', prompt: 'One reminder', recurring: false }),
      toolResult(2, 'toolu_c2', 'Scheduled one-shot job job-two', { id: 'job-two', humanSchedule: 'Oct 27 at 2:30 PM', recurring: false, durable: false, nextFireAt: 2 }),
      toolCall(3, 'toolu_c3', 'CronCreate', { cron: '0 9 * * 1-5', prompt: 'Morning check' }),
      toolResult(3, 'toolu_c3', 'Scheduled recurring job job-three', { id: 'job-three', humanSchedule: 'Weekdays at 9:00 AM', recurring: true, durable: false, nextFireAt: 3 }),
      toolCall(4, 'toolu_d3', 'CronDelete', { id: 'job-three' }),
      toolResult(4, 'toolu_d3', 'Cancelled job-three', { id: 'job-three' }),
      fire(7, 'job-one', '7,37 * * * *'),
      fire(37, 'job-one', '7,37 * * * *'),
      fire(38, 'job-two', '30 14 27 10 *'),
    ]);
    const provider = new ClaudeBackgroundWorkProvider({ getLiveWork: () => NO_PROCESS, now: () => Date.parse(stamp(40)) });

    let { heartbeats } = await provider.readSessionWork(session);
    assert.deepEqual(heartbeats.map((heartbeat) => heartbeat.id), ['job-one'], 'the one-shot fired and is gone, the deleted one too');
    assert.equal(heartbeats[0]?.schedule, '7,37 * * * *');
    assert.equal(heartbeats[0]?.humanSchedule, undefined, 'a wording that only repeats the expression is dropped');
    assert.equal(heartbeats[0]?.prompt, 'Heartbeat: check the jobs');
    assert.equal(heartbeats[0]?.fireCount, 2);
    assert.equal(heartbeats[0]?.lastFiredAt, stamp(37));
    assert.equal(heartbeats[0]?.createdAt, stamp(1));

    // CronList is the CLI's own word: it knows a job this file never saw made.
    await appendChat([
      toolCall(41, 'toolu_l1', 'CronList', {}),
      toolResult(41, 'toolu_l1', '2 jobs', { jobs: [
        { id: 'job-one', cron: '7,37 * * * *', humanSchedule: '7,37 * * * *', prompt: 'Heartbeat: check the jobs', recurring: true, durable: false, nextFireAt: Date.parse(stamp(50)) },
        { id: 'job-restored', cron: '7,37 * * * *', humanSchedule: '7,37 * * * *', prompt: 'Heartbeat from before the restart', recurring: true, durable: false, nextFireAt: Date.parse(stamp(51)) },
      ] }),
    ]);
    ({ heartbeats } = await provider.readSessionWork(session));
    assert.deepEqual(heartbeats.map((heartbeat) => [heartbeat.id, heartbeat.nextFireAt]), [
      ['job-one', Date.parse(stamp(50))],
      ['job-restored', Date.parse(stamp(51))],
    ]);
    assert.equal(heartbeats[0]?.fireCount, 2, 'what only the transcript knows is kept');
  });
});

test('a heartbeat\'s next fire carries the shift the CLI gave the job', async () => {
  await withChat(async ({ session, writeChat }) => {
    // Local times, as the CLI schedules in the machine's own zone: the job
    // runs 7 minutes after each :07 and :37.
    const local = (hour: number, minute: number) => new Date(2026, 9, 27, hour, minute).getTime();
    await writeChat([
      toolCall(1, 'toolu_c1', 'CronCreate', { cron: '7,37 * * * *', prompt: 'Heartbeat' }),
      toolResult(1, 'toolu_c1', 'Scheduled', { id: 'job-shifted', humanSchedule: '7,37 * * * *', recurring: true, durable: false, nextFireAt: local(13, 14) + 0.5 }),
    ]);

    const before = new ClaudeBackgroundWorkProvider({ getLiveWork: () => NO_PROCESS, now: () => local(13, 10) });
    assert.equal((await before.readSessionWork(session)).heartbeats[0]?.nextFireAt, local(13, 14) + 0.5, 'the CLI\'s own time while it is ahead');

    const after = new ClaudeBackgroundWorkProvider({ getLiveWork: () => NO_PROCESS, now: () => local(13, 50) });
    assert.equal((await after.readSessionWork(session)).heartbeats[0]?.nextFireAt, local(14, 14) + 0.5);
  });
});

test('a recurring heartbeat past the CLI\'s seven-day limit is no longer listed', async () => {
  await withChat(async ({ session, writeChat }) => {
    await writeChat([
      toolCall(1, 'toolu_c1', 'CronCreate', { cron: '7 * * * *', prompt: 'Hourly' }),
      toolResult(1, 'toolu_c1', 'Scheduled', { id: 'job-old', humanSchedule: 'Every hour at :07', recurring: true, durable: false, nextFireAt: 1 }),
    ]);
    const eightDaysLater = Date.parse(stamp(1)) + 8 * 24 * 60 * 60 * 1000;
    const provider = new ClaudeBackgroundWorkProvider({ getLiveWork: () => NO_PROCESS, now: () => eightDaysLater });
    assert.deepEqual((await provider.readSessionWork(session)).heartbeats, []);
  });
});

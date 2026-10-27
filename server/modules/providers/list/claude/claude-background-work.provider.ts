import fsp from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

import type { IProviderBackgroundWork } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  SessionBackgroundWork,
  SessionHeartbeat,
  SessionSubagent,
  SessionTranscriptRef,
  SubagentActivity,
  SubagentTimelinePage,
} from '@/shared/types.js';
import { isClaudeNonTurnMessageRow, readObjectRecord, truncateSubagentActivity } from '@/shared/utils.js';
import { getClaudeSDKLiveWork } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import {
  readClaudeSubagentMeta,
  readClaudeSubagentRow,
  readTaggedValue,
  readTaskNotificationTexts,
} from '@/modules/providers/list/claude/claude-sessions.provider.js';

/** Newest timeline entries a first read sends; the panel says how many earlier ones it left out. */
const MAX_TIMELINE_ENTRIES = 200;
/**
 * Agent timelines kept folded in memory, least recently read evicted first.
 * One costs roughly what its agent recorded once trimmed for transport —
 * under a megabyte for a long run — and only the agent open in the panel is
 * read this way, so a handful covers several open chats.
 */
const MAX_CACHED_TIMELINES = 6;
/** Chats whose transcripts stay indexed between reads. */
const MAX_CACHED_CHATS = 12;
/** Agent transcripts whose one-line summary stays folded between reads. */
const MAX_CACHED_SUMMARIES = 400;
/** How much of a file one read step takes in. */
const READ_CHUNK_BYTES = 1024 * 1024;
/** The longest description of an agent's newest step. */
const MAX_ACTIVITY_LINE = 160;
/** The longest heartbeat prompt sent to the page, as the SDK caps its own cron summaries. */
const MAX_HEARTBEAT_PROMPT = 1000;
/** The longest agent task prompt sent with its timeline. */
const MAX_AGENT_PROMPT = 4000;
/** The CLI deletes a recurring job after one last fire once it is this old. */
const RECURRING_JOB_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** The furthest the CLI shifts a recurring job's fires past its schedule. */
const MAX_FIRE_SHIFT_MS = 30 * 60 * 1000;
/**
 * What a chat-transcript line must contain to say anything about agents or
 * heartbeats: a launch or a foreground agent's result names `agentId`, a
 * resume `resumedAgentId`; reports are `<task-notification>`s; heartbeats are
 * `Cron…` calls and results and `scheduled_task_fire` rows. Every other line
 * — nearly all of a long chat's file — is skipped without parsing.
 */
const CHAT_LINE_MARKERS = ['gentId', 'task-notification', 'Cron', 'humanSchedule', 'scheduled_task_fire'];
/** An agent transcript as the CLI names it: `agent-<agentId>.jsonl`. */
const AGENT_TRANSCRIPT_NAME = /^agent-([A-Za-z0-9_-]+)\.jsonl$/;

/** What a JsonlTail read hands each appended row to, in file order. */
type JsonlVisitor = {
  /** Called before any row when the rows start from the top of the file: whatever was folded from earlier reads is void. */
  restart: () => void;
  /** Sees each raw line first, so a reader that wants few rows skips parsing the rest; it may depend on the rows visited before. */
  accept?: (line: string) => boolean;
  row: (row: AnyRecord) => void;
};

/**
 * Reads the rows appended to a JSONL file since the previous read, so a file
 * the CLI keeps writing is parsed once instead of on every poll. A line still
 * being written waits for its newline.
 */
class JsonlTail {
  private identity: string | null = null;
  private offset = 0;
  private remainder: Buffer = Buffer.alloc(0);

  constructor(private readonly filePath: string) {}

  /**
   * Hands the rows added since the last read to `visitor`, restarting from
   * the top on the first read and when the file was replaced or cut short
   * since. Returns false when the file cannot be read.
   */
  async read(visitor: JsonlVisitor): Promise<boolean> {
    let handle: FileHandle;
    try {
      handle = await fsp.open(this.filePath, 'r');
    } catch {
      return false;
    }

    try {
      const stats = await handle.stat();
      const identity = `${stats.dev}:${stats.ino}`;
      if (identity !== this.identity || stats.size < this.offset) {
        this.identity = identity;
        this.offset = 0;
        this.remainder = Buffer.alloc(0);
        visitor.restart();
      }

      while (this.offset < stats.size) {
        const chunk = Buffer.alloc(Math.min(READ_CHUNK_BYTES, stats.size - this.offset));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, this.offset);
        if (bytesRead <= 0) {
          break;
        }
        this.offset += bytesRead;
        const data = this.remainder.length > 0
          ? Buffer.concat([this.remainder, chunk.subarray(0, bytesRead)])
          : chunk.subarray(0, bytesRead);
        // Split on bytes, not on decoded text: a chunk can end inside a
        // multi-byte character, which only a whole line decodes correctly.
        const lastNewline = data.lastIndexOf(0x0a);
        if (lastNewline < 0) {
          this.remainder = Buffer.from(data);
          continue;
        }
        this.remainder = Buffer.from(data.subarray(lastNewline + 1));
        for (const line of data.toString('utf8', 0, lastNewline).split('\n')) {
          if (!line.trim() || (visitor.accept && !visitor.accept(line))) {
            continue;
          }
          let row: AnyRecord;
          try {
            row = JSON.parse(line) as AnyRecord;
          } catch {
            // A malformed line, e.g. two writers interleaving.
            continue;
          }
          visitor.row(row);
        }
      }
      return true;
    } finally {
      await handle.close();
    }
  }
}

/** Moves a cache entry to the most recently used end, adding it when new, and evicts the least recently used past `capacity`. */
function touchCacheEntry<V>(cache: Map<string, V>, key: string, value: V, capacity: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > capacity) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
}

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

/** Collapses whitespace and cuts a string to `limit` characters. */
function clipLine(text: string, limit = MAX_ACTIVITY_LINE): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

//----------------- CHAT TRANSCRIPT INDEX ------------

/** A subagent's launch and resumes as the chat's transcript records them. */
type AgentRecord = {
  toolUseId?: string;
  description?: string;
  model?: string;
  background: boolean;
  /** Position of its latest launch or resume, so an older report can be told from a newer one. */
  startSeq: number;
  launchedAt?: string;
  lastStartAt?: string;
  resumeCount: number;
};

/** The latest word a chat's transcript has on one task: a `<task-notification>`, or a foreground agent's own result. */
type TaskReport = {
  seq: number;
  status: SessionSubagent['status'];
  summary: string;
};

/** A heartbeat as the transcript has it, with the CLI's latest word on its next fire. */
type HeartbeatRecord = Omit<SessionHeartbeat, 'nextFireAt'> & {
  reportedNextFireAt?: number;
};

/** A cron tool call waiting for its result row. */
type PendingCronCall =
  | { tool: 'CronCreate'; schedule: string; prompt: string; recurring: boolean }
  | { tool: 'CronDelete'; jobId: string }
  | { tool: 'CronList' };

/** What one chat's transcript says about its agents and heartbeats, folded as the file grows. */
type ChatIndex = {
  tail: JsonlTail;
  providerSessionId: string;
  /** Rows folded so far; each row's number orders launches, resumes and reports. */
  seq: number;
  agents: Map<string, AgentRecord>;
  reports: Map<string, TaskReport>;
  heartbeats: Map<string, HeartbeatRecord>;
  pendingCronCalls: Map<string, PendingCronCall>;
};

function createChatIndex(session: SessionTranscriptRef): ChatIndex {
  return {
    tail: new JsonlTail(session.jsonlPath),
    providerSessionId: session.providerSessionId,
    seq: 0,
    agents: new Map(),
    reports: new Map(),
    heartbeats: new Map(),
    pendingCronCalls: new Map(),
  };
}

function resetChatIndex(index: ChatIndex): void {
  index.seq = 0;
  index.agents.clear();
  index.reports.clear();
  index.heartbeats.clear();
  index.pendingCronCalls.clear();
}

/** Whether a raw chat-transcript line can matter to the index; see CHAT_LINE_MARKERS. */
function chatLineMatters(index: ChatIndex, line: string): boolean {
  if (CHAT_LINE_MARKERS.some((marker) => line.includes(marker))) {
    return true;
  }
  // A CronDelete's result row names only the call it answers.
  for (const toolUseId of index.pendingCronCalls.keys()) {
    if (line.includes(toolUseId)) {
      return true;
    }
  }
  return false;
}

/**
 * A report's status in the panel's words. The CLI writes `killed` for a task
 * the user stopped and `stopped` for one whose session ended under it; neither
 * failed. An empty status is a completion, as history reads it.
 */
function readReportStatus(status: string): SessionSubagent['status'] {
  if (status === '' || status === 'completed') {
    return 'completed';
  }
  return status === 'killed' || status === 'stopped' ? 'stopped' : 'failed';
}

function readJobPrompt(prompt: unknown): string {
  const text = typeof prompt === 'string' ? prompt : '';
  return text.length > MAX_HEARTBEAT_PROMPT ? `${text.slice(0, MAX_HEARTBEAT_PROMPT)}…` : text;
}

/** The CLI's wording of a schedule, unless it merely repeats the expression (it does for one it cannot word). */
function readHumanSchedule(humanSchedule: unknown, schedule: string): string | undefined {
  const text = readString(humanSchedule);
  return text && text !== schedule ? text : undefined;
}

function readEpochMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function applyCronResult(index: ChatIndex, call: PendingCronCall, result: AnyRecord, timestamp: string | undefined): void {
  if (call.tool === 'CronCreate') {
    const id = readString(result.id);
    if (!id) {
      return;
    }
    index.heartbeats.set(id, {
      id,
      schedule: call.schedule,
      humanSchedule: readHumanSchedule(result.humanSchedule, call.schedule),
      prompt: readJobPrompt(call.prompt),
      recurring: typeof result.recurring === 'boolean' ? result.recurring : call.recurring,
      createdAt: timestamp,
      fireCount: 0,
      reportedNextFireAt: readEpochMs(result.nextFireAt),
    });
    return;
  }

  if (call.tool === 'CronDelete') {
    index.heartbeats.delete(readString(result.id) ?? call.jobId);
    return;
  }

  // CronList is the CLI's own word on which jobs exist: it replaces what the
  // transcript was read to have, keeping what only the transcript knows.
  if (!Array.isArray(result.jobs)) {
    return;
  }
  const listed = new Map<string, HeartbeatRecord>();
  for (const job of result.jobs as AnyRecord[]) {
    const id = readString(job?.id);
    if (!id) {
      continue;
    }
    const known = index.heartbeats.get(id);
    const schedule = readString(job.cron) ?? known?.schedule ?? '';
    listed.set(id, {
      id,
      schedule,
      humanSchedule: readHumanSchedule(job.humanSchedule, schedule) ?? known?.humanSchedule,
      prompt: typeof job.prompt === 'string' ? readJobPrompt(job.prompt) : known?.prompt ?? '',
      recurring: typeof job.recurring === 'boolean' ? job.recurring : known?.recurring ?? true,
      createdAt: known?.createdAt,
      lastFiredAt: known?.lastFiredAt,
      fireCount: known?.fireCount ?? 0,
      reportedNextFireAt: readEpochMs(job.nextFireAt) ?? known?.reportedNextFireAt,
    });
  }
  index.heartbeats = listed;
}

/** A `scheduled_task_fire` row: the job fired, and a one-shot job is gone after it. */
function recordHeartbeatFire(index: ChatIndex, row: AnyRecord, timestamp: string | undefined): void {
  const id = String(row.taskId);
  let heartbeat = index.heartbeats.get(id);
  if (!heartbeat) {
    // Created where this file does not reach (a fork, a cleared transcript):
    // the fire row carries enough to list it. A `/loop` wakeup is a one-shot.
    heartbeat = {
      id,
      schedule: String(row.cron ?? ''),
      prompt: readJobPrompt(row.prompt),
      recurring: row.taskKind !== 'loop',
      fireCount: 0,
    };
    index.heartbeats.set(id, heartbeat);
  }
  heartbeat.lastFiredAt = timestamp ?? heartbeat.lastFiredAt;
  heartbeat.fireCount += 1;
  if (!heartbeat.recurring) {
    index.heartbeats.delete(id);
  }
}

function recordAgentResult(index: ChatIndex, toolUseId: string, result: AnyRecord, isError: boolean, seq: number, timestamp: string | undefined): void {
  const agentId = String(result.agentId);
  const background = result.isAsync === true || result.status === 'async_launched';
  const agent = index.agents.get(agentId) ?? { background, startSeq: seq, resumeCount: 0 };
  agent.toolUseId = toolUseId;
  agent.background = background;
  agent.description = readString(result.description) ?? agent.description;
  agent.model = readString(result.resolvedModel) ?? agent.model;
  agent.startSeq = seq;
  agent.launchedAt = agent.launchedAt ?? timestamp;
  agent.lastStartAt = timestamp ?? agent.lastStartAt;
  index.agents.set(agentId, agent);
  if (!background) {
    // A foreground agent's tool result arrives when it is done, and is its outcome.
    index.reports.set(agentId, { seq, status: isError || result.status === 'failed' ? 'failed' : 'completed', summary: '' });
  }
}

function recordAgentResume(index: ChatIndex, agentId: string, seq: number, timestamp: string | undefined): void {
  const agent = index.agents.get(agentId) ?? { background: true, startSeq: seq, resumeCount: 0 };
  agent.resumeCount += 1;
  agent.startSeq = seq;
  agent.lastStartAt = timestamp ?? agent.lastStartAt;
  index.agents.set(agentId, agent);
}

/** Folds one chat-transcript row into the index. */
function foldChatRow(index: ChatIndex, row: AnyRecord): void {
  // Copies of earlier rows the CLI logs with its API requests would replay
  // old reports after newer launches; rows of another session (a fork's
  // source) are not this chat's.
  if (isClaudeNonTurnMessageRow(row) || (typeof row.sessionId === 'string' && row.sessionId !== index.providerSessionId)) {
    return;
  }
  index.seq += 1;
  const seq = index.seq;
  const timestamp = readString(row.timestamp);

  if (row.type === 'system' && row.subtype === 'scheduled_task_fire' && typeof row.taskId === 'string') {
    recordHeartbeatFire(index, row, timestamp);
    return;
  }

  // A task that resumes or first stops and later completes reports more than
  // once; the last word is kept.
  for (const text of readTaskNotificationTexts(row)) {
    if (!text.trimStart().startsWith('<task-notification>')) {
      continue;
    }
    const taskId = readTaggedValue(text, 'task-id');
    if (taskId) {
      index.reports.set(taskId, {
        seq,
        status: readReportStatus(readTaggedValue(text, 'status')),
        summary: readTaggedValue(text, 'summary'),
      });
    }
  }

  const content = row.message?.content;
  if (!Array.isArray(content)) {
    return;
  }

  if (row.type === 'assistant') {
    for (const part of content as AnyRecord[]) {
      if (part?.type !== 'tool_use' || typeof part.id !== 'string') {
        continue;
      }
      const input = readObjectRecord(part.input) ?? {};
      if (part.name === 'CronCreate') {
        index.pendingCronCalls.set(part.id, {
          tool: 'CronCreate',
          schedule: String(input.cron ?? ''),
          prompt: String(input.prompt ?? ''),
          recurring: input.recurring !== false,
        });
      } else if (part.name === 'CronDelete') {
        index.pendingCronCalls.set(part.id, { tool: 'CronDelete', jobId: String(input.id ?? '') });
      } else if (part.name === 'CronList') {
        index.pendingCronCalls.set(part.id, { tool: 'CronList' });
      }
    }
    return;
  }

  if (row.type !== 'user') {
    return;
  }
  const result = readObjectRecord(row.toolUseResult);
  for (const part of content as AnyRecord[]) {
    if (part?.type !== 'tool_result' || typeof part.tool_use_id !== 'string') {
      continue;
    }
    const isError = part.is_error === true;
    const cronCall = index.pendingCronCalls.get(part.tool_use_id);
    if (cronCall) {
      index.pendingCronCalls.delete(part.tool_use_id);
      if (result && !isError) {
        applyCronResult(index, cronCall, result, timestamp);
      }
      continue;
    }
    if (readString(result?.agentId)) {
      recordAgentResult(index, part.tool_use_id, result!, isError, seq, timestamp);
    } else if (readString(result?.resumedAgentId)) {
      recordAgentResume(index, String(result!.resumedAgentId), seq, timestamp);
    }
  }
}

// ---------------------------
//----------------- HEARTBEAT SCHEDULES ------------

/** A parsed five-field cron expression: the values each field allows. */
type CronSchedule = {
  minutes: number[];
  hours: number[];
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  /** Whether day-of-month and day-of-week were given (not `*`): cron matches either one when both are. */
  daysRestricted: boolean;
  weekdaysRestricted: boolean;
};

function parseCronField(field: string, min: number, max: number): number[] | null {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const match = /^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part.trim());
    if (!match) {
      return null;
    }
    const step = match[4] ? Number(match[4]) : 1;
    const start = match[1] ? min : Number(match[2]);
    const end = match[1] ? max : match[3] !== undefined ? Number(match[3]) : match[4] ? max : start;
    if (step < 1 || start < min || end > max || start > end) {
      return null;
    }
    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }
  return [...values].sort((left, right) => left - right);
}

/** Parses a numeric five-field cron expression, or null for anything else. */
function parseCronSchedule(expression: string): CronSchedule | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }
  const minutes = parseCronField(fields[0], 0, 59);
  const hours = parseCronField(fields[1], 0, 23);
  const days = parseCronField(fields[2], 1, 31);
  const months = parseCronField(fields[3], 1, 12);
  const weekdays = parseCronField(fields[4], 0, 7);
  if (!minutes || !hours || !days || !months || !weekdays) {
    return null;
  }
  return {
    minutes,
    hours,
    days: new Set(days),
    months: new Set(months),
    // 7 is Sunday too.
    weekdays: new Set(weekdays.map((weekday) => weekday % 7)),
    daysRestricted: fields[2] !== '*',
    weekdaysRestricted: fields[4] !== '*',
  };
}

/** The first minute after `afterMs` that the schedule matches, in this machine's local time; null when none within a year. */
function nextCronMatch(schedule: CronSchedule, afterMs: number): number | null {
  const earliest = new Date(afterMs);
  earliest.setSeconds(0, 0);
  earliest.setMinutes(earliest.getMinutes() + 1);
  for (let dayOffset = 0; dayOffset <= 366; dayOffset += 1) {
    const day = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate() + dayOffset);
    const dayMatches = schedule.days.has(day.getDate());
    const weekdayMatches = schedule.weekdays.has(day.getDay());
    const matchesDay = schedule.daysRestricted && schedule.weekdaysRestricted
      ? dayMatches || weekdayMatches
      : dayMatches && weekdayMatches;
    if (!schedule.months.has(day.getMonth() + 1) || !matchesDay) {
      continue;
    }
    for (const hour of schedule.hours) {
      for (const minute of schedule.minutes) {
        const time = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).getTime();
        if (time >= earliest.getTime()) {
          return time;
        }
      }
    }
  }
  return null;
}

/**
 * When a recurring heartbeat fires next. The CLI shifts each job's fires by an
 * offset of its own — late by up to half its period, at most 30 minutes — so
 * the offset is read off a fire time the CLI reported or the transcript
 * recorded (the schedule's last match at or before it), and carried to the
 * next match after now.
 */
function predictNextFire(expression: string, knownFireAt: number | undefined, now: number): number | undefined {
  const schedule = parseCronSchedule(expression);
  if (!schedule) {
    return undefined;
  }
  let offset = 0;
  if (knownFireAt !== undefined) {
    let nominal: number | null = null;
    let match = nextCronMatch(schedule, knownFireAt - MAX_FIRE_SHIFT_MS - 60_000);
    while (match !== null && match <= knownFireAt) {
      nominal = match;
      match = nextCronMatch(schedule, match);
    }
    offset = nominal === null ? 0 : knownFireAt - nominal;
  }
  const next = nextCronMatch(schedule, now - offset);
  return next === null ? undefined : next + offset;
}

/** The heartbeats a chat's transcript says exist now, soonest first. */
function listHeartbeats(index: ChatIndex, now: number): SessionHeartbeat[] {
  const heartbeats: SessionHeartbeat[] = [];
  for (const { reportedNextFireAt, ...heartbeat } of index.heartbeats.values()) {
    const createdAt = Date.parse(heartbeat.createdAt ?? '');
    // Past its age limit the CLI fires a recurring job one last time and
    // deletes it; the transcript does not record the deletion.
    if (heartbeat.recurring && Number.isFinite(createdAt) && now - createdAt > RECURRING_JOB_MAX_AGE_MS + MAX_FIRE_SHIFT_MS) {
      continue;
    }
    let nextFireAt = reportedNextFireAt !== undefined && reportedNextFireAt > now ? reportedNextFireAt : undefined;
    if (nextFireAt === undefined && heartbeat.recurring) {
      // The CLI's own time carries the job's exact shift; a recorded fire can
      // be later than its shift, as a job only fires between turns.
      const lastFiredAt = Date.parse(heartbeat.lastFiredAt ?? '');
      const knownFireAt = reportedNextFireAt ?? (Number.isFinite(lastFiredAt) ? lastFiredAt : undefined);
      nextFireAt = predictNextFire(heartbeat.schedule, knownFireAt, now);
    }
    heartbeats.push({ ...heartbeat, ...(nextFireAt !== undefined ? { nextFireAt } : {}) });
  }
  return heartbeats.sort((left, right) => (left.nextFireAt ?? Infinity) - (right.nextFireAt ?? Infinity));
}

// ---------------------------
//----------------- SUBAGENT TRANSCRIPTS ------------

/** What the agents list shows of one agent's own transcript, folded as it grows. */
type SubagentSummary = {
  tail: JsonlTail;
  /** The task it was given: the user prompt its transcript opens with. */
  prompt?: string;
  activityCount: number;
  startedAt?: string;
  lastActivityAt?: string;
  lastActivity?: string;
  model?: string;
};

/** One agent's timeline, folded as its transcript grows; `revisions[i]` is when entry i last changed. */
type SubagentTimeline = {
  tail: JsonlTail;
  /** Changes whenever the timeline is rebuilt from the top, which voids every cursor handed out before. */
  generation: string;
  revision: number;
  entries: SubagentActivity[];
  revisions: number[];
  /** Tool calls still waiting for their result, by tool-use id. */
  pendingToolIndexes: Map<string, number>;
};

/** One line saying what a step was: a tool call and what it acts on, or the start of what the agent wrote. */
function describeActivity(activity: SubagentActivity): string {
  if (activity.kind === 'thinking') {
    return 'Thinking';
  }
  if (activity.kind === 'text') {
    return clipLine(activity.content ?? '');
  }
  const input = readObjectRecord(activity.toolInput) ?? {};
  const filePath = readString(input.file_path) ?? readString(input.notebook_path);
  // `message` is what an agent hands back (SubagentHandback) or sends on.
  const subject = filePath
    ? path.basename(filePath)
    : [input.description, input.command, input.pattern, input.url, input.query, input.path, input.subject, input.summary, input.prompt, input.message]
      .map(readString)
      .find(Boolean);
  const toolName = activity.toolName || 'Tool';
  return clipLine(subject ? `${toolName} · ${subject.split('\n', 1)[0]}` : toolName);
}

function readSubagentRowSafely(row: AnyRecord): ReturnType<typeof readClaudeSubagentRow> {
  try {
    return readClaudeSubagentRow(row);
  } catch {
    // A row with an unexpected shape adds nothing.
    return null;
  }
}

/** The text of a user turn that is a prompt rather than tool results, or '' when it is not one. */
function readPromptText(row: AnyRecord): string {
  if (row.type !== 'user' || row.message?.role !== 'user') {
    return '';
  }
  const content = row.message.content;
  if (typeof content === 'string') {
    return content;
  }
  return Array.isArray(content)
    ? content.filter((part: AnyRecord) => part?.type === 'text').map((part: AnyRecord) => String(part.text ?? '')).join('\n')
    : '';
}

function foldSummaryRow(summary: SubagentSummary, row: AnyRecord): void {
  const reading = readSubagentRowSafely(row);
  if (!reading) {
    return;
  }
  if (summary.prompt === undefined && summary.activityCount === 0) {
    const prompt = readPromptText(row).trim();
    if (prompt) {
      summary.prompt = prompt.length > MAX_AGENT_PROMPT ? `${prompt.slice(0, MAX_AGENT_PROMPT)}…` : prompt;
    }
  }
  if (reading.timestamp) {
    summary.startedAt = summary.startedAt ?? reading.timestamp;
    summary.lastActivityAt = reading.timestamp;
  }
  summary.model = reading.model ?? summary.model;
  for (const activity of reading.activities) {
    summary.activityCount += 1;
    summary.lastActivity = describeActivity(activity);
  }
}

function newTimelineGeneration(): string {
  return Math.random().toString(36).slice(2, 10) || 'g';
}

function resetTimeline(timeline: SubagentTimeline): void {
  timeline.generation = newTimelineGeneration();
  timeline.revision = 0;
  timeline.entries = [];
  timeline.revisions = [];
  timeline.pendingToolIndexes.clear();
}

function foldTimelineRow(timeline: SubagentTimeline, row: AnyRecord): void {
  const reading = readSubagentRowSafely(row);
  if (!reading) {
    return;
  }
  for (const activity of reading.activities) {
    const index = timeline.entries.length;
    timeline.entries.push(truncateSubagentActivity(activity));
    timeline.revision += 1;
    timeline.revisions.push(timeline.revision);
    if (activity.kind === 'tool' && activity.toolId) {
      timeline.pendingToolIndexes.set(activity.toolId, index);
    }
  }
  for (const { toolId, result } of reading.toolResults) {
    const index = timeline.pendingToolIndexes.get(toolId);
    if (index === undefined) {
      continue;
    }
    timeline.pendingToolIndexes.delete(toolId);
    timeline.entries[index] = truncateSubagentActivity({ ...timeline.entries[index], toolResult: result });
    timeline.revision += 1;
    timeline.revisions[index] = timeline.revision;
  }
}

/** Reads a cursor this provider handed out (`<generation>.<revision>`), or null for anything else. */
function parseTimelineCursor(cursor: string | undefined): { generation: string; revision: number } | null {
  const match = /^([a-z0-9]+)\.(\d+)$/.exec(cursor ?? '');
  return match ? { generation: match[1], revision: Number(match[2]) } : null;
}

/** Lists the agent transcripts in a chat's `subagents` folder, by agent id. */
async function listSubagentTranscripts(directory: string): Promise<Map<string, string>> {
  const transcripts = new Map<string, string>();
  let names: string[];
  try {
    names = await fsp.readdir(directory);
  } catch {
    return transcripts;
  }
  for (const name of names) {
    const match = AGENT_TRANSCRIPT_NAME.exec(name);
    if (match) {
      transcripts.set(match[1], path.join(directory, name));
    }
  }
  return transcripts;
}

/** Where an agent's transcript is in the layout older CLIs used: beside the chat's own file. */
async function findLegacySubagentTranscript(session: SessionTranscriptRef, agentId: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(agentId)) {
    return null;
  }
  const candidate = path.join(path.dirname(session.jsonlPath), `agent-${agentId}.jsonl`);
  try {
    await fsp.access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

// ---------------------------
//----------------- SETTLING AN AGENT ------------

type LiveWork = ReturnType<typeof getClaudeSDKLiveWork>;

type SubagentInputs = {
  agentId: string;
  record?: AgentRecord;
  report?: TaskReport;
  meta: Awaited<ReturnType<typeof readClaudeSubagentMeta>>;
  summary?: SubagentSummary;
};

/**
 * Where one agent stands. The live process is the only thing that can say an
 * agent runs: by listing it among its tasks, or — for a CLI that does not
 * report its task set — by having launched or resumed it in the current run.
 * Short of that, the latest report settles the agent unless a launch or
 * resume came after it, then the agent's sidecar flags; an agent nothing
 * settled was running in a process that is gone, so it is `stopped`.
 */
function settleSubagent({ agentId, record, report, meta, summary }: SubagentInputs, live: LiveWork): Pick<SessionSubagent, 'status' | 'stoppable'> {
  if (live.processLive && (live.reportedTaskIds?.has(agentId) || live.trackedTaskIds.has(agentId))) {
    return { status: 'running', stoppable: true };
  }
  if (report && report.seq >= (record?.startSeq ?? 0)) {
    return { status: report.status, stoppable: false };
  }
  if (live.processLive && live.reportedTaskIds === null && live.runStartedAt !== null) {
    const startedAt = Date.parse(record?.lastStartAt ?? summary?.startedAt ?? '');
    if (startedAt >= live.runStartedAt) {
      return { status: 'running', stoppable: false };
    }
  }
  if (meta.stoppedByUser) {
    return { status: 'stopped', stoppable: false };
  }
  return { status: meta.finished ? 'completed' : 'stopped', stoppable: false };
}

function describeSubagent(inputs: SubagentInputs, live: LiveWork): SessionSubagent {
  const { agentId, record, report, meta, summary } = inputs;
  return {
    agentId,
    toolUseId: record?.toolUseId ?? meta.toolUseId,
    description: record?.description ?? meta.description ?? `Agent ${agentId.slice(0, 8)}`,
    agentType: meta.agentType,
    // The transcript names the model that ran; the launch and the sidecar
    // name what was asked for, which may be an alias.
    model: summary?.model ?? record?.model ?? meta.model,
    ...settleSubagent(inputs, live),
    background: record?.background ?? (meta.requestShape ? meta.requestShape === 'background' : true),
    depth: meta.spawnDepth ?? 1,
    startedAt: summary?.startedAt ?? record?.launchedAt,
    lastActivityAt: summary?.lastActivityAt,
    lastActivity: summary?.lastActivity,
    activityCount: summary?.activityCount ?? 0,
    resumeCount: record?.resumeCount ?? 0,
    ...(report?.summary ? { summary: report.summary } : {}),
  };
}

/** Running agents first, then the most recently active. */
function compareSubagents(left: SessionSubagent, right: SessionSubagent): number {
  if ((left.status === 'running') !== (right.status === 'running')) {
    return left.status === 'running' ? -1 : 1;
  }
  const leftTime = Date.parse(left.lastActivityAt ?? left.startedAt ?? '') || 0;
  const rightTime = Date.parse(right.lastActivityAt ?? right.startedAt ?? '') || 0;
  return rightTime - leftTime;
}

// ---------------------------

type ClaudeBackgroundWorkProviderOptions = {
  /** The live process's word on a session: the runtime's by default, a stand-in in tests. */
  getLiveWork?: (sessionId: string) => LiveWork;
  /** The clock heartbeat times are worked out against. */
  now?: () => number;
};

/**
 * Claude's background-work reader for the agents panel: the subagents a chat
 * launched and the heartbeats it scheduled, from the chat's transcript and
 * its `subagents` folder, settled against the live process.
 *
 * Every file is read incrementally — a chat transcript runs to tens of
 * megabytes and the panel polls while agents run — so each read parses only
 * the lines appended since the last one. Reads are serialized because the
 * incremental readers are stateful.
 *
 * Used by the Claude provider as its `backgroundWork` facet, which the
 * providers module's sessions service calls for the panel's two routes.
 */
export class ClaudeBackgroundWorkProvider implements IProviderBackgroundWork {
  private readonly getLiveWork: (sessionId: string) => LiveWork;
  private readonly now: () => number;
  private readonly chats = new Map<string, ChatIndex>();
  private readonly summaries = new Map<string, SubagentSummary>();
  private readonly timelines = new Map<string, SubagentTimeline>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor({ getLiveWork = getClaudeSDKLiveWork, now = Date.now }: ClaudeBackgroundWorkProviderOptions = {}) {
    this.getLiveWork = getLiveWork;
    this.now = now;
  }

  readSessionWork(session: SessionTranscriptRef): Promise<SessionBackgroundWork> {
    return this.exclusive(async () => {
      const index = await this.readChatIndex(session);
      const transcripts = await listSubagentTranscripts(this.subagentsDirectory(session));
      const live = this.readLiveWork(session);
      const agentIds = new Set([...index.agents.keys(), ...transcripts.keys()]);
      const subagents = await Promise.all(
        [...agentIds].map(async (agentId) => describeSubagent(
          await this.readSubagentInputs(session, index, agentId, transcripts.get(agentId) ?? null),
          live,
        )),
      );
      return {
        processLive: live.processLive,
        subagents: subagents.sort(compareSubagents),
        heartbeats: listHeartbeats(index, this.now()),
      };
    });
  }

  readSubagentTimeline(session: SessionTranscriptRef, agentId: string, cursor?: string): Promise<SubagentTimelinePage | null> {
    return this.exclusive(async () => {
      const index = await this.readChatIndex(session);
      const transcriptPath = (await listSubagentTranscripts(this.subagentsDirectory(session))).get(agentId)
        ?? await findLegacySubagentTranscript(session, agentId);
      if (!transcriptPath && !index.agents.has(agentId)) {
        return null;
      }

      const inputs = await this.readSubagentInputs(session, index, agentId, transcriptPath);
      const agent = describeSubagent(inputs, this.readLiveWork(session));
      if (!transcriptPath) {
        // Launched here, but its own transcript is not on disk (a fork copies
        // only the chat's file): there is nothing to show of what it did.
        return { agent, cursor: '', reset: true, entries: [], activityCount: 0 };
      }
      return {
        agent,
        ...(inputs.summary?.prompt ? { prompt: inputs.summary.prompt } : {}),
        ...(await this.readTimelinePage(transcriptPath, cursor)),
      };
    });
  }

  /** Runs one read after every read before it has finished. */
  private exclusive<T>(read: () => Promise<T>): Promise<T> {
    const run = this.queue.then(read, read);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private subagentsDirectory(session: SessionTranscriptRef): string {
    return path.join(path.dirname(session.jsonlPath), session.providerSessionId, 'subagents');
  }

  /**
   * The live process behind the chat. The runtime keys it by the app session
   * id when the chat gateway started it and by the provider-native id when
   * the agent API did, so both are asked and the one that is up answers.
   */
  private readLiveWork(session: SessionTranscriptRef): LiveWork {
    const byAppId = this.getLiveWork(session.sessionId);
    if (byAppId.processLive || session.providerSessionId === session.sessionId) {
      return byAppId;
    }
    const byNativeId = this.getLiveWork(session.providerSessionId);
    return byNativeId.processLive ? byNativeId : byAppId;
  }

  private async readChatIndex(session: SessionTranscriptRef): Promise<ChatIndex> {
    let index = this.chats.get(session.jsonlPath);
    if (!index || index.providerSessionId !== session.providerSessionId) {
      index = createChatIndex(session);
    }
    touchCacheEntry(this.chats, session.jsonlPath, index, MAX_CACHED_CHATS);
    const chat = index;
    const readable = await chat.tail.read({
      restart: () => resetChatIndex(chat),
      accept: (line) => chatLineMatters(chat, line),
      row: (row) => foldChatRow(chat, row),
    });
    if (!readable) {
      resetChatIndex(chat);
    }
    return chat;
  }

  private async readSubagentInputs(
    session: SessionTranscriptRef,
    index: ChatIndex,
    agentId: string,
    transcriptPath: string | null,
  ): Promise<SubagentInputs> {
    const resolvedPath = transcriptPath ?? await findLegacySubagentTranscript(session, agentId);
    const [meta, summary] = resolvedPath
      ? await Promise.all([
        readClaudeSubagentMeta(resolvedPath.replace(/\.jsonl$/, '.meta.json')),
        this.readSummary(resolvedPath),
      ])
      : [{}, undefined];
    return {
      agentId,
      record: index.agents.get(agentId),
      report: index.reports.get(agentId),
      meta,
      summary,
    };
  }

  private async readSummary(transcriptPath: string): Promise<SubagentSummary | undefined> {
    const summary = this.summaries.get(transcriptPath) ?? { tail: new JsonlTail(transcriptPath), activityCount: 0 };
    touchCacheEntry(this.summaries, transcriptPath, summary, MAX_CACHED_SUMMARIES);
    const readable = await summary.tail.read({
      restart: () => {
        summary.prompt = undefined;
        summary.activityCount = 0;
        summary.startedAt = undefined;
        summary.lastActivityAt = undefined;
        summary.lastActivity = undefined;
        summary.model = undefined;
      },
      row: (row) => foldSummaryRow(summary, row),
    });
    if (!readable) {
      this.summaries.delete(transcriptPath);
      return undefined;
    }
    return summary;
  }

  private async readTimelinePage(
    transcriptPath: string,
    cursor: string | undefined,
  ): Promise<Omit<SubagentTimelinePage, 'agent'>> {
    const timeline = this.timelines.get(transcriptPath) ?? {
      tail: new JsonlTail(transcriptPath),
      generation: newTimelineGeneration(),
      revision: 0,
      entries: [],
      revisions: [],
      pendingToolIndexes: new Map<string, number>(),
    };
    touchCacheEntry(this.timelines, transcriptPath, timeline, MAX_CACHED_TIMELINES);
    const readable = await timeline.tail.read({
      restart: () => resetTimeline(timeline),
      row: (row) => foldTimelineRow(timeline, row),
    });
    if (!readable) {
      resetTimeline(timeline);
    }

    const total = timeline.entries.length;
    const cursorAfter = `${timeline.generation}.${timeline.revision}`;
    const since = parseTimelineCursor(cursor);
    if (since && since.generation === timeline.generation && since.revision <= timeline.revision) {
      const changed: Array<SubagentActivity & { index: number }> = [];
      for (let index = 0; index < total; index += 1) {
        if (timeline.revisions[index] > since.revision) {
          changed.push({ ...timeline.entries[index], index });
        }
      }
      // Far behind is cheaper to answer with a fresh tail than with every change.
      if (changed.length <= MAX_TIMELINE_ENTRIES) {
        return { cursor: cursorAfter, reset: false, entries: changed, activityCount: total };
      }
    }

    const start = Math.max(0, total - MAX_TIMELINE_ENTRIES);
    return {
      cursor: cursorAfter,
      reset: true,
      entries: timeline.entries.slice(start).map((entry, offset) => ({ ...entry, index: start + offset })),
      activityCount: total,
    };
  }
}

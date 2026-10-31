/**
 * OpenCode SDK Integration
 * ========================
 *
 * Runs OpenCode chat turns through the official `@opencode-ai/sdk`.
 *
 * Every turn gets its own `opencode serve`, started with the SDK's
 * `createOpencodeServer` and stopped when the turn ends. The SDK client then
 * creates or resumes the session, sends the prompt, follows the server's event
 * stream and answers the two requests OpenCode makes of its user while a turn
 * runs:
 *
 * - `permission.asked` — a tool call the user's permission rules mark `ask`
 *   (for example reading an uploaded attachment, which lives outside the
 *   project). It reaches the chat as a `permission_request`, and the chat's
 *   decision goes back as OpenCode's `once`, `always` or `reject`.
 * - `question.asked` — the agent's `question` tool. It reaches the chat as an
 *   AskUserQuestion prompt; the picked labels go back as the answers, and
 *   Dismiss rejects the question.
 *
 * A server per turn, rather than one shared server, is deliberate: OpenCode
 * reads its config, credentials and MCP servers when a project is first opened
 * and does not notice later edits, so a long-lived server would keep running
 * with whatever was configured when it started. A fresh server per turn picks
 * up the current config exactly like the `opencode run` process it replaces.
 * The server is private to its turn, so every request it raises is the turn's.
 *
 * ## Usage
 *
 * - opencodeRuntime.run(command, options, writer, context) - Run one turn
 * - opencodeRuntime.abort(sessionId) - Stop the turn running for a session
 * - opencodeRuntime.permissions - Answer or list the prompts a turn is waiting on
 */

import crypto from 'node:crypto';
import fsSync from 'node:fs';
import { readdir, readFile, readlink } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import Database from 'better-sqlite3';
import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk/v2';
import type {
  Config as OpenCodeConfig,
  Event as OpenCodeEvent,
  OpencodeClient,
  Part as OpenCodePart,
  PermissionRequest as OpenCodePermissionRequest,
  PermissionRuleset as OpenCodePermissionRuleset,
  QuestionRequest as OpenCodeQuestionRequest,
} from '@opencode-ai/sdk/v2';

import {
  appendFilesInputTag,
  appendImagesInputTag,
  normalizeAttachmentDescriptors,
} from '@/shared/image-attachments.js';
import {
  createNotificationEvent,
  notifyRunFailed,
  notifyRunStopped,
  notifyUserIfEnabled,
} from '@/modules/notifications/index.js';
import {
  createCompleteMessage,
  createNormalizedMessage,
  getOpenCodeDatabasePath,
  readObjectRecord,
  stripJsonComments,
  stripTrailingCommas,
} from '@/shared/utils.js';
import type {
  AnyRecord,
  ProviderModelsDefinition,
  ProviderPermissionDecision,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
} from '@/shared/types.js';

// The notifications module is still JavaScript, and its defaults (`dedupeKey = null`,
// `sessionId = null`) infer as the only accepted types; these state the shapes
// callers really pass.
const notificationEvent = createNotificationEvent as (event: AnyRecord) => unknown;
const reportRunStopped = notifyRunStopped as (input: AnyRecord) => void;
const reportRunFailed = notifyRunFailed as (input: AnyRecord) => void;

const PROVIDER = 'opencode';

const NOT_INSTALLED_MESSAGE = 'OpenCode CLI is not installed. Install it from https://opencode.ai/docs/';

/**
 * First OpenCode release with both APIs the runtime answers through: the
 * permission requests (`permission.asked` and its reply route, 1.0.224) and
 * questions answered with one label list per question (1.1.8; 1.1.7 took one
 * string per question). An older server would wait forever for a reply the
 * runtime cannot give, so it is refused up front instead.
 */
const MIN_OPENCODE_VERSION = '1.1.8';

/**
 * How long `opencode serve` may take to print its address. The SDK's own
 * default is 5 s, which a first start (database migration, plugin install) or a
 * busy machine can exceed.
 */
const SERVER_START_TIMEOUT_MS = 60_000;

/**
 * How long the event stream may take to confirm it is connected. The first
 * request for a project waits while OpenCode opens it (config, plugins, MCP
 * servers), which a project with slow plugins can stretch well past a few
 * seconds, so it gets the same budget as the server start.
 */
const EVENT_STREAM_CONNECT_TIMEOUT_MS = SERVER_START_TIMEOUT_MS;

/**
 * Names, in each turn server's environment, the CloudCLI process that started
 * it, so a later CloudCLI can tell the servers of a process that died without
 * stopping them.
 */
const OWNER_PID_ENV = 'CLOUDCLI_OPENCODE_OWNER_PID';

/** How long stopping a turn waits for OpenCode's session abort before stopping the server anyway. */
const SESSION_ABORT_TIMEOUT_MS = 5_000;

const readTimeoutFromEnv = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/**
 * Unanswered permission prompts are rejected after this long (0 waits), the
 * same default the Claude runtime uses, so a run nobody watches does not hold
 * its server forever.
 */
const TOOL_APPROVAL_TIMEOUT_MS = readTimeoutFromEnv('OPENCODE_TOOL_APPROVAL_TIMEOUT_MS', 55_000);

/**
 * Unanswered questions are dismissed after this long (0 waits). Longer than
 * for permissions: a question usually needs thought, not just a yes or no.
 */
const QUESTION_TIMEOUT_MS = readTimeoutFromEnv('OPENCODE_QUESTION_TIMEOUT_MS', 30 * 60_000);

/**
 * Upper bound on how many chats keep their "Always allow" approvals in memory.
 * The least recently approving chat is forgotten first.
 */
const MAX_REMEMBERED_APPROVAL_SESSIONS = 500;

/** How a chat's decision reaches OpenCode's permission API. */
type OpenCodePermissionReply = 'once' | 'always' | 'reject';

type OpenCodeServer = { url: string; close(): void };

/** One running turn, keyed in `activeTurns` by the session it runs for. */
type OpenCodeTurn = {
  key: string;
  /** Ends the event stream and stops a server that is still starting. */
  abortController: AbortController;
  server: OpenCodeServer | null;
  client: OpencodeClient | null;
  providerSessionId: string | null;
  aborted: boolean;
  /** Settles once a requested stop has finished (session aborted, server stopped). */
  abortFinished: Promise<void> | null;
  /** Wakes a turn that is waiting for OpenCode to finish. */
  finish(): void;
};

/** A permission or question the turn is waiting on the chat to answer. */
type PendingOpenCodePrompt = {
  requestId: string;
  /** Session the chat knows the prompt by: the app session id when there is one. */
  sessionId: string | null;
  toolName: string;
  input: unknown;
  context: AnyRecord;
  receivedAt: Date;
  timer: ReturnType<typeof setTimeout> | undefined;
  answer(decision: ProviderPermissionDecision): void;
  /** Drops the prompt from the chat; `reason` marks a withdrawal (timeout, stop). */
  settle(reason?: string): void;
};

/** A rule an "Always allow" approved: OpenCode permission plus one of its `always` patterns. */
type RememberedApproval = {
  permission: string;
  pattern: string;
};

const activeTurns = new Map<string, OpenCodeTurn>();
const pendingPrompts = new Map<string, PendingOpenCodePrompt>();
// "Always allow" is remembered by OpenCode only in its server's memory, and a
// turn's server stops with the turn. The approved patterns are kept here per
// chat instead (in memory, never persisted), so a later turn in the same chat
// is not asked again for what the user already allowed always.
const rememberedApprovals = new Map<string, RememberedApproval[]>();

// ---------------------------------------------------------------------------
// Permission modes and model options
// ---------------------------------------------------------------------------

/**
 * Picks the OpenCode reply a permission request gets without asking the user,
 * or null when the chat has to ask.
 *
 * - bypassPermissions → `once` for everything, like `opencode run --auto`.
 * - acceptEdits       → `once` for file edits; everything else is asked.
 * - plan / default    → asked (plan's own agent already denies edits).
 *
 * Only `ask` rules produce a request at all: what the user's OpenCode config
 * allows never gets here, and what it denies is denied by OpenCode itself.
 *
 * Exported for tests only.
 */
export function resolveAutomaticPermissionReply(
  permissionMode: unknown,
  permission: string,
): OpenCodePermissionReply | null {
  if (permissionMode === 'bypassPermissions') {
    return 'once';
  }

  if (permissionMode === 'acceptEdits' && permission === 'edit') {
    return 'once';
  }

  return null;
}

/**
 * Maps a chat decision onto OpenCode's permission reply. The chat asks for a
 * remembered approval with `rememberEntry`; for OpenCode that is its own
 * `always`, whose patterns come from the request, not from the client. A
 * denial is a plain `reject`, which ends the turn like OpenCode's own Reject.
 *
 * Exported for tests only.
 */
export function toOpenCodePermissionReply(decision: ProviderPermissionDecision): OpenCodePermissionReply {
  if (!decision.allow) {
    return 'reject';
  }

  return decision.rememberEntry ? 'always' : 'once';
}

function resolveOpenCodeEffort(
  model: string | undefined,
  effort: unknown,
  modelsDefinition: ProviderModelsDefinition | null,
): string | undefined {
  const selectedModel = modelsDefinition?.OPTIONS?.find((option) => option.value === model);
  const allowedEfforts = selectedModel?.effort?.values?.map((value) => value.value) || [];
  return typeof effort === 'string' && effort !== 'default' && allowedEfforts.includes(effort)
    ? effort
    : undefined;
}

/**
 * Splits a `provider/model` id the way `opencode run --model` does: at the first
 * slash, so model ids that contain slashes themselves stay whole.
 */
function parseOpenCodeModel(model: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!model) {
    return undefined;
  }

  const separator = model.indexOf('/');
  if (separator <= 0 || separator === model.length - 1) {
    return undefined;
  }

  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) };
}

// ---------------------------------------------------------------------------
// Permission rules and "Always allow" memory
// ---------------------------------------------------------------------------

/**
 * OpenCode's own wildcard matcher (`Wildcard.match` in its core package): `*`
 * matches anything, `?` one character, and a trailing ` *` also matches the
 * bare command, so `git status *` covers `git status`.
 */
function matchesOpenCodeWildcard(input: string, pattern: string): boolean {
  const normalizedInput = input.replaceAll('\\', '/');
  let expression = pattern
    .replaceAll('\\', '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  if (expression.endsWith(' .*')) {
    expression = `${expression.slice(0, -3)}( .*)?`;
  }

  return new RegExp(`^${expression}$`, process.platform === 'win32' ? 'si' : 's').test(normalizedInput);
}

/**
 * Whether an earlier "Always allow" in this chat already covers a request:
 * every one of its patterns has to match an approved rule, the same test
 * OpenCode applies to its own approvals.
 *
 * Exported for tests only.
 */
export function isCoveredByApprovals(
  approvals: RememberedApproval[] | undefined,
  permission: string,
  patterns: string[],
): boolean {
  if (!approvals?.length || patterns.length === 0) {
    return false;
  }

  return patterns.every((pattern) => approvals.some((rule) =>
    matchesOpenCodeWildcard(permission, rule.permission) && matchesOpenCodeWildcard(pattern, rule.pattern)));
}

function rememberApprovals(chatKey: string, permission: string, patterns: string[]): void {
  if (patterns.length === 0) {
    return;
  }

  const approvals = rememberedApprovals.get(chatKey) ?? [];
  for (const pattern of patterns) {
    if (!approvals.some((rule) => rule.permission === permission && rule.pattern === pattern)) {
      approvals.push({ permission, pattern });
    }
  }

  // Re-inserting moves the chat to the newest end of the map's order.
  rememberedApprovals.delete(chatKey);
  rememberedApprovals.set(chatKey, approvals);
  while (rememberedApprovals.size > MAX_REMEMBERED_APPROVAL_SESSIONS) {
    const oldestKey = rememberedApprovals.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    rememberedApprovals.delete(oldestKey);
  }
}

/**
 * Whether a ruleset denies a permission outright, the test OpenCode uses to
 * hide a tool: the last rule naming the permission denies every pattern.
 */
function deniesEveryPattern(ruleset: OpenCodePermissionRuleset | undefined, permission: string): boolean {
  const rule = ruleset?.filter((candidate) => matchesOpenCodeWildcard(permission, candidate.permission)).at(-1);
  return rule?.pattern === '*' && rule.action === 'deny';
}

/**
 * Re-enables the question tool on a session created by `opencode run`.
 *
 * Before this runtime, chats ran through `opencode run`, which creates every
 * session with a `question: deny` rule because nobody could answer there. The
 * chat can answer now, so a resumed session gets one `question: allow` rule
 * appended — OpenCode's session update appends rules, it cannot remove one —
 * but only when the agent's own rules, which include the user's config, do not
 * deny questions themselves.
 */
async function allowQuestionsOnLegacySession(
  client: OpencodeClient,
  providerSessionId: string,
  agentName: string | undefined,
): Promise<void> {
  const session = (await client.session.get({ sessionID: providerSessionId })).data;
  if (!deniesEveryPattern(session?.permission, 'question')) {
    return;
  }

  const [agents, config] = await Promise.all([
    client.app.agents().then((result) => result.data ?? []),
    agentName ? Promise.resolve(undefined) : client.config.get().then((result) => result.data),
  ]);
  const effectiveAgentName = agentName ?? config?.default_agent ?? 'build';
  const agent = agents.find((candidate) => candidate.name === effectiveAgentName);
  if (!agent || deniesEveryPattern(agent.permission, 'question')) {
    return;
  }

  await client.session.update({
    sessionID: providerSessionId,
    permission: [{ permission: 'question', pattern: '*', action: 'allow' }],
  });
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/**
 * Shapes an OpenCode question request as the input of the chat's
 * AskUserQuestion panel. `multiple` is OpenCode's name for Claude's
 * `multiSelect`; `custom: false` hides the typed answer.
 */
function toAskUserQuestionInput(request: OpenCodeQuestionRequest): AnyRecord {
  return {
    questions: request.questions.map((question) => ({
      question: question.question,
      header: question.header,
      options: question.options.map((option) => ({ label: option.label, description: option.description })),
      multiSelect: question.multiple === true,
      ...(question.custom === false ? { custom: false } : {}),
    })),
  };
}

/**
 * Reads the answers the chat sent for a question request: one list of labels
 * per question, in question order. Answers keyed by question text (the shape
 * Claude's panel uses) are accepted as one label each.
 *
 * Exported for tests only.
 */
export function readQuestionAnswers(
  updatedInput: unknown,
  questions: Array<{ question: string }>,
): string[][] {
  const answers = readObjectRecord(updatedInput)?.answers;
  const toLabels = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value.filter((label): label is string => typeof label === 'string' && label.trim().length > 0);
    }
    return typeof value === 'string' && value.trim() ? [value] : [];
  };

  if (Array.isArray(answers)) {
    return questions.map((_, index) => toLabels(answers[index]));
  }

  const keyedAnswers = readObjectRecord(answers);
  return questions.map((question) => toLabels(keyedAnswers?.[question.question]));
}

// ---------------------------------------------------------------------------
// Token usage
// ---------------------------------------------------------------------------

function readOpenCodeTokenUsage(sessionId: string | null) {
  const dbPath = getOpenCodeDatabasePath();
  if (!sessionId || !fsSync.existsSync(dbPath)) {
    return null;
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const columns = db.prepare('PRAGMA table_info(session)').all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    const requiredColumns = ['tokens_input', 'tokens_output', 'tokens_reasoning', 'tokens_cache_read', 'tokens_cache_write'];
    if (!requiredColumns.every((column) => columnNames.has(column))) {
      return null;
    }

    const row = db.prepare(`
      SELECT
        tokens_input AS inputTokens,
        tokens_output AS outputTokens,
        tokens_reasoning AS reasoningTokens,
        tokens_cache_read AS cacheReadTokens,
        tokens_cache_write AS cacheWriteTokens
      FROM session
      WHERE id = ?
    `).get(sessionId) as AnyRecord | undefined;

    if (!row) {
      return null;
    }

    const inputTokens = Number(row.inputTokens || 0) + Number(row.cacheReadTokens || 0);
    const outputTokens = Number(row.outputTokens || 0);
    const used = Number(row.inputTokens || 0)
      + outputTokens
      + Number(row.reasoningTokens || 0)
      + Number(row.cacheReadTokens || 0)
      + Number(row.cacheWriteTokens || 0);
    if (used <= 0) {
      return null;
    }

    return {
      used,
      inputTokens,
      outputTokens,
      breakdown: {
        input: inputTokens,
        output: outputTokens,
      },
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

// ---------------------------------------------------------------------------
// Server lifetime
// ---------------------------------------------------------------------------

let exitHookInstalled = false;

/**
 * Stops the servers of turns still running when CloudCLI exits. The shutdown
 * handlers end with `process.exit`, which runs this synchronously; the SDK
 * signals its child at once (a process-tree kill on Windows).
 */
function installExitHook(): void {
  if (exitHookInstalled) {
    return;
  }

  exitHookInstalled = true;
  process.on('exit', () => {
    for (const turn of activeTurns.values()) {
      turn.abortController.abort();
      turn.server?.close();
    }
  });
}

/**
 * Inline config from `OPENCODE_CONFIG_CONTENT`. The SDK hands the server its
 * own `config` option through that same variable, which would otherwise
 * replace a value the user set.
 */
function readInlineConfig(): OpenCodeConfig | undefined {
  const raw = process.env.OPENCODE_CONFIG_CONTENT;
  if (!raw) {
    return undefined;
  }

  try {
    // OpenCode accepts JSONC here, like in its config files.
    return readObjectRecord(JSON.parse(stripTrailingCommas(stripJsonComments(raw)))) as OpenCodeConfig | null ?? undefined;
  } catch (error) {
    console.warn('[OpenCode] OPENCODE_CONFIG_CONTENT is not valid JSON, so the chat\'s OpenCode server runs without it:', readErrorMessage(error));
    return undefined;
  }
}

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * Stops turn servers that a CloudCLI process started and never stopped because
 * it was killed (SIGKILL, the OOM killer) before its exit hook could run. Such a
 * server never exits by itself, unlike the `opencode run` process it replaces.
 *
 * A process is only stopped when its environment names a CloudCLI owner that
 * is gone and its arguments are a turn server's (`serve --hostname=127.0.0.1
 * --port=…`), so commands the agent left running in the background are never
 * touched. The owner pid only means something inside the PID namespace that
 * issued it: a CloudCLI on the host also sees a container's processes in
 * /proc, and their owner pid would look dead from out here, so processes of
 * another (or an unreadable) namespace are skipped. Linux only: the
 * environment is read from /proc, which tests point at a fake tree.
 *
 * Used by the server entrypoint once at startup, through the providers module.
 */
export async function reapOrphanedOpenCodeServers(procRoot = '/proc'): Promise<number> {
  if (process.platform !== 'linux') {
    return 0;
  }

  const ownNamespace = await readlink(path.join(procRoot, 'self', 'ns', 'pid')).catch(() => null);
  if (!ownNamespace) {
    return 0;
  }

  let reaped = 0;
  const entries = await readdir(procRoot).catch(() => [] as string[]);
  for (const entry of entries) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) {
      continue;
    }

    const pid = Number(entry);
    // Other users' processes are unreadable and skipped.
    const [environ, cmdline, namespace] = await Promise.all([
      readFile(path.join(procRoot, entry, 'environ'), 'utf8').catch(() => ''),
      readFile(path.join(procRoot, entry, 'cmdline'), 'utf8').catch(() => ''),
      readlink(path.join(procRoot, entry, 'ns', 'pid')).catch(() => null),
    ]);
    const owner = environ.split('\0').find((variable) => variable.startsWith(`${OWNER_PID_ENV}=`));
    const ownerPid = Number(owner?.slice(OWNER_PID_ENV.length + 1));
    const args = cmdline.split('\0');
    const isTurnServer = args.includes('serve')
      && args.includes('--hostname=127.0.0.1')
      && args.some((arg) => arg.startsWith('--port='));
    if (
      !isTurnServer
      || namespace !== ownNamespace
      || !Number.isInteger(ownerPid)
      || ownerPid <= 0
      || isProcessAlive(ownerPid)
    ) {
      continue;
    }

    try {
      process.kill(pid, 'SIGTERM');
      reaped += 1;
    } catch {
      // Gone already.
    }
  }

  return reaped;
}

/**
 * Reserves a free loopback port for a turn's server.
 *
 * Every turn's server gets a port of its own instead of OpenCode's preferred
 * 4096: consecutive turns on the same address would let Node's fetch reuse a
 * kept-alive connection to the previous turn's server, which has just been
 * stopped, and the new turn's first request would fail.
 */
function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('No free port for the OpenCode server.'))));
    });
  });
}

/**
 * Starts a private `opencode serve` for one turn through the SDK.
 *
 * The server listens on loopback only, and a random Basic-auth password keeps
 * other local processes and web pages from driving it. OpenCode reads that
 * password from `OPENCODE_SERVER_PASSWORD` only, and the SDK builds the child's
 * environment from `process.env` in the same synchronous step that spawns it,
 * so the variables are set just around that call and restored right after.
 * The question tool is switched on explicitly, since the chat can answer it.
 */
async function startOpenCodeServer(signal: AbortSignal): Promise<{ server: OpenCodeServer; password: string }> {
  const port = await reserveFreePort();
  const password = crypto.randomBytes(24).toString('base64url');
  const childEnv: Record<string, string> = {
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_SERVER_USERNAME: 'opencode',
    [OWNER_PID_ENV]: String(process.pid),
  };
  if (process.env.OPENCODE_ENABLE_QUESTION_TOOL === undefined) {
    childEnv.OPENCODE_ENABLE_QUESTION_TOOL = 'true';
  }

  const previousEnv = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(childEnv)) {
    previousEnv.set(name, process.env[name]);
    process.env[name] = value;
  }

  let starting: Promise<OpenCodeServer>;
  try {
    starting = createOpencodeServer({
      hostname: '127.0.0.1',
      port,
      timeout: SERVER_START_TIMEOUT_MS,
      signal,
      config: readInlineConfig(),
    });
  } finally {
    for (const [name, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }

  return { server: await starting, password };
}

/**
 * Whether a failed start is worth one more try: two servers migrating the
 * shared database at once can make one of them fail with `database is locked`,
 * and another process can take the reserved port before the server binds it.
 */
function isRetryableStartFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /database is locked|SQLITE_BUSY|EADDRINUSE|address already in use/i.test(message);
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  const record = readObjectRecord(error);
  const data = readObjectRecord(record?.data);
  if (typeof data?.message === 'string' && data.message) {
    return data.message;
  }
  if (typeof record?.message === 'string' && record.message) {
    return record.message;
  }
  if (typeof record?.name === 'string' && record.name) {
    return record.name;
  }
  return String(error);
}

/** Whether an SDK call failed because OpenCode no longer knows the request (already settled). */
function isNotFoundError(error: unknown): boolean {
  const cause = readObjectRecord(error instanceof Error ? error.cause : undefined);
  return cause?.status === 404;
}

/**
 * Whether a reported OpenCode version is at least `minimum`. Snapshot and
 * development builds (`0.0.0-…`) and unparsable versions are let through.
 */
function isSupportedOpenCodeVersion(version: string, minimum: string): boolean {
  const parse = (value: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(value)?.slice(1).map(Number);
  const reported = parse(version);
  const required = parse(minimum);
  if (!reported || !required || reported.every((part) => part === 0)) {
    return true;
  }

  for (let index = 0; index < 3; index += 1) {
    if (reported[index] !== required[index]) {
      return reported[index] > required[index];
    }
  }
  return true;
}

/** Refuses an OpenCode too old to send the requests this runtime answers. */
async function assertSupportedOpenCode(client: OpencodeClient): Promise<void> {
  const upgradeHint = 'Update it, for example with `opencode upgrade`.';
  let version: string | undefined;
  try {
    version = (await client.global.health()).data?.version;
  } catch (error) {
    // `/global/health` itself only exists from 1.0.224 on.
    throw new Error(
      `CloudCLI needs OpenCode ${MIN_OPENCODE_VERSION} or newer, and this OpenCode did not report its version `
      + `(${readErrorMessage(error)}). ${upgradeHint}`,
    );
  }

  if (version && !isSupportedOpenCodeVersion(version, MIN_OPENCODE_VERSION)) {
    throw new Error(`OpenCode ${version} is too old for CloudCLI, which needs ${MIN_OPENCODE_VERSION} or newer. ${upgradeHint}`);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Lets microtasks queued by the caller (the abort handler's terminal `complete`) run first. */
const nextMacrotask = () => new Promise<void>((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
// Turn
// ---------------------------------------------------------------------------

/**
 * Runs one OpenCode turn. Resolves when the turn completed, rejects when it
 * failed; an aborted turn resolves once its stop has finished, so the abort
 * handler's terminal `complete` is the one the chat receives.
 */
async function runOpenCodeTurn(
  command: string,
  options: AnyRecord = {},
  writer: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
): Promise<void> {
  const {
    sessionId,
    projectPath,
    cwd,
    model,
    effort,
    sessionSummary,
    images,
    files,
    permissionMode,
  } = options;
  const appSessionId = typeof sessionId === 'string' && sessionId ? sessionId : null;
  // Callers pass the stable app session id; OpenCode resumes with the
  // provider-native id recorded on the session row.
  const resumeSessionId = context.resolveProviderSessionId(appSessionId);
  const workingDir: string = cwd || projectPath || process.cwd();
  const userId = writer?.userId ?? null;

  let turnDone!: () => void;
  const turnFinished = new Promise<void>((resolve) => {
    turnDone = resolve;
  });
  const turn: OpenCodeTurn = {
    key: appSessionId ?? resumeSessionId ?? `opencode-${Date.now()}`,
    abortController: new AbortController(),
    server: null,
    client: null,
    providerSessionId: resumeSessionId,
    aborted: false,
    abortFinished: null,
    finish: () => turnDone(),
  };
  activeTurns.set(turn.key, turn);
  installExitHook();

  const turnSessionId = () => appSessionId ?? turn.providerSessionId ?? turn.key;
  // "Always allow" is remembered per chat; direct callers without an app id
  // fall back to the OpenCode session.
  const approvalsKey = () => appSessionId ?? turn.providerSessionId ?? turn.key;
  const send = (message: unknown) => writer.send(message);
  const sentErrors = new Set<string>();
  const sendError = (content: string) => {
    // OpenCode can report one failure more than once (a prompt that fails
    // before it runs is published twice); the chat shows it once.
    if (sentErrors.has(content)) {
      return;
    }
    sentErrors.add(content);
    send(createNormalizedMessage({
      kind: 'error',
      content,
      sessionId: turnSessionId(),
      provider: PROVIDER,
    }));
  };
  const notify = (event: AnyRecord) => notifyUserIfEnabled({ userId, event: notificationEvent(event) });

  const turnPromptIds = new Set<string>();
  const userMessageIds = new Set<string>();
  const emittedParts = new Set<string>();
  let sawBusy = false;
  let turnEnded = false;
  let turnError: string | null = null;

  const failTurn = (message: string) => {
    sendError(message);
    turnError ??= message;
    turnDone();
  };

  const registerProviderSession = (providerSessionId: string) => {
    turn.providerSessionId = providerSessionId;
    // Direct callers without an app session id find the turn by the
    // provider-native id from now on.
    if (!appSessionId && turn.key !== providerSessionId) {
      if (activeTurns.get(turn.key) === turn) {
        activeTurns.delete(turn.key);
      }
      turn.key = providerSessionId;
      activeTurns.set(turn.key, turn);
    }

    writer.setSessionId?.(providerSessionId);
    send(createNormalizedMessage({
      kind: 'session_created',
      newSessionId: providerSessionId,
      sessionId: providerSessionId,
      provider: PROVIDER,
    }));
  };

  const replyToPermission = async (requestId: string, reply: OpenCodePermissionReply) => {
    try {
      await turn.client!.permission.reply({ requestID: requestId, reply });
    } catch (error) {
      // Already settled by OpenCode itself (its cascade after another reply).
      if (isNotFoundError(error) || turn.aborted || turnEnded) {
        return;
      }
      failTurn(`OpenCode did not accept the permission reply: ${readErrorMessage(error)}`);
    }
  };

  const replyToQuestion = async (requestId: string, answers: string[][] | null) => {
    try {
      if (answers) {
        await turn.client!.question.reply({ requestID: requestId, answers });
      } else {
        await turn.client!.question.reject({ requestID: requestId });
      }
    } catch (error) {
      if (isNotFoundError(error) || turn.aborted || turnEnded) {
        return;
      }
      failTurn(`OpenCode did not accept the answer: ${readErrorMessage(error)}`);
    }
  };

  /** Shows a request in the chat and holds it until it is answered or times out. */
  const askChat = (prompt: {
    requestId: string;
    toolName: string;
    input: unknown;
    context: AnyRecord;
    timeoutMs: number;
    onAnswer(decision: ProviderPermissionDecision): void;
    onTimeout(): void;
  }) => {
    const pending: PendingOpenCodePrompt = {
      requestId: prompt.requestId,
      // Keyed by the app session id so `chat.subscribe` can find it after a refresh.
      sessionId: appSessionId ?? turn.providerSessionId,
      toolName: prompt.toolName,
      input: prompt.input,
      context: prompt.context,
      receivedAt: new Date(),
      timer: undefined,
      answer: (decision) => {
        if (pendingPrompts.get(prompt.requestId) !== pending) {
          return;
        }
        // Announced on the run stream so the replay buffer and every other
        // tab watching the run drop the prompt as well.
        pending.settle();
        prompt.onAnswer(decision);
      },
      settle: (reason) => {
        if (pendingPrompts.get(prompt.requestId) !== pending) {
          return;
        }
        clearTimeout(pending.timer);
        pendingPrompts.delete(prompt.requestId);
        turnPromptIds.delete(prompt.requestId);
        send(createNormalizedMessage({
          kind: reason ? 'permission_cancelled' : 'permission_resolved',
          requestId: prompt.requestId,
          ...(reason ? { reason } : {}),
          sessionId: turnSessionId(),
          provider: PROVIDER,
        }));
      },
    };

    pendingPrompts.set(prompt.requestId, pending);
    turnPromptIds.add(prompt.requestId);
    if (prompt.timeoutMs > 0) {
      pending.timer = setTimeout(() => {
        pending.settle('timeout');
        prompt.onTimeout();
      }, prompt.timeoutMs);
    }

    send(createNormalizedMessage({
      kind: 'permission_request',
      requestId: prompt.requestId,
      toolName: prompt.toolName,
      input: prompt.input,
      context: prompt.context,
      sessionId: turnSessionId(),
      provider: PROVIDER,
    }));
  };

  const handlePermissionAsked = (request: OpenCodePermissionRequest) => {
    // A stopping or finished turn asks nobody; its server is about to go.
    if (turn.aborted || turnEnded) {
      return;
    }
    const automaticReply = resolveAutomaticPermissionReply(permissionMode, request.permission)
      ?? (isCoveredByApprovals(rememberedApprovals.get(approvalsKey()), request.permission, request.patterns) ? 'once' : null);
    if (automaticReply) {
      void replyToPermission(request.id, automaticReply);
      return;
    }

    askChat({
      requestId: request.id,
      toolName: request.permission,
      input: { ...request.metadata, patterns: request.patterns },
      // `always` is what "Always allow" approves; the chat shows it beside the button.
      context: { patterns: request.patterns, always: request.always },
      timeoutMs: TOOL_APPROVAL_TIMEOUT_MS,
      onAnswer: (decision) => {
        const reply = toOpenCodePermissionReply(decision);
        if (reply === 'always') {
          rememberApprovals(approvalsKey(), request.permission, request.always);
        }
        void replyToPermission(request.id, reply);
      },
      onTimeout: () => void replyToPermission(request.id, 'reject'),
    });

    notify({
      provider: PROVIDER,
      sessionId: turnSessionId(),
      kind: 'action_required',
      code: 'permission.required',
      meta: { toolName: request.permission, sessionName: sessionSummary },
      severity: 'warning',
      requiresUserAction: true,
      dedupeKey: `opencode:permission:${turnSessionId()}:${request.id}`,
    });
  };

  const handleQuestionAsked = (request: OpenCodeQuestionRequest) => {
    if (turn.aborted || turnEnded) {
      return;
    }
    // Nobody is asked in bypassPermissions (also how /api/agent runs), and a
    // dismissed question would end the turn, so the agent is told the
    // questions went unanswered and carries on.
    if (permissionMode === 'bypassPermissions' || request.questions.length === 0) {
      void replyToQuestion(request.id, request.questions.map(() => []));
      return;
    }

    askChat({
      requestId: request.id,
      toolName: 'AskUserQuestion',
      input: toAskUserQuestionInput(request),
      // Tells the panel to answer with one label list per question and to
      // offer Dismiss, which rejects the question in OpenCode.
      context: { answerFormat: 'label-lists' },
      timeoutMs: QUESTION_TIMEOUT_MS,
      onAnswer: (decision) => {
        void replyToQuestion(
          request.id,
          decision.allow ? readQuestionAnswers(decision.updatedInput, request.questions) : null,
        );
      },
      onTimeout: () => void replyToQuestion(request.id, null),
    });

    notify({
      provider: PROVIDER,
      sessionId: turnSessionId(),
      kind: 'action_required',
      code: 'agent.notification',
      meta: { message: request.questions[0]?.question || 'OpenCode has a question for you', sessionName: sessionSummary },
      severity: 'warning',
      requiresUserAction: true,
      dedupeKey: `opencode:question:${turnSessionId()}:${request.id}`,
    });
  };

  /**
   * Forwards one finished part of the chat's own session in the shape
   * `opencode run --format json` printed (`{ type, timestamp, sessionID, part }`),
   * so the shared normalizer turns it into the same chat messages as before.
   * Subagent sessions are left out, as `run` left them out: their work shows
   * inside the `task` call that spawned them.
   */
  const forwardPart = (part: OpenCodePart) => {
    let lineType: string | null = null;
    if (part.type === 'text' && part.time?.end && !userMessageIds.has(part.messageID)) {
      lineType = 'text';
    } else if (part.type === 'reasoning' && part.time?.end) {
      lineType = 'reasoning';
    } else if (part.type === 'tool' && (part.state.status === 'completed' || part.state.status === 'error')) {
      lineType = 'tool_use';
    } else if (part.type === 'step-finish') {
      lineType = 'step_finish';
    }

    if (!lineType || emittedParts.has(part.id)) {
      return;
    }
    emittedParts.add(part.id);

    for (const message of context.normalizeMessage(
      { type: lineType, timestamp: Date.now(), sessionID: part.sessionID, part },
      turnSessionId(),
    )) {
      send(message);
    }
  };

  const handleEvent = (event: OpenCodeEvent) => {
    switch (event.type) {
      case 'message.updated': {
        if (event.properties.info.role === 'user') {
          userMessageIds.add(event.properties.info.id);
        }
        return;
      }
      case 'message.part.updated': {
        if (event.properties.part.sessionID === turn.providerSessionId) {
          forwardPart(event.properties.part);
        }
        return;
      }
      case 'permission.asked': {
        handlePermissionAsked(event.properties);
        return;
      }
      case 'question.asked': {
        handleQuestionAsked(event.properties);
        return;
      }
      case 'permission.replied':
      case 'question.replied':
      case 'question.rejected': {
        // Settled without the chat: OpenCode answers the rest of a session's
        // prompts itself after an Always allow or a Deny.
        pendingPrompts.get(event.properties.requestID)?.settle();
        return;
      }
      case 'session.error': {
        const { sessionID, error } = event.properties;
        if (!sessionID || sessionID !== turn.providerSessionId || !error || turnEnded) {
          return;
        }
        // The abort of a stopped turn is not an error worth a message.
        if (error.name !== 'MessageAbortedError') {
          const message = readErrorMessage(error);
          sendError(message);
          turnError ??= message;
        }
        // A prompt that fails before its loop starts never reports busy/idle.
        if (!sawBusy) {
          turnDone();
        }
        return;
      }
      case 'session.status': {
        if (event.properties.sessionID !== turn.providerSessionId) {
          return;
        }
        if (event.properties.status.type === 'busy') {
          sawBusy = true;
        } else if (event.properties.status.type === 'idle' && sawBusy) {
          turnDone();
        }
        return;
      }
      default:
        return;
    }
  };

  let connected!: () => void;
  const eventStreamConnected = new Promise<void>((resolve) => {
    connected = resolve;
  });
  let eventLoop: Promise<void> = Promise.resolve();
  let completedNormally = false;

  try {
    const hasAttachments =
      normalizeAttachmentDescriptors(images).length > 0
      || normalizeAttachmentDescriptors(files).length > 0;
    const promptText = typeof command === 'string' ? command.trim() : '';
    if (!promptText && !hasAttachments) {
      throw new Error('OpenCode needs a message to run.');
    }
    // Attachments ride along as path lists appended to the prompt; the agent
    // reads them with its own tools and the history reader strips the tags.
    const promptWithAttachments = appendFilesInputTag(appendImagesInputTag(promptText, images), files);

    const resolvedModel = await context.resolveResumeModel(appSessionId ?? undefined, model);
    let effortModels: ProviderModelsDefinition | null = null;
    try {
      effortModels = await context.getProviderModels();
    } catch (error) {
      console.warn('[OpenCode] Unable to load provider models for effort validation:', error);
    }
    const variant = resolveOpenCodeEffort(resolvedModel, effort, effortModels);

    if (turn.aborted) {
      throw new Error('aborted');
    }
    let started: Awaited<ReturnType<typeof startOpenCodeServer>>;
    try {
      started = await startOpenCodeServer(turn.abortController.signal);
    } catch (error) {
      if (turn.aborted || !isRetryableStartFailure(error)) {
        throw error;
      }
      started = await startOpenCodeServer(turn.abortController.signal);
    }
    turn.server = started.server;
    if (turn.aborted) {
      throw new Error('aborted');
    }

    const client = createOpencodeClient({
      baseUrl: started.server.url,
      directory: workingDir,
      headers: { Authorization: `Basic ${Buffer.from(`opencode:${started.password}`).toString('base64')}` },
      throwOnError: true,
    });
    turn.client = client;
    await assertSupportedOpenCode(client);

    // Subscribe before anything is sent, so no event of the turn is missed.
    // One attempt only: a private server that drops the stream has stopped.
    let streamError: unknown = null;
    const { stream } = await client.event.subscribe({}, {
      signal: turn.abortController.signal,
      sseMaxRetryAttempts: 1,
      onSseError: (error: unknown) => {
        streamError = error;
      },
    });
    eventLoop = (async () => {
      try {
        for await (const event of stream) {
          if (event.type === 'server.connected') {
            connected();
            continue;
          }
          try {
            handleEvent(event);
          } catch (error) {
            // One event that cannot be handled must not end the turn.
            console.error('[OpenCode] Failed to handle an event:', event.type, readErrorMessage(error));
          }
        }
      } catch (error) {
        streamError ??= error;
      }
      if (!turn.aborted && !turnEnded) {
        failTurn(streamError
          ? `Lost the connection to the OpenCode server: ${readErrorMessage(streamError)}`
          : 'The OpenCode server stopped unexpectedly.');
      }
    })();

    await Promise.race([
      withTimeout(eventStreamConnected, EVENT_STREAM_CONNECT_TIMEOUT_MS, 'The OpenCode event stream did not connect.'),
      turnFinished.then(() => {
        throw new Error(turnError ?? 'The OpenCode event stream ended before it connected.');
      }),
    ]);

    const agent = permissionMode === 'plan' ? 'plan' : undefined;
    if (turn.providerSessionId) {
      if (permissionMode !== 'bypassPermissions') {
        try {
          await allowQuestionsOnLegacySession(client, turn.providerSessionId, agent);
        } catch (error) {
          // A session OpenCode does not know fails the prompt below with its own error.
          console.warn('[OpenCode] Could not check the session for a question rule:', readErrorMessage(error));
        }
      }
    } else {
      const created = (await client.session.create({})).data;
      if (!created?.id) {
        throw new Error('OpenCode did not create a session.');
      }
      registerProviderSession(created.id);
    }

    if (turn.aborted) {
      throw new Error('aborted');
    }
    await client.session.promptAsync({
      sessionID: turn.providerSessionId!,
      agent,
      model: parseOpenCodeModel(resolvedModel),
      variant,
      parts: [{ type: 'text', text: promptWithAttachments }],
    });

    await turnFinished;
    completedNormally = !turnError;
  } catch (error) {
    if (!turn.aborted) {
      let message = readErrorMessage(error);
      if (!turn.server && !(await context.isProviderInstalled())) {
        message = NOT_INSTALLED_MESSAGE;
      }
      sendError(message);
      turnError ??= message;
    }
  } finally {
    turnEnded = true;
    // Whatever is still open was asked of a turn that has ended.
    for (const requestId of Array.from(turnPromptIds)) {
      pendingPrompts.get(requestId)?.settle('cancelled');
    }

    if (turn.aborted) {
      await turn.abortFinished;
    }
    connected();
    turn.abortController.abort();
    turn.server?.close();
    await eventLoop;
    for (const requestId of Array.from(turnPromptIds)) {
      pendingPrompts.get(requestId)?.settle('cancelled');
    }
    if (activeTurns.get(turn.key) === turn) {
      activeTurns.delete(turn.key);
    }
  }

  const finalSessionId = turnSessionId();
  if (turn.aborted) {
    // The abort handler sends the terminal `complete` (aborted: true) on this
    // turn's behalf. Settling only after the stop has finished — including a
    // stop that landed while the stream was draining — keeps the chat's
    // safety-net `complete` from arriving first.
    await turn.abortFinished;
    await nextMacrotask();
    return;
  }

  // OpenCode's own database is keyed by the provider-native id.
  const tokenBudget = readOpenCodeTokenUsage(turn.providerSessionId);
  if (tokenBudget) {
    send(createNormalizedMessage({
      kind: 'status',
      text: 'token_budget',
      tokenBudget,
      sessionId: finalSessionId,
      provider: PROVIDER,
    }));
  }

  send(createCompleteMessage({ provider: PROVIDER, sessionId: finalSessionId, exitCode: completedNormally ? 0 : 1 }));

  if (completedNormally) {
    reportRunStopped({
      userId,
      provider: PROVIDER,
      sessionId: finalSessionId,
      sessionName: sessionSummary,
      stopReason: 'completed',
    });
    return;
  }

  reportRunFailed({
    userId,
    provider: PROVIDER,
    sessionId: finalSessionId,
    sessionName: sessionSummary,
    error: turnError ?? 'OpenCode run failed',
  });
  throw new Error(turnError ?? 'OpenCode run failed');
}

/**
 * Stops the turn running for a session: withdraws its open prompts, aborts the
 * OpenCode session so a running tool command ends too, then stops the server.
 * The caller sends the terminal `complete` (aborted: true) once this returns.
 */
async function abortOpenCodeSession(sessionId: string): Promise<boolean> {
  const turn = activeTurns.get(sessionId);
  if (!turn) {
    return false;
  }

  // A second stop (Stop pressed twice, Esc twice) waits for the first one, so
  // the run is reported stopped only once the turn really has been.
  if (turn.aborted) {
    await turn.abortFinished;
    return true;
  }

  // Flagged synchronously so the turn emits no `complete` of its own.
  turn.aborted = true;
  turn.abortFinished = (async () => {
    for (const prompt of Array.from(pendingPrompts.values())) {
      if (prompt.sessionId === sessionId || prompt.sessionId === turn.providerSessionId) {
        prompt.settle('cancelled');
      }
    }

    if (turn.client && turn.providerSessionId) {
      try {
        await withTimeout(
          turn.client.session.abort({ sessionID: turn.providerSessionId }),
          SESSION_ABORT_TIMEOUT_MS,
          'OpenCode did not confirm the abort in time.',
        );
      } catch (error) {
        console.warn('[OpenCode] Session abort failed, stopping the server:', readErrorMessage(error));
      }
    }

    turn.abortController.abort();
    turn.server?.close();
  })();
  turn.finish();

  await turn.abortFinished;
  return true;
}

/**
 * Applies the chat's answer to a pending OpenCode permission or question.
 * Called for every provider's requests, so unknown ids are ignored.
 */
function resolveOpenCodePrompt(requestId: string, decision: ProviderPermissionDecision): void {
  pendingPrompts.get(requestId)?.answer(decision);
}

/**
 * Pending prompts of a session, replayed to a client that subscribes after a
 * refresh. Same shape as the Claude runtime's pending approvals.
 */
function getPendingOpenCodePrompts(sessionId: string) {
  return Array.from(pendingPrompts.values())
    .filter((prompt) => prompt.sessionId === sessionId)
    .map((prompt) => ({
      requestId: prompt.requestId,
      toolName: prompt.toolName,
      input: prompt.input,
      context: prompt.context,
      sessionId,
      receivedAt: prompt.receivedAt,
    }));
}

/**
 * Whether a turn is running for a session. Used by the OpenCode sessions
 * provider, which treats subagents of a running turn as still in progress.
 */
export function isOpenCodeSessionActive(sessionId: string): boolean {
  return activeTurns.has(sessionId);
}

/**
 * The OpenCode runtime facet. Used by the OpenCode provider wrapper, through
 * which providerRuntimeService runs chat turns, scheduled messages and
 * /api/agent runs, and routes the chat's permission answers.
 */
export const opencodeRuntime = {
  run: runOpenCodeTurn,
  abort: abortOpenCodeSession,
  permissions: {
    resolve: resolveOpenCodePrompt,
    listPending: getPendingOpenCodePrompts,
  },
};

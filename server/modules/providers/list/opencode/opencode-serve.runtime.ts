/**
 * OpenCode chat turns over a private `opencode serve` (issue #1569).
 *
 * This re-implements the non-interactive loop of `opencode run --format json`
 * (OpenCode v1.18.x, packages/opencode/src/cli/cmd/run.ts) on top of
 * OpenCode's HTTP API, with one difference that is the point of the module:
 * permission requests and the agent's questions are handed to the chat user
 * instead of being rejected or hidden.
 *
 * - The JSON objects this module produces are exactly the lines `run` prints
 *   (`{ type, timestamp, sessionID, ...data }`), so OpenCode's
 *   `normalizeMessage` and the session history reader see the same input as
 *   before and stay untouched.
 * - `permission.asked` becomes a `permission_request` frame (Allow once,
 *   Always allow, Deny → `once` / `always` / `reject`); `question.asked`
 *   becomes a `permission_request` for the `question` tool, which the chat
 *   renders with its question panel (answers → `question/reply`, Skip →
 *   `question/reject`). The provider-neutral plumbing (`permissions.resolve`,
 *   `permissions.listPending`, `permission_resolved` / `permission_cancelled`
 *   frames) is the one the Claude runtime already uses.
 * - The user's own OpenCode permission config is untouched: a `deny` rule is
 *   never asked and an `allow` rule never prompts; only `ask` reaches the user.
 */
import {
  createNotificationEvent,
  notifyRunFailed,
  notifyRunStopped,
  notifyUserIfEnabled,
} from '@/modules/notifications/index.js';
import {
  OpenCodeServerProcess,
  OpenCodeServerUnavailableError,
} from '@/modules/providers/list/opencode/opencode-server.process.js';
import { appendFilesInputTag, appendImagesInputTag } from '@/shared/image-attachments.js';
import type {
  AnyRecord,
  NormalizedMessage,
  ProviderPermissionDecision,
  ProviderRuntimeContext,
  ProviderRuntimePermissionGateway,
  ProviderRuntimeWriter,
} from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

const PROVIDER = 'opencode';

// Same default as the Claude runtime's tool approvals: a turn nobody answers
// does not hold a server (about 480 MB) for long. `0` waits indefinitely.
const DEFAULT_PERMISSION_TIMEOUT_MS = 55_000;
// A question is addressed to the user, so it may wait much longer — but not
// forever, or a detached run (scheduled message) could never end.
const DEFAULT_QUESTION_TIMEOUT_MS = 30 * 60 * 1000;
// The prompt request and the session's `idle` status travel on different
// connections; once the prompt has answered, the idle event (and the final
// part updates before it) gets this long to arrive.
const IDLE_AFTER_PROMPT_GRACE_MS = 3_000;
// A failed prompt answers with a generic HTTP 500 while the real reason comes
// as a `session.error` event shortly after; wait this long for it.
const SESSION_ERROR_GRACE_MS = 1_500;
// Bounds both the abort request and the wait for the session to go idle
// after it (OpenCode ends a running tool command before it reports idle).
const SESSION_ABORT_TIMEOUT_MS = 3_000;
// How long a failed prompt request or a closed event stream waits to see
// whether the server died.
const SERVER_EXIT_GRACE_MS = 1_000;
// Upper bound on remembered "Always allow" rules per chat session.
const MAX_REMEMBERED_RULES_PER_SESSION = 200;

// Mirrors `opencode run`: plan_enter/plan_exit switch agents interactively,
// which a chat turn cannot follow, so they stay hidden as they were.
const PLAN_SWITCH_DENY_RULES = [
  { permission: 'plan_enter', pattern: '*', action: 'deny' },
  { permission: 'plan_exit', pattern: '*', action: 'deny' },
];
// Completes `run`'s non-interactive rule set, kept for bypassPermissions.
const QUESTION_DENY_RULE = { permission: 'question', pattern: '*', action: 'deny' };
const QUESTION_ALLOW_RULE = { permission: 'question', pattern: '*', action: 'allow' };

type OpenCodePermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

type RememberedRule = { permission: string; pattern: string };

type TurnEndReason = 'completed' | 'aborted' | 'server-exit' | 'stream-closed';

type PendingOpenCodeRequest = {
  requestId: string;
  /** The turn that raised it; its end withdraws whatever is still open. */
  owner: OpenCodeServeTurn;
  /** App session id (provider id for legacy callers), the `chat.subscribe` lookup key. */
  sessionKey: string | null;
  toolName: string;
  input: unknown;
  context: AnyRecord;
  receivedAt: Date;
  timer: NodeJS.Timeout | null;
  /** Applies a client's decision; called only while the request is open. */
  answer(decision: ProviderPermissionDecision): void;
};

type OpenCodeQuestion = {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiple: boolean;
  custom: boolean;
};

/**
 * Helpers the runtime adapter (opencode-runtime.provider.js) shares with its
 * `opencode run` path, passed in so this module never imports it back.
 */
type OpenCodeServeHelpers = {
  resolveEffort(model: string | undefined, effort: unknown, modelsDefinition: unknown): string | undefined;
  readTokenUsage(providerSessionId: string | null): unknown;
};

/**
 * The notifications module is plain JavaScript whose `= null` parameter
 * defaults make TypeScript infer `null` as the only session id and dedupe key
 * it accepts. These are the shapes it really takes (see the Claude runtime).
 */
type RunNotification = { userId: unknown; provider: string; sessionId: string | null; sessionName?: unknown };
const notifyTurnStopped = notifyRunStopped as unknown as (input: RunNotification & { stopReason: string }) => void;
const notifyTurnFailed = notifyRunFailed as unknown as (input: RunNotification & { error: string }) => void;
const buildActionRequiredEvent = createNotificationEvent as unknown as (input: {
  provider: string;
  sessionId: string | null;
  kind: string;
  code: string;
  meta: AnyRecord;
  severity: string;
  requiresUserAction: boolean;
  dedupeKey: string;
}) => ReturnType<typeof createNotificationEvent>;

/** Open permission/question requests across every running turn, by OpenCode request id. */
const pendingRequests = new Map<string, PendingOpenCodeRequest>();
/**
 * "Always allow" rules per chat session. OpenCode keeps them only in its
 * server's memory, which a per-turn server forgets, so later turns of the same
 * chat answer matching requests from here. In memory only, never persisted,
 * and never broader than the patterns the user approved.
 */
const rememberedApprovals = new Map<string, RememberedRule[]>();
/** Running turns by run key (app session id, or the provider id for legacy callers). */
const activeTurns = new Map<string, OpenCodeServeTurn>();

const isRecord = (value: unknown): value is AnyRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

function readTimeoutMs(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readPermissionMode(value: unknown): OpenCodePermissionMode {
  return value === 'acceptEdits' || value === 'plan' || value === 'bypassPermissions' ? value : 'default';
}

function isTruthyFlag(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Port of OpenCode's `Wildcard.match`: `*` and `?` globs, a trailing ` *` that
 * also matches the bare command, `\` treated as `/`, case-insensitive on
 * Windows. Exported for tests only.
 */
export function matchesOpenCodeWildcard(input: string, pattern: string): boolean {
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

function isRememberedApproval(sessionKey: string | null, permission: string, patterns: string[]): boolean {
  const rules = sessionKey ? rememberedApprovals.get(sessionKey) : undefined;
  if (!rules || rules.length === 0 || patterns.length === 0) {
    return false;
  }
  return patterns.every((pattern) => rules.some((rule) =>
    matchesOpenCodeWildcard(permission, rule.permission) && matchesOpenCodeWildcard(pattern, rule.pattern)));
}

function rememberApproval(sessionKey: string | null, permission: string, patterns: string[]): void {
  if (!sessionKey || patterns.length === 0) {
    return;
  }
  const rules = rememberedApprovals.get(sessionKey) ?? [];
  for (const pattern of patterns) {
    if (!rules.some((rule) => rule.permission === permission && rule.pattern === pattern)) {
      rules.push({ permission, pattern });
    }
  }
  rememberedApprovals.set(sessionKey, rules.slice(-MAX_REMEMBERED_RULES_PER_SESSION));
}

/**
 * Maps one OpenCode server event onto the JSON object `opencode run --format
 * json` prints for it, or null when `run` prints nothing for it. Same
 * conditions as run.ts: only the main session's parts, tool parts once they
 * completed or failed, text parts once they have ended, step boundaries, and
 * session errors. (`reasoning` needs `--thinking`, which CloudCLI never
 * passed.) Exported for tests only.
 */
export function mapOpenCodeEventToRunJson(
  type: string,
  properties: AnyRecord,
  mainSessionId: string,
): AnyRecord | null {
  const emit = (runType: string, data: AnyRecord): AnyRecord => ({
    type: runType,
    timestamp: Date.now(),
    sessionID: mainSessionId,
    ...data,
  });

  if (type === 'message.part.updated') {
    const part = properties.part;
    if (!isRecord(part) || part.sessionID !== mainSessionId) {
      return null;
    }
    const status = isRecord(part.state) ? part.state.status : undefined;
    if (part.type === 'tool' && (status === 'completed' || status === 'error')) {
      return emit('tool_use', { part });
    }
    if (part.type === 'step-start') {
      return emit('step_start', { part });
    }
    if (part.type === 'step-finish') {
      return emit('step_finish', { part });
    }
    if (part.type === 'text' && isRecord(part.time) && part.time.end) {
      return emit('text', { part });
    }
    return null;
  }

  if (type === 'session.error' && properties.sessionID === mainSessionId && properties.error) {
    return emit('error', { error: properties.error });
  }

  return null;
}

function readQuestions(value: unknown): OpenCodeQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map((entry) => ({
    question: readString(entry.question) ?? '',
    header: readString(entry.header),
    options: (Array.isArray(entry.options) ? entry.options : [])
      .filter(isRecord)
      .map((option) => ({ label: String(option.label ?? ''), description: readString(option.description) })),
    multiple: entry.multiple === true,
    custom: entry.custom !== false,
  }));
}

/**
 * The chat answers a question with `updatedInput.answers`: one list of picked
 * labels (plus any typed answer) per question, in question order — OpenCode's
 * own reply shape. A Claude-style `{ [question]: "answer" }` map from an older
 * client still works; anything unreadable counts as "no answer" for that
 * question rather than leaving the agent waiting.
 */
function toAnswerLists(updatedInput: unknown, questions: OpenCodeQuestion[]): string[][] {
  const answers = isRecord(updatedInput) ? updatedInput.answers : undefined;
  return questions.map((question, index) => {
    const value = Array.isArray(answers)
      ? answers[index]
      : isRecord(answers) ? answers[question.question] : undefined;
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    }
    return typeof value === 'string' && value.trim() ? [value] : [];
  });
}

/** Splits `provider/model` at the first slash, as `opencode run --model` does. */
function toModelReference(model: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!model) {
    return undefined;
  }
  const [providerID, ...rest] = model.split('/');
  return { providerID, modelID: rest.join('/') };
}

/** Last rule whose permission glob covers `permission`, as OpenCode evaluates rulesets. */
function findLastRuleFor(rules: unknown, permission: string): AnyRecord | undefined {
  if (!Array.isArray(rules)) {
    return undefined;
  }
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule: unknown = rules[index];
    if (isRecord(rule) && typeof rule.permission === 'string' && matchesOpenCodeWildcard(permission, rule.permission)) {
      return rule;
    }
  }
  return undefined;
}

const isWholeDeny = (rule: AnyRecord | undefined): boolean =>
  rule !== undefined && rule.pattern === '*' && rule.action === 'deny';

/** Removes an open request; false when it was already settled. */
function settleRequest(requestId: string, owner?: OpenCodeServeTurn): PendingOpenCodeRequest | null {
  const entry = pendingRequests.get(requestId);
  if (!entry || (owner && entry.owner !== owner)) {
    return null;
  }
  pendingRequests.delete(requestId);
  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  return entry;
}

function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const poll = () => {
      if (condition() || Date.now() - startedAt >= timeoutMs) {
        resolve();
        return;
      }
      setTimeout(poll, 50);
    };
    poll();
  });
}

/**
 * The server's environment per permission mode. acceptEdits forces
 * `edit: allow` through OPENCODE_PERMISSION, which OpenCode merges over the
 * user's config (verified with `opencode serve` 1.18.25); every other rule
 * stays the user's. plan and bypassPermissions act per request instead.
 */
function buildServerEnv(mode: OpenCodePermissionMode): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (mode === 'acceptEdits') {
    env.OPENCODE_PERMISSION = JSON.stringify({ edit: 'allow' });
  }
  return env;
}

/**
 * One OpenCode chat turn over its own private server. All state lives on the
 * instance so an abort can arrive at any await without touching state that is
 * not set up yet.
 */
class OpenCodeServeTurn {
  key: string;
  aborted = false;

  private readonly appSessionId: string | null;
  private readonly providerSessionId: string | null;
  private readonly mode: OpenCodePermissionMode;
  private capturedSessionId: string | null;
  private mainSessionId: string | null = null;
  private server: OpenCodeServerProcess | null = null;
  private readonly startController = new AbortController();
  /** Sessions whose requests belong to this turn: ours plus subagent children. */
  private readonly family = new Set<string>();
  private idleSeen = false;
  private promptSettled = false;
  private sessionErrorSeen = false;
  private errorText: string | null = null;
  private graceTimer: NodeJS.Timeout | null = null;
  private readonly turnEnded: Promise<TurnEndReason>;
  private endTurn: (reason: TurnEndReason) => void = () => {};

  constructor(
    private readonly command: string,
    private readonly options: AnyRecord,
    private readonly writer: ProviderRuntimeWriter,
    private readonly context: ProviderRuntimeContext,
    private readonly helpers: OpenCodeServeHelpers,
  ) {
    this.appSessionId = readString(options.sessionId) ?? null;
    // Callers pass the stable app session id; OpenCode resumes by its own id.
    this.providerSessionId = context.resolveProviderSessionId(this.appSessionId);
    this.capturedSessionId = this.providerSessionId;
    this.mode = readPermissionMode(options.permissionMode);
    // Run-map key: the app session id when the caller supplied one, so abort
    // by app id always works; legacy callers are re-keyed to the provider id.
    this.key = this.appSessionId ?? Date.now().toString();
    this.turnEnded = new Promise<TurnEndReason>((resolve) => {
      this.endTurn = resolve;
    });
  }

  private frameSessionId(): string | null {
    return this.capturedSessionId || this.appSessionId || null;
  }

  private rememberKey(): string | null {
    return this.appSessionId || this.capturedSessionId || null;
  }

  private send(message: NormalizedMessage): void {
    this.writer.send(message);
  }

  private sendError(content: string): void {
    this.send(createNormalizedMessage({ kind: 'error', content, sessionId: this.frameSessionId(), provider: PROVIDER }));
  }

  /** Same path `run`'s JSON lines took: normalize and forward. */
  private emitRunEvent(runEvent: AnyRecord): void {
    if (runEvent.type === 'error') {
      const errorValue = isRecord(runEvent.error) ? runEvent.error : {};
      const data = isRecord(errorValue.data) ? errorValue.data : {};
      this.errorText = readString(data.message) ?? readString(errorValue.message) ?? 'OpenCode reported an error';
    }
    try {
      for (const message of this.context.normalizeMessage(runEvent, this.frameSessionId())) {
        this.send(message);
      }
    } catch (error) {
      console.error('[OpenCode] Failed to process server event:', describeError(error));
      this.sendError(describeError(error));
    }
  }

  async run(): Promise<void> {
    const promptText = appendFilesInputTag(
      appendImagesInputTag(typeof this.command === 'string' ? this.command.trim() : '', this.options.images),
      this.options.files,
    );
    if (!promptText.trim()) {
      // Nothing to send; the `run` path reports this exactly as it always has.
      throw new OpenCodeServerUnavailableError('there is no prompt to send');
    }

    activeTurns.set(this.key, this);
    try {
      await this.execute(promptText);
    } finally {
      if (this.graceTimer) {
        clearTimeout(this.graceTimer);
      }
      this.withdrawOpenRequests('cancelled');
      if (activeTurns.get(this.key) === this) {
        activeTurns.delete(this.key);
      }
      if (this.server && !this.server.hasExited()) {
        void this.server.stop();
      }
    }
  }

  private async execute(promptText: string): Promise<void> {
    const resolvedModel = await this.context.resolveResumeModel(this.appSessionId ?? undefined, this.options.model);
    let effortModels: unknown = null;
    try {
      effortModels = await this.context.getProviderModels();
    } catch (error) {
      console.warn('[OpenCode] Unable to load provider models for effort validation:', error);
    }
    const resolvedEffort = this.helpers.resolveEffort(resolvedModel, this.options.effort, effortModels);
    if (this.aborted) {
      return;
    }

    const workingDir = readString(this.options.cwd) ?? readString(this.options.projectPath) ?? process.cwd();
    try {
      this.server = await OpenCodeServerProcess.start({
        cwd: workingDir,
        env: buildServerEnv(this.mode),
        signal: this.startController.signal,
      });
    } catch (error) {
      if (this.aborted) {
        return;
      }
      throw error;
    }
    const server = this.server;
    server.onExit(() => this.endTurn('server-exit'));

    const prepared = await this.prepareSession(server);
    if (!prepared) {
      return;
    }
    const { sessionId, eventsClosed } = prepared;

    const promptBody: AnyRecord = { parts: [{ type: 'text', text: promptText }] };
    const modelReference = toModelReference(resolvedModel);
    if (modelReference) {
      promptBody.model = modelReference;
    }
    if (resolvedEffort) {
      promptBody.variant = resolvedEffort;
    }
    if (this.mode === 'plan') {
      promptBody.agent = 'plan';
    }

    if (!this.aborted) {
      void server
        .requestLong('POST', `/session/${encodeURIComponent(sessionId)}/message`, promptBody)
        .then((response) => this.onPromptAnswered(sessionId, response), async (error: unknown) => {
          this.promptSettled = true;
          // A dying server resets the prompt's connection before its exit
          // event arrives; that exit is the error worth reporting.
          await waitFor(() => this.aborted || server.hasExited(), SERVER_EXIT_GRACE_MS);
          if (this.aborted || server.hasExited()) {
            return;
          }
          this.emitRunEvent({
            type: 'error',
            timestamp: Date.now(),
            sessionID: sessionId,
            error: { name: 'UnknownError', data: { message: describeError(error) } },
          });
          this.endTurn('completed');
        });
      void eventsClosed.then(async () => {
        // A dying server drops the stream before its exit event arrives.
        await waitFor(() => this.aborted || server.hasExited(), SERVER_EXIT_GRACE_MS);
        this.endTurn(server.hasExited() ? 'server-exit' : 'stream-closed');
      });
    }

    const reason = await this.turnEnded;
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
    }
    if (reason === 'aborted' || this.aborted) {
      await server.stop();
      return;
    }

    if (reason === 'server-exit') {
      const stderrTail = server.readStderrTail().trim().slice(-500);
      this.errorText = `The OpenCode server exited unexpectedly${stderrTail ? `: ${stderrTail}` : ''}`;
      this.sendError(this.errorText);
    } else if (reason === 'stream-closed') {
      this.errorText = 'Lost the event stream of the OpenCode server';
      this.sendError(this.errorText);
      await server
        .request('POST', `/session/${encodeURIComponent(sessionId)}/abort`, undefined, SESSION_ABORT_TIMEOUT_MS)
        .catch(() => undefined);
    }

    this.withdrawOpenRequests(reason === 'completed' ? 'completed' : 'error');
    await server.stop();
    // `opencode run` exits 1 whenever it printed an error.
    await this.finish(this.errorText ? 1 : 0);
  }

  /**
   * Probes the API, subscribes to events and creates or resumes the session.
   * Every failure before the prompt can still fall back to `opencode run`:
   * nothing has reached the model or the client yet. Resolves null when the
   * turn already ended here (aborted, or the resumed session is missing).
   */
  private async prepareSession(
    server: OpenCodeServerProcess,
  ): Promise<{ sessionId: string; eventsClosed: Promise<void> } | null> {
    let config: AnyRecord = {};
    let eventsClosed: Promise<void> = Promise.resolve();
    let session: AnyRecord | null = null;
    try {
      const permissions = await server.request('GET', '/permission');
      const questions = await server.request('GET', '/question');
      if (permissions.status !== 200 || !Array.isArray(permissions.body)
        || questions.status !== 200 || !Array.isArray(questions.body)) {
        throw new OpenCodeServerUnavailableError(
          `the server has no permission/question API (HTTP ${permissions.status}/${questions.status})`,
        );
      }
      ({ closed: eventsClosed } = await server.subscribeEvents((type, properties) => this.onEvent(type, properties)));
      const configResponse = await server.request('GET', '/config');
      config = isRecord(configResponse.body) ? configResponse.body : {};

      if (this.providerSessionId) {
        const existing = await server.request('GET', `/session/${encodeURIComponent(this.providerSessionId)}`);
        if (existing.status === 200 && isRecord(existing.body) && readString(existing.body.id)) {
          session = existing.body;
        }
      } else {
        const created = await server.request('POST', '/session', {
          permission: this.mode === 'bypassPermissions'
            ? [QUESTION_DENY_RULE, ...PLAN_SWITCH_DENY_RULES]
            : PLAN_SWITCH_DENY_RULES,
        });
        if (created.status !== 200 || !isRecord(created.body) || !readString(created.body.id)) {
          throw new OpenCodeServerUnavailableError(`creating the session answered HTTP ${created.status}`);
        }
        session = created.body;
      }
    } catch (error) {
      await server.stop();
      if (this.aborted) {
        return null;
      }
      throw error instanceof OpenCodeServerUnavailableError
        ? error
        : new OpenCodeServerUnavailableError(describeError(error));
    }

    if (this.aborted) {
      return null;
    }
    if (!session) {
      // `opencode run --session` prints the same and exits 1.
      this.errorText = 'Session not found';
      this.sendError(this.errorText);
      await server.stop();
      await this.finish(1);
      return null;
    }

    const sessionId = String(session.id);
    this.family.add(sessionId);
    this.registerSession(sessionId);

    if (this.providerSessionId && this.mode !== 'bypassPermissions') {
      const agentName = this.mode === 'plan' ? 'plan' : readString(config.default_agent) ?? 'build';
      await enableQuestionToolIfHidden(server, session, agentName);
    }
    // `opencode run` shares every session it runs when the user's config (or
    // OPENCODE_AUTO_SHARE) asks for it; keep doing so.
    if (config.share === 'auto' || isTruthyFlag(process.env.OPENCODE_AUTO_SHARE)) {
      void server.request('POST', `/session/${encodeURIComponent(sessionId)}/share`).catch(() => undefined);
    }
    return { sessionId, eventsClosed };
  }

  private registerSession(nextSessionId: string): void {
    this.mainSessionId = nextSessionId;
    if (this.capturedSessionId === nextSessionId) {
      return;
    }
    this.capturedSessionId = nextSessionId;
    if (!this.appSessionId && activeTurns.get(this.key) === this) {
      activeTurns.delete(this.key);
      this.key = nextSessionId;
      activeTurns.set(this.key, this);
    }
    this.writer.setSessionId?.(nextSessionId);
    if (!this.providerSessionId) {
      this.send(createNormalizedMessage({
        kind: 'session_created',
        newSessionId: nextSessionId,
        sessionId: nextSessionId,
        provider: PROVIDER,
      }));
    }
  }

  private async onPromptAnswered(sessionId: string, response: { status: number; body: unknown }): Promise<void> {
    this.promptSettled = true;
    if (response.status >= 200 && response.status < 300) {
      if (this.idleSeen) {
        this.endTurn('completed');
        return;
      }
      this.graceTimer = setTimeout(() => this.endTurn('completed'), IDLE_AFTER_PROMPT_GRACE_MS);
      return;
    }
    // The HTTP body of a failed prompt is a generic "Unexpected server
    // error"; the session.error event carries the real reason.
    await waitFor(() => this.sessionErrorSeen || this.idleSeen, SESSION_ERROR_GRACE_MS);
    if (!this.sessionErrorSeen && !this.aborted) {
      this.emitRunEvent({
        type: 'error',
        timestamp: Date.now(),
        sessionID: sessionId,
        error: isRecord(response.body)
          ? response.body
          : { name: 'UnknownError', data: { message: String(response.body || `HTTP ${response.status}`) } },
      });
    }
    this.endTurn('completed');
  }

  private onEvent(type: string, properties: AnyRecord): void {
    const mainSessionId = this.mainSessionId;
    if (!mainSessionId) {
      return;
    }
    if (type === 'session.status') {
      if (properties.sessionID === mainSessionId && isRecord(properties.status) && properties.status.type === 'idle') {
        this.idleSeen = true;
        if (this.promptSettled) {
          this.endTurn('completed');
        }
      }
      return;
    }
    // An aborted turn shows nothing more (OpenCode reports the abort itself
    // as a MessageAbortedError the user does not need to see).
    if (this.aborted) {
      return;
    }

    switch (type) {
      case 'session.created': {
        const info = isRecord(properties.info) ? properties.info : {};
        if (typeof info.parentID === 'string' && this.family.has(info.parentID) && typeof info.id === 'string') {
          this.family.add(info.id);
        }
        return;
      }
      case 'message.part.updated':
      case 'session.error': {
        const runEvent = mapOpenCodeEventToRunJson(type, properties, mainSessionId);
        if (runEvent) {
          if (runEvent.type === 'error') {
            this.sessionErrorSeen = true;
          }
          this.emitRunEvent(runEvent);
        }
        return;
      }
      case 'permission.asked':
        if (typeof properties.sessionID === 'string' && this.family.has(properties.sessionID)) {
          this.onPermissionAsked(properties);
        }
        return;
      case 'question.asked':
        if (typeof properties.sessionID === 'string' && this.family.has(properties.sessionID)) {
          this.onQuestionAsked(properties);
        }
        return;
      case 'permission.replied':
      case 'question.replied':
      case 'question.rejected': {
        // OpenCode settled a request without this turn answering it: the
        // cascade after "Always allow" or "Deny", or another client's reply.
        const requestId = readString(properties.requestID);
        if (requestId && settleRequest(requestId, this)) {
          this.send(this.resolvedFrame(requestId));
        }
        return;
      }
      default:
    }
  }

  private resolvedFrame(requestId: string): NormalizedMessage {
    return createNormalizedMessage({
      kind: 'permission_resolved',
      requestId,
      sessionId: this.frameSessionId(),
      provider: PROVIDER,
    });
  }

  /** Fire-and-forget reply; 404 means OpenCode settled the request meanwhile. */
  private postReply(pathname: string, body?: unknown): void {
    const server = this.server;
    if (!server) {
      return;
    }
    void server.request('POST', pathname, body).then((response) => {
      if (response.status >= 400 && response.status !== 404) {
        console.warn(`[OpenCode] ${pathname} answered HTTP ${response.status}`);
      }
    }).catch((error: unknown) => {
      if (!this.aborted) {
        console.warn(`[OpenCode] ${pathname} failed:`, describeError(error));
      }
    });
  }

  private replyPermission(requestId: string, reply: 'once' | 'always' | 'reject'): void {
    this.postReply(`/permission/${encodeURIComponent(requestId)}/reply`, { reply });
  }

  /** Opens a prompt in the chat, with its timeout and an action-required notification. */
  private openRequest(
    entry: Omit<PendingOpenCodeRequest, 'timer' | 'owner' | 'sessionKey' | 'receivedAt'>,
    timeoutMs: number,
    onTimeout: () => void,
  ): void {
    const registered: PendingOpenCodeRequest = {
      ...entry,
      owner: this,
      sessionKey: this.rememberKey(),
      receivedAt: new Date(),
      timer: null,
    };
    if (timeoutMs > 0) {
      registered.timer = setTimeout(() => {
        if (settleRequest(registered.requestId, this)) {
          onTimeout();
          this.send(createNormalizedMessage({
            kind: 'permission_cancelled',
            requestId: registered.requestId,
            reason: 'timeout',
            sessionId: this.frameSessionId(),
            provider: PROVIDER,
          }));
        }
      }, timeoutMs);
    }
    pendingRequests.set(registered.requestId, registered);
    this.send(createNormalizedMessage({
      kind: 'permission_request',
      requestId: registered.requestId,
      toolName: registered.toolName,
      input: registered.input,
      context: registered.context,
      sessionId: this.frameSessionId(),
      provider: PROVIDER,
    }));
    notifyUserIfEnabled({
      userId: this.writer.userId || null,
      event: buildActionRequiredEvent({
        provider: PROVIDER,
        sessionId: this.appSessionId || this.capturedSessionId || null,
        kind: 'action_required',
        code: 'permission.required',
        meta: { toolName: registered.toolName, sessionName: this.options.sessionSummary },
        severity: 'warning',
        requiresUserAction: true,
        dedupeKey: `${PROVIDER}:permission:${this.appSessionId || this.capturedSessionId || 'none'}:${registered.requestId}`,
      }),
    });
  }

  private onPermissionAsked(asked: AnyRecord): void {
    const requestId = readString(asked.id);
    if (!requestId || pendingRequests.has(requestId)) {
      return;
    }
    const permission = readString(asked.permission) ?? 'unknown';
    const patterns = readStringArray(asked.patterns);
    const always = readStringArray(asked.always);

    // bypassPermissions answers like `opencode run --auto`; a request whose
    // patterns the user already chose "Always allow" for in this chat needs
    // no new prompt.
    if (this.mode === 'bypassPermissions' || isRememberedApproval(this.rememberKey(), permission, patterns)) {
      this.replyPermission(requestId, 'once');
      return;
    }

    const sessionKey = this.rememberKey();
    this.openRequest({
      requestId,
      toolName: permission,
      input: { ...(isRecord(asked.metadata) ? asked.metadata : {}), patterns },
      context: {
        permission,
        patterns,
        // What "Always allow" approves; the chat banner shows it.
        always,
        sessionID: readString(asked.sessionID) ?? null,
        tool: isRecord(asked.tool) ? asked.tool : null,
      },
      answer: (decision) => {
        if (!settleRequest(requestId, this)) {
          return;
        }
        // Deny is a plain reject, which ends the turn like OpenCode's own
        // Reject; a reject carrying a message would instead hand the text to
        // the model as feedback and let it carry on.
        const reply = !decision.allow ? 'reject' : decision.rememberEntry ? 'always' : 'once';
        if (reply === 'always') {
          rememberApproval(sessionKey, permission, always);
        }
        this.send(this.resolvedFrame(requestId));
        this.replyPermission(requestId, reply);
      },
    }, readTimeoutMs('OPENCODE_TOOL_APPROVAL_TIMEOUT_MS', DEFAULT_PERMISSION_TIMEOUT_MS), () => {
      this.replyPermission(requestId, 'reject');
    });
  }

  private onQuestionAsked(asked: AnyRecord): void {
    const requestId = readString(asked.id);
    if (!requestId || pendingRequests.has(requestId)) {
      return;
    }
    const rejectPath = `/question/${encodeURIComponent(requestId)}/reject`;
    // Unattended runs (bypassPermissions, /api/agent) cannot answer; they only
    // see the tool at all on a resumed session that allows it.
    if (this.mode === 'bypassPermissions') {
      this.postReply(rejectPath);
      return;
    }

    const questions = readQuestions(asked.questions);
    this.openRequest({
      requestId,
      toolName: 'question',
      input: {
        questions: questions.map((question) => ({
          question: question.question,
          header: question.header,
          options: question.options,
          multiSelect: question.multiple,
          custom: question.custom,
        })),
      },
      context: {
        kind: 'question',
        // Tells the chat's question panel to answer with one label list per
        // question, OpenCode's reply shape.
        answerFormat: 'label-lists',
        agentName: 'OpenCode',
        sessionID: readString(asked.sessionID) ?? null,
        tool: isRecord(asked.tool) ? asked.tool : null,
      },
      answer: (decision) => {
        if (!settleRequest(requestId, this)) {
          return;
        }
        this.send(this.resolvedFrame(requestId));
        if (decision.allow) {
          this.postReply(`/question/${encodeURIComponent(requestId)}/reply`, {
            answers: toAnswerLists(decision.updatedInput, questions),
          });
          return;
        }
        this.postReply(rejectPath);
      },
    }, readTimeoutMs('OPENCODE_QUESTION_TIMEOUT_MS', DEFAULT_QUESTION_TIMEOUT_MS), () => {
      this.postReply(rejectPath);
    });
  }

  /** Withdraws this turn's open prompts from every client. */
  private withdrawOpenRequests(reason: string): void {
    for (const entry of [...pendingRequests.values()]) {
      if (entry.owner === this && settleRequest(entry.requestId, this)) {
        this.send(createNormalizedMessage({
          kind: 'permission_cancelled',
          requestId: entry.requestId,
          reason,
          sessionId: this.frameSessionId(),
          provider: PROVIDER,
        }));
      }
    }
  }

  /**
   * Stops the turn on the user's behalf: prompts are withdrawn, OpenCode
   * aborts the session (which ends a tool command that is still running —
   * stopping the server alone would orphan it), then the server stops.
   */
  async abort(): Promise<void> {
    if (this.aborted) {
      return;
    }
    this.aborted = true;
    this.startController.abort();
    this.withdrawOpenRequests('cancelled');
    const server = this.server;
    if (server && this.mainSessionId) {
      await server
        .request('POST', `/session/${encodeURIComponent(this.mainSessionId)}/abort`, undefined, SESSION_ABORT_TIMEOUT_MS)
        .catch(() => undefined);
      if (!this.promptSettled) {
        await waitFor(() => this.idleSeen || server.hasExited(), SESSION_ABORT_TIMEOUT_MS);
      }
    }
    this.endTurn('aborted');
    // Startup awaits (probe, event stream, session create) fail fast once the
    // server is gone.
    void server?.stop();
  }

  private async finish(exitCode: number): Promise<void> {
    if (activeTurns.get(this.key) === this) {
      activeTurns.delete(this.key);
    }
    const finalSessionId = this.appSessionId || this.capturedSessionId || this.key;
    const tokenBudget = this.helpers.readTokenUsage(this.capturedSessionId);
    if (tokenBudget) {
      this.send(createNormalizedMessage({
        kind: 'status',
        text: 'token_budget',
        tokenBudget,
        sessionId: finalSessionId,
        provider: PROVIDER,
      }));
    }
    this.send(createCompleteMessage({ provider: PROVIDER, sessionId: finalSessionId, exitCode }));

    const userId = this.writer.userId || null;
    const sessionName = this.options.sessionSummary;
    if (exitCode === 0) {
      notifyTurnStopped({ userId, provider: PROVIDER, sessionId: finalSessionId, sessionName, stopReason: 'completed' });
      return;
    }
    const failure = this.errorText || 'OpenCode run failed';
    notifyTurnFailed({ userId, provider: PROVIDER, sessionId: finalSessionId, sessionName, error: failure });
    throw new Error(failure);
  }
}

/**
 * Sessions created by `opencode run` (every CloudCLI OpenCode chat before
 * this runtime) carry a persisted `question: deny` rule that hides the
 * question tool for good. OpenCode evaluates the session's rules after the
 * agent's, so appending `question: allow` brings the tool back — but only when
 * the agent's own rules (which include the user's config) do not hide it too:
 * a user who denied questions keeps them denied. The PATCH appends (it cannot
 * remove rules) and is skipped once the last session rule already allows.
 */
async function enableQuestionToolIfHidden(
  server: OpenCodeServerProcess,
  session: AnyRecord,
  agentName: string,
): Promise<void> {
  if (!isWholeDeny(findLastRuleFor(session.permission, 'question'))) {
    return;
  }
  try {
    const agents = await server.request('GET', '/agent');
    const agent = Array.isArray(agents.body)
      ? agents.body.filter(isRecord).find((candidate) => candidate.name === agentName)
      : undefined;
    if (!agent || isWholeDeny(findLastRuleFor(agent.permission, 'question'))) {
      return;
    }
    await server.request('PATCH', `/session/${encodeURIComponent(String(session.id))}`, {
      permission: [QUESTION_ALLOW_RULE],
    });
  } catch (error) {
    console.warn('[OpenCode] Could not re-enable the question tool:', describeError(error));
  }
}

/**
 * Runs one OpenCode chat turn over a private `opencode serve`.
 *
 * Used by the OpenCode runtime adapter (opencode-runtime.provider.js) as its
 * first choice. Rejects with OpenCodeServerUnavailableError — before anything
 * was sent to the model or the client — when the server cannot be started or
 * lacks the permission/question API; the adapter then runs `opencode run`.
 * Otherwise it behaves like the `run` path: exactly one terminal `complete`
 * (none after an abort, whose handler sends it), resolve on success, reject
 * when the turn reported an error.
 */
export function runOpenCodeServeTurn(
  command: string,
  options: AnyRecord,
  writer: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
  helpers: OpenCodeServeHelpers,
): Promise<void> {
  return new OpenCodeServeTurn(command, options, writer, context, helpers).run();
}

/**
 * Aborts a running serve turn; resolves once OpenCode has aborted the session.
 * Resolves false when no serve turn runs under `key`. Used by the OpenCode
 * runtime adapter's abort.
 */
export async function abortOpenCodeServeTurn(key: string): Promise<boolean> {
  const turn = activeTurns.get(key);
  if (!turn) {
    return false;
  }
  activeTurns.delete(key);
  await turn.abort();
  return true;
}

/** Whether a serve turn runs under `key`. Used by the OpenCode runtime adapter. */
export function hasOpenCodeServeTurn(key: string): boolean {
  return activeTurns.has(key);
}

/** Keys of every running serve turn. Used by the OpenCode runtime adapter. */
export function listOpenCodeServeTurnKeys(): string[] {
  return Array.from(activeTurns.keys());
}

/**
 * The OpenCode runtime's permission gateway (opencodeRuntime.permissions):
 * the chat websocket resolves prompts through it and replays the open ones to
 * a client that (re)subscribes.
 */
export const openCodeServePermissions: ProviderRuntimePermissionGateway = {
  resolve(requestId, decision) {
    pendingRequests.get(requestId)?.answer(decision);
  },
  listPending(sessionId) {
    return [...pendingRequests.values()]
      .filter((entry) => entry.sessionKey === sessionId)
      .map((entry) => ({
        requestId: entry.requestId,
        toolName: entry.toolName,
        input: entry.input,
        context: entry.context,
        sessionId,
        receivedAt: entry.receivedAt,
      }));
  },
};

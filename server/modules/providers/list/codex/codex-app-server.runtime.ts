import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';

import {
  appendFilesInputTag,
  buildCodexInputItems,
  normalizeImageDescriptors,
} from '@/shared/image-attachments.js';
import type {
  AnyRecord,
  ProviderPermissionDecision,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
} from '@/shared/types.js';
import {
  AppError,
  createCompleteMessage,
  createNormalizedMessage,
  readObjectRecord,
} from '@/shared/utils.js';
import {
  createNotificationEvent,
  notifyUserIfEnabled,
} from '@/modules/notifications/index.js';

import {
  CodexAppServerProcessManager,
  type CodexAppServerDiagnostic,
  type CodexAppServerProcessManagerOptions,
} from './codex-app-server.process.js';
import type { JsonRpcNotification, JsonRpcRequest } from './codex-app-server.transport.js';

type AppServerRuntimeResult = {
  status: 'completed' | 'interrupted' | 'failed';
  error?: string;
};

type AppServerRun = {
  appSessionId: string | null;
  threadId: string;
  turnId: string | null;
  writer: ProviderRuntimeWriter;
  context: ProviderRuntimeContext;
  turnAccepted: boolean;
  abortRequested: boolean;
  terminal: boolean;
  lastError: string | null;
  completion: Promise<AppServerRuntimeResult>;
  resolveCompletion: (result: AppServerRuntimeResult) => void;
};

type CodexApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

type PendingCodexApproval = {
  requestId: string;
  run: AppServerRun;
  provider: 'codex';
  toolName: 'Bash' | 'FileChange';
  input: AnyRecord;
  context: AnyRecord;
  sessionId: string;
  receivedAt: Date;
  resolveResponse: (response: { decision: CodexApprovalDecision }) => void;
};

export type CodexThreadForkInput = {
  threadId: string;
  lastTurnId?: string;
  cwd: string;
};

export type CodexThreadFork = {
  threadId: string;
  path: string;
};

export type CodexAppServerRuntimeOptions = {
  managerOptions?: Omit<
    CodexAppServerProcessManagerOptions,
    'onNotification' | 'onRequest' | 'onDiagnostic'
  >;
  onRequest?: CodexAppServerProcessManagerOptions['onRequest'];
};

export class CodexAppServerPreTurnError extends Error {
  readonly causeValue: unknown;

  constructor(message: string, causeValue?: unknown) {
    super(message);
    this.name = 'CodexAppServerPreTurnError';
    this.causeValue = causeValue;
  }
}

const readString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim().length > 0 ? value : null
);

const readText = (value: unknown): string | null => {
  if (!Array.isArray(value)) {
    return readString(value);
  }

  const parts = value
    .map((part) => readString(part))
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join('\n') : null;
};

const readRecord = (value: unknown): AnyRecord | null => readObjectRecord(value);

const compactRecord = (record: AnyRecord): AnyRecord => Object.fromEntries(
  Object.entries(record).filter(([, value]) => value !== null && value !== undefined),
);

const readNestedRecord = (record: AnyRecord, key: string): AnyRecord | null => (
  readRecord(record[key])
);

const readThreadId = (value: unknown): string | null => {
  const record = readRecord(value);
  const thread = readNestedRecord(record ?? {}, 'thread') ?? record;
  return readString(thread?.id);
};

const readTurnId = (value: unknown): string | null => {
  const record = readRecord(value);
  const turn = readNestedRecord(record ?? {}, 'turn') ?? record;
  return readString(turn?.id);
};

const readErrorMessage = (value: unknown, fallback = 'Codex turn failed'): string => {
  const record = readRecord(value);
  const target = readNestedRecord(record ?? {}, 'turn') ?? record;
  const error = readNestedRecord(target ?? {}, 'error');
  return readString(error?.message)
    ?? readString(target?.message)
    ?? readString(record?.message)
    ?? fallback;
};

function mapPermissionMode(permissionMode: unknown): {
  sandbox: 'workspace-write' | 'danger-full-access';
  approvalPolicy: 'never' | 'untrusted';
} {
  switch (permissionMode) {
    case 'acceptEdits':
      return { sandbox: 'workspace-write', approvalPolicy: 'never' };
    case 'bypassPermissions':
      return { sandbox: 'danger-full-access', approvalPolicy: 'never' };
    case 'default':
    case undefined:
    case null:
      return { sandbox: 'workspace-write', approvalPolicy: 'untrusted' };
    default:
      throw new Error(`Unsupported Codex permission mode: ${String(permissionMode)}`);
  }
}

function readTokenBudget(value: unknown): AnyRecord | null {
  const record = readRecord(value);
  const usage = readNestedRecord(record ?? {}, 'usage')
    ?? readNestedRecord(record ?? {}, 'tokenUsage')
    ?? record;
  if (!usage) {
    return null;
  }

  const aggregate = readNestedRecord(usage, 'total') ?? usage;
  const inputTokens = Number(aggregate.inputTokens ?? aggregate.input_tokens ?? 0);
  const outputTokens = Number(aggregate.outputTokens ?? aggregate.output_tokens ?? 0);
  const totalTokens = Number(
    aggregate.totalTokens ?? aggregate.total_tokens ?? inputTokens + outputTokens,
  );
  const contextWindow = Number(
    usage.modelContextWindow
      ?? usage.model_context_window
      ?? aggregate.modelContextWindow
      ?? aggregate.model_context_window
      ?? 200000,
  );
  if (![inputTokens, outputTokens, totalTokens, contextWindow].every(Number.isFinite)) {
    return null;
  }

  return {
    used: totalTokens,
    total: contextWindow,
    inputTokens,
    outputTokens,
    breakdown: { input: inputTokens, output: outputTokens },
  };
}

function mapItemType(itemType: unknown): string {
  switch (itemType) {
    case 'userMessage':
      return 'user_message';
    case 'hookPrompt':
      return 'hook_prompt';
    case 'agentMessage':
      return 'agent_message';
    case 'plan':
      return 'plan';
    case 'commandExecution':
      return 'command_execution';
    case 'fileChange':
      return 'file_change';
    case 'mcpToolCall':
      return 'mcp_tool_call';
    case 'dynamicToolCall':
      return 'dynamic_tool_call';
    case 'collabAgentToolCall':
      return 'collab_agent_tool_call';
    case 'subAgentActivity':
      return 'sub_agent_activity';
    case 'webSearch':
      return 'web_search';
    case 'imageGeneration':
      return 'image_generation';
    case 'imageView':
      return 'image_view';
    case 'sleep':
      return 'sleep';
    case 'enteredReviewMode':
      return 'entered_review_mode';
    case 'exitedReviewMode':
      return 'exited_review_mode';
    case 'contextCompaction':
      return 'context_compaction';
    case 'todoList':
      return 'todo_list';
    default:
      return typeof itemType === 'string' ? itemType : 'unknown';
  }
}

function readUserInput(content: unknown): { text: string; images?: AnyRecord[] } {
  if (!Array.isArray(content)) {
    return { text: '' };
  }

  const textParts: string[] = [];
  const images: AnyRecord[] = [];
  for (const value of content) {
    const input = readRecord(value);
    if (!input) {
      continue;
    }
    if (input.type === 'text' && typeof input.text === 'string') {
      textParts.push(input.text);
      continue;
    }
    if (input.type === 'localImage' && typeof input.path === 'string') {
      images.push({ path: input.path });
      continue;
    }
    if (input.type === 'image' && typeof input.url === 'string') {
      images.push({ data: input.url });
    }
  }

  return {
    text: textParts.join('\n'),
    ...(images.length > 0 ? { images } : {}),
  };
}

/**
 * Converts a stable app-server item into the existing Codex session adapter's
 * live-event shape. Keeping this boundary provider-local lets the frontend and
 * shared normalizer remain unchanged while protocol fields evolve.
 */
export function transformCodexAppServerItem(item: AnyRecord): AnyRecord {
  const itemType = mapItemType(item.type);
  const uuid = readString(item.id) ?? undefined;

  switch (itemType) {
    case 'user_message': {
      const input = readUserInput(item.content);
      return {
        type: 'item',
        itemType,
        uuid,
        message: { role: 'user', content: input.text },
        images: input.images,
      };
    }
    case 'agent_message':
      return {
        type: 'item',
        itemType,
        uuid,
        message: { role: 'assistant', content: readString(item.text) ?? '' },
      };
    case 'reasoning':
      return {
        type: 'item',
        itemType,
        uuid,
        message: {
          role: 'assistant',
          content: readText(item.summary) ?? readText(item.content) ?? '',
          isReasoning: true,
        },
      };
    case 'plan':
      return {
        type: 'item',
        itemType,
        uuid,
        message: { role: 'assistant', content: readString(item.text) ?? '' },
      };
    case 'command_execution':
      return {
        type: 'item',
        itemType,
        uuid,
        command: item.command,
        output: item.aggregatedOutput ?? item.aggregated_output,
        exitCode: item.exitCode ?? item.exit_code,
        status: item.status,
      };
    case 'file_change':
      return {
        type: 'item',
        itemType,
        uuid,
        changes: item.changes,
        status: item.status,
      };
    case 'mcp_tool_call':
      return {
        type: 'item',
        itemType,
        uuid,
        server: item.server,
        tool: item.tool,
        arguments: item.arguments,
        result: item.result,
        error: item.error,
        status: item.status,
      };
    case 'dynamic_tool_call':
      return {
        type: 'item',
        itemType,
        uuid,
        namespace: item.namespace,
        tool: item.tool,
        arguments: item.arguments,
        result: item.contentItems,
        success: item.success,
        status: item.status,
      };
    case 'collab_agent_tool_call':
      return {
        type: 'item',
        itemType,
        uuid,
        tool: item.tool,
        prompt: item.prompt,
        model: item.model,
        reasoningEffort: item.reasoningEffort,
        receiverThreadIds: item.receiverThreadIds,
        agentsStates: item.agentsStates,
        status: item.status,
      };
    case 'web_search':
      return {
        type: 'item',
        itemType,
        uuid,
        query: item.query,
        action: item.action,
        status: 'completed',
      };
    case 'todo_list':
      return {
        type: 'item',
        itemType,
        uuid,
        items: item.items,
        status: 'completed',
      };
    case 'image_view':
      return {
        type: 'item',
        itemType,
        uuid,
        path: item.path,
        status: 'completed',
      };
    case 'image_generation':
      return {
        type: 'item',
        itemType,
        uuid,
        item,
      };
    default:
      return {
        type: 'item',
        itemType,
        uuid,
        item,
      };
  }
}

function buildTurnInput(command: string, options: AnyRecord, cwd: string): AnyRecord[] {
  const prompt = appendFilesInputTag(command, options.files);
  const images = normalizeImageDescriptors(options.images);
  if (images.length === 0) {
    return [{ type: 'text', text: prompt }];
  }

  return buildCodexInputItems(prompt, images, cwd).map((item) => (
    item.type === 'local_image'
      ? { type: 'localImage', path: item.path }
      : item
  ));
}

function readThreadIdFromNotification(params: AnyRecord): string | null {
  const turn = readNestedRecord(params, 'turn');
  return readString(params.threadId)
    ?? readString(params.thread_id)
    ?? readString(turn?.threadId)
    ?? readString(turn?.thread_id);
}

function readTurnStatus(params: AnyRecord): 'completed' | 'interrupted' | 'failed' {
  const turn = readNestedRecord(params, 'turn') ?? params;
  const status = readString(turn.status);
  if (status === 'interrupted') {
    return 'interrupted';
  }
  if (status === 'failed') {
    return 'failed';
  }
  return 'completed';
}

/**
 * App-server-backed Codex runtime. It deliberately owns only provider thread,
 * turn, and item translation; the websocket registry still owns app-session
 * identity, sequencing, replay, and terminal deduplication.
 */
export class CodexAppServerRuntime {
  private readonly manager: CodexAppServerProcessManager;
  private readonly runsByThread = new Map<string, AppServerRun>();
  private readonly runsBySession = new Map<string, AppServerRun>();
  private readonly pendingApprovals = new Map<string, PendingCodexApproval>();

  constructor(options: CodexAppServerRuntimeOptions = {}) {
    this.manager = new CodexAppServerProcessManager({
      ...(options.managerOptions ?? {}),
      onNotification: (notification) => this.handleNotification(notification),
      onRequest: options.onRequest ?? ((request) => this.handleRequest(request)),
      onDiagnostic: (diagnostic) => this.handleDiagnostic(diagnostic),
    });
  }

  async run(
    command: string,
    options: AnyRecord = {},
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): Promise<unknown> {
    let run: AppServerRun | null = null;
    let threadId: string | null = null;
    let providerThreadCreated = false;

    try {
      await this.manager.start();

      const sessionId = readString(options.sessionId);
      const providerSessionId = context.resolveProviderSessionId(sessionId);
      const resolvedModel = await context.resolveResumeModel(sessionId ?? undefined, readString(options.model));
      const workingDirectory = readString(options.cwd)
        ?? readString(options.projectPath)
        ?? process.cwd();
      const permission = mapPermissionMode(options.permissionMode);
      const catalog = await context.getProviderModels();
      const selectedModel = catalog.OPTIONS.find((option) => option.value === resolvedModel);
      const allowedEfforts = selectedModel?.effort?.values?.map((value) => value.value) ?? [];
      const effort = readString(options.effort);
      const resolvedEffort = effort && effort !== 'default' && allowedEfforts.includes(effort)
        ? effort
        : undefined;

      const threadParams = {
        cwd: workingDirectory,
        ...(resolvedModel ? { model: resolvedModel } : {}),
        sandbox: permission.sandbox,
        approvalPolicy: permission.approvalPolicy,
      } satisfies AnyRecord;

      const threadResult = providerSessionId
        ? await this.manager.request('thread/resume', {
          threadId: providerSessionId,
          ...threadParams,
        })
        : await this.manager.request('thread/start', threadParams);
      threadId = readThreadId(threadResult);
      if (!threadId) {
        throw new CodexAppServerPreTurnError('Codex app-server did not return a thread id', threadResult);
      }
      providerThreadCreated = !providerSessionId;
      writer.setSessionId?.(threadId);
      if (providerThreadCreated) {
        writer.send(createNormalizedMessage({
          kind: 'session_created',
          provider: 'codex',
          sessionId: threadId,
          newSessionId: threadId,
        }));
      }

      run = this.createRun(sessionId, threadId, writer, context);
      const turnParams = {
        threadId,
        input: buildTurnInput(command, options, workingDirectory),
        cwd: workingDirectory,
        ...(resolvedModel ? { model: resolvedModel } : {}),
        ...(resolvedEffort ? { effort: resolvedEffort } : {}),
      } satisfies AnyRecord;

      const turnResult = await this.manager.request('turn/start', turnParams);
      run.turnAccepted = true;
      run.turnId = readTurnId(turnResult);
      if (!run.turnId) {
        throw new Error('Codex app-server did not return a turn id');
      }
      if (run.abortRequested) {
        void this.interruptRun(run);
      }

      return await run.completion;
    } catch (error) {
      if (run?.turnAccepted) {
        this.failRun(run, error instanceof Error ? error.message : String(error));
        return await run.completion;
      }

      const normalized = error instanceof CodexAppServerPreTurnError
        ? error
        : new CodexAppServerPreTurnError(
          error instanceof Error ? error.message : String(error),
          error,
        );
      if (threadId && providerThreadCreated) {
        writer.setSessionId?.(threadId);
      }
      throw normalized;
    } finally {
      if (run) {
        this.removeRun(run);
      }
    }
  }

  async abort(sessionId: string): Promise<boolean> {
    const run = this.runsBySession.get(sessionId);
    if (!run || run.terminal) {
      return false;
    }

    run.abortRequested = true;
    this.cancelApprovalsForRun(run, 'aborted');
    if (run.turnId) {
      void this.interruptRun(run);
    }
    return true;
  }

  resolveApproval(requestId: string, decision: ProviderPermissionDecision): void {
    const approval = this.pendingApprovals.get(requestId);
    if (!approval) {
      return;
    }

    const protocolDecision: CodexApprovalDecision = decision.allow
      ? decision.rememberEntry
        ? 'acceptForSession'
        : 'accept'
      : 'decline';
    this.settleApproval(approval, protocolDecision);
  }

  listPendingApprovals(sessionId: string): unknown[] {
    return Array.from(this.pendingApprovals.values())
      .filter((approval) => approval.sessionId === sessionId)
      .map((approval) => ({
        requestId: approval.requestId,
        provider: approval.provider,
        toolName: approval.toolName,
        input: approval.input,
        context: approval.context,
        sessionId: approval.sessionId,
        receivedAt: approval.receivedAt,
      }));
  }

  /**
   * Restarts the owned process so Codex reloads config.toml and auth.json.
   * Active app-server turns are preserved by rejecting the administrative
   * action instead of terminating work that is still producing output.
   */
  async restart(): Promise<void> {
    if (this.runsByThread.size > 0) {
      throw new AppError('Wait for active Codex app-server runs to finish before restarting.', {
        code: 'CODEX_APP_SERVER_BUSY',
        statusCode: 409,
      });
    }

    await this.manager.restart();
  }

  /** Reads one persisted provider thread through the owned app-server process. */
  async readThread(threadId: string, includeTurns = true): Promise<unknown> {
    await this.manager.start();
    return this.manager.request('thread/read', { threadId, includeTurns });
  }

  /** Lists one page of persisted provider threads through the owned process. */
  async listThreads(params: AnyRecord = {}): Promise<unknown> {
    await this.manager.start();
    return this.manager.request('thread/list', params);
  }

  /** Forks persisted history into a distinct Codex thread. */
  async forkThread(input: CodexThreadForkInput): Promise<CodexThreadFork> {
    await this.manager.start();
    const result = await this.manager.request('thread/fork', compactRecord({
      threadId: input.threadId,
      lastTurnId: input.lastTurnId,
      cwd: input.cwd,
    }));
    const forkedThreadId = readThreadId(result);
    const forkedThread = readNestedRecord(readRecord(result) ?? {}, 'thread');
    const forkedPath = readString(forkedThread?.path);
    if (!forkedThreadId || forkedThreadId === input.threadId || !forkedPath) {
      throw new AppError('Codex reported a fork without a distinct thread id or transcript path.', {
        code: 'FORK_FAILED',
        statusCode: 502,
      });
    }

    try {
      await stat(forkedPath);
    } catch {
      throw new AppError('Codex reported a fork but wrote no transcript for it.', {
        code: 'FORK_FAILED',
        statusCode: 502,
      });
    }

    return { threadId: forkedThreadId, path: forkedPath };
  }

  /** Updates Codex's provider-owned display name for one persisted thread. */
  async setThreadName(threadId: string, name: string): Promise<void> {
    await this.manager.start();
    await this.manager.request('thread/name/set', { threadId, name });
  }

  private createRun(
    appSessionId: string | null,
    threadId: string,
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): AppServerRun {
    const existing = this.runsByThread.get(threadId)
      ?? (appSessionId ? this.runsBySession.get(appSessionId) : undefined);
    if (existing && !existing.terminal) {
      throw new CodexAppServerPreTurnError(`Codex thread "${threadId}" already has an active turn`);
    }

    let resolveCompletion: (result: AppServerRuntimeResult) => void = () => undefined;
    const completion = new Promise<AppServerRuntimeResult>((resolve) => {
      resolveCompletion = resolve;
    });
    const run: AppServerRun = {
      appSessionId,
      threadId,
      turnId: null,
      writer,
      context,
      turnAccepted: false,
      abortRequested: false,
      terminal: false,
      lastError: null,
      completion,
      resolveCompletion,
    };
    this.runsByThread.set(threadId, run);
    if (appSessionId) {
      this.runsBySession.set(appSessionId, run);
    }
    return run;
  }

  private removeRun(run: AppServerRun): void {
    if (this.runsByThread.get(run.threadId) === run) {
      this.runsByThread.delete(run.threadId);
    }
    if (run.appSessionId && this.runsBySession.get(run.appSessionId) === run) {
      this.runsBySession.delete(run.appSessionId);
    }
  }

  private findRun(params: AnyRecord): AppServerRun | null {
    const threadId = readThreadIdFromNotification(params);
    if (threadId) {
      return this.runsByThread.get(threadId) ?? null;
    }

    const turnId = readTurnId(params);
    if (turnId) {
      for (const run of this.runsByThread.values()) {
        if (run.turnId === turnId) {
          return run;
        }
      }
    }

    // `turn/started` in older app-server builds omitted threadId. It is safe to
    // use the single active run fallback because CloudCLI rejects concurrent
    // turns for one app session and this adapter only owns its own connection.
    if (this.runsByThread.size === 1) {
      return this.runsByThread.values().next().value ?? null;
    }
    return null;
  }

  private handleNotification(notification: JsonRpcNotification): void {
    const params = readRecord(notification.params) ?? {};
    const run = this.findRun(params);
    if (!run || run.terminal) {
      return;
    }

    const notificationTurnId = readTurnId(params);
    if (notificationTurnId && run.turnId && notificationTurnId !== run.turnId) {
      return;
    }
    if (notificationTurnId && !run.turnId) {
      run.turnId = notificationTurnId;
    }

    switch (notification.method) {
      case 'turn/started':
        return;
      case 'item/completed': {
        const item = readNestedRecord(params, 'item');
        if (item && item.type !== 'userMessage' && item.type !== 'hookPrompt') {
          this.emitNormalized(run, transformCodexAppServerItem(item));
        }
        return;
      }
      case 'thread/tokenUsage/updated': {
        const tokenBudget = readTokenBudget(params);
        if (tokenBudget) {
          run.writer.send(createNormalizedMessage({
            kind: 'status',
            provider: 'codex',
            sessionId: run.threadId,
            text: 'token_budget',
            tokenBudget,
          }));
        }
        return;
      }
      case 'error': {
        const message = readErrorMessage(params, 'Codex app-server error');
        run.lastError = message;
        this.emitNormalized(run, {
          type: 'error',
          message,
        });
        return;
      }
      case 'turn/completed': {
        const status = readTurnStatus(params);
        const error = status === 'failed'
          ? readErrorMessage(params)
          : undefined;
        this.completeRun(run, status, error);
        return;
      }
      default:
        return;
    }
  }

  private handleRequest(request: JsonRpcRequest): unknown {
    switch (request.method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval':
        return this.requestApproval(request);
      default:
        throw new Error(`Unsupported Codex app-server request: ${request.method}`);
    }
  }

  private requestApproval(request: JsonRpcRequest): unknown {
    const params = readRecord(request.params) ?? {};
    const run = this.findApprovalRun(params);
    if (!run) {
      return { decision: 'decline' };
    }

    const requestId = `codex:${randomUUID()}`;
    const isCommand = request.method === 'item/commandExecution/requestApproval';
    const toolName = isCommand ? 'Bash' : 'FileChange';
    const input = isCommand
      ? compactRecord({
        command: readString(params.command),
        cwd: readString(params.cwd),
        reason: readString(params.reason),
        commandActions: Array.isArray(params.commandActions) ? params.commandActions : null,
        networkApprovalContext: readRecord(params.networkApprovalContext),
        proposedExecpolicyAmendment: params.proposedExecpolicyAmendment,
        proposedNetworkPolicyAmendments: params.proposedNetworkPolicyAmendments,
      })
      : compactRecord({
        action: 'Apply proposed file changes',
        reason: readString(params.reason),
        grantRoot: readString(params.grantRoot),
      });
    const context = compactRecord({
      itemId: readString(params.itemId),
      approvalId: readString(params.approvalId),
      environmentId: readString(params.environmentId),
    });
    const startedAtMs = typeof params.startedAtMs === 'number' && Number.isFinite(params.startedAtMs)
      ? params.startedAtMs
      : Date.now();

    return new Promise<{ decision: CodexApprovalDecision }>((resolve) => {
      const approval: PendingCodexApproval = {
        requestId,
        run,
        provider: 'codex',
        toolName,
        input,
        context,
        sessionId: run.appSessionId ?? run.threadId,
        receivedAt: new Date(startedAtMs),
        resolveResponse: resolve,
      };
      this.pendingApprovals.set(requestId, approval);

      try {
        run.writer.send(createNormalizedMessage({
          kind: 'permission_request',
          provider: 'codex',
          sessionId: run.threadId,
          requestId,
          toolName,
          input,
          context,
        }));
      } catch {
        this.settleApproval(approval, 'decline');
        return;
      }

      try {
        notifyUserIfEnabled({
          userId: run.writer.userId ?? null,
          event: createNotificationEvent({
            provider: 'codex',
            sessionId: approval.sessionId,
            kind: 'action_required',
            code: 'permission.required',
            meta: { toolName },
            severity: 'warning',
            requiresUserAction: true,
            dedupeKey: `codex:permission:${approval.sessionId}:${requestId}`,
          }),
        });
      } catch {
        // Approval delivery is authoritative; notifications are best-effort.
      }
    });
  }

  private findApprovalRun(params: AnyRecord): AppServerRun | null {
    const threadId = readString(params.threadId);
    const turnId = readString(params.turnId);
    if (!threadId || !turnId) {
      return null;
    }

    const run = this.runsByThread.get(threadId);
    if (!run || run.terminal || (run.turnId && run.turnId !== turnId)) {
      return null;
    }
    if (!run.turnId) {
      run.turnId = turnId;
      run.turnAccepted = true;
    }
    return run;
  }

  private settleApproval(
    approval: PendingCodexApproval,
    decision: CodexApprovalDecision,
    cancellationReason?: string,
  ): void {
    if (this.pendingApprovals.get(approval.requestId) !== approval) {
      return;
    }
    this.pendingApprovals.delete(approval.requestId);
    if (cancellationReason) {
      try {
        approval.run.writer.send(createNormalizedMessage({
          kind: 'permission_cancelled',
          provider: 'codex',
          sessionId: approval.run.threadId,
          requestId: approval.requestId,
          reason: cancellationReason,
        }));
      } catch {
        // The protocol response still has to settle even if the client left.
      }
    }
    approval.resolveResponse({ decision });
  }

  private cancelApprovalsForRun(run: AppServerRun, reason: string): void {
    for (const approval of Array.from(this.pendingApprovals.values())) {
      if (approval.run === run) {
        this.settleApproval(approval, 'cancel', reason);
      }
    }
  }

  private emitNormalized(run: AppServerRun, transformed: AnyRecord): void {
    try {
      for (const message of run.context.normalizeMessage(transformed, run.threadId)) {
        run.writer.send(message);
      }
    } catch (error) {
      this.failRun(run, error instanceof Error ? error.message : String(error));
    }
  }

  private completeRun(
    run: AppServerRun,
    status: AppServerRuntimeResult['status'],
    error?: string,
  ): void {
    if (run.terminal) {
      return;
    }
    run.terminal = true;
    this.cancelApprovalsForRun(run, status);
    if (error) {
      run.lastError = error;
      this.emitNormalized(run, { type: 'error', message: error });
    }
    run.writer.send(createCompleteMessage({
      provider: 'codex',
      sessionId: run.threadId,
      actualSessionId: run.threadId,
      exitCode: status === 'failed' ? 1 : 0,
      aborted: status === 'interrupted' || run.abortRequested,
    }));
    run.resolveCompletion({ status, ...(error ? { error } : {}) });
  }

  private failRun(run: AppServerRun, message: string): void {
    this.completeRun(run, 'failed', message);
  }

  private async interruptRun(run: AppServerRun): Promise<void> {
    if (!run.turnId || run.terminal) {
      return;
    }
    try {
      await this.manager.request('turn/interrupt', {
        threadId: run.threadId,
        turnId: run.turnId,
      });
    } catch (error) {
      // The authoritative interrupted/failed turn notification may race this
      // request. Keep the error for diagnostics without emitting a duplicate
      // terminal message from the abort path.
      run.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private handleDiagnostic(diagnostic: CodexAppServerDiagnostic): void {
    if (diagnostic.type !== 'process_exit' && diagnostic.type !== 'process_error') {
      return;
    }
    if (diagnostic.type === 'process_exit' && diagnostic.expected) {
      return;
    }
    const message = diagnostic.type === 'process_exit'
      ? `Codex app-server exited unexpectedly (code ${diagnostic.code ?? 'unknown'})`
      : diagnostic.error.message;
    for (const run of this.runsByThread.values()) {
      this.failRun(run, message);
    }
  }
}

/**
 * Creates an isolated runtime for tests or a future per-user process topology.
 * The default exported runtime remains one manager per CloudCLI backend.
 */
export function createCodexAppServerRuntime(options: CodexAppServerRuntimeOptions = {}) {
  const runtime = new CodexAppServerRuntime(options);
  return {
    run: runtime.run.bind(runtime),
    abort: runtime.abort.bind(runtime),
    restart: runtime.restart.bind(runtime),
    readThread: runtime.readThread.bind(runtime),
    listThreads: runtime.listThreads.bind(runtime),
    forkThread: runtime.forkThread.bind(runtime),
    setThreadName: runtime.setThreadName.bind(runtime),
    permissions: {
      resolve: runtime.resolveApproval.bind(runtime),
      listPending: runtime.listPendingApprovals.bind(runtime),
    },
  };
}

export const codexAppServerRuntime = createCodexAppServerRuntime();

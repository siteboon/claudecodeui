/**
 * Antigravity Runtime Provider
 *
 * Implements IProviderRuntime for Google Antigravity CLI (`agy`).
 * Spawns `agy` in print/stream-json mode and maps stdout events into CloudCLI NormalizedMessage stream.
 *
 * @module antigravity-runtime.provider
 */

import type { ChildProcess } from 'node:child_process';
import fsSync from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import crossSpawn from 'cross-spawn';

import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import {
  appendFilesInputTag,
  appendImagesInputTag,
  normalizeAttachmentDescriptors,
} from '@/shared/image-attachments.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
} from '@/shared/types.js';
import {
  createCompleteMessage,
  createNormalizedMessage,
  flattenPromptForWindowsShell,
  generateMessageId,
  readObjectRecord,
  readOptionalString,
  sanitizeLeafDirectoryName,
} from '@/shared/utils.js';

import { getAntigravityDataRoot } from './antigravity-data-root.js';
import { tryResolveEnginePath } from './antigravity-engine-path.js';
import {
  extractVariantFamilyFromOption,
  resolveAntigravityModelArgs,
  splitModelEffortSuffix,
} from './antigravity-model-effort.js';

const PROVIDER = 'antigravity';

/**
 * Persists token usage snapshot into session's brain directory for offline / reloaded queries.
 */
async function persistAntigravityTokenUsage(sessionId: string, tokenBudget: unknown): Promise<void> {
  try {
    const safeId = sanitizeLeafDirectoryName(sessionId, 'antigravity session id');
    const brainDir = path.join(getAntigravityDataRoot(), 'brain', safeId);
    if (fsSync.existsSync(brainDir)) {
      const usageFile = path.join(brainDir, 'token_usage.json');
      await fsp.writeFile(usageFile, JSON.stringify(tokenBudget, null, 2), 'utf8');
    }
  } catch {
    // Best-effort persistence
  }
}

/**
 * Maps CloudCLI permission modes onto `agy` CLI flags. `default` maps to no
 * flags and relies on the CLI's own permission prompting; every other mode
 * maps to the native flag combination verified against `agy --help`.
 */
const PERMISSION_MODE_ARGS: Record<string, string[]> = {
  acceptEdits: ['--mode', 'accept-edits'],
  plan: ['--mode', 'plan'],
  bypassPermissions: ['--dangerously-skip-permissions'],
};

/**
 * Active process map keyed by session ID.
 */
const activeProcesses = new Map<string, ChildProcess>();

/**
 * Monotonic counter for process keys of runs without a session ID, so
 * concurrent keyless runs can never collide on `agy_<timestamp>`.
 */
let keylessRunCounter = 0;

/**
 * Process keys killed by `abort()`. Their `close` event resolves the run
 * quietly and notifies with `stopReason: 'aborted'` instead of completed.
 */
const abortedProcessKeys = new Set<string>();

/**
 * How much of the child's stderr is retained for failure reporting. agy
 * writes actionable errors (auth failures, bad flags, quota) to stderr only;
 * the tail is what the user sees when the run fails.
 */
const STDERR_TAIL_LIMIT = 4_000;

export class AntigravityRuntimeProvider implements IProviderRuntime {
  /**
   * Executes a command using the Antigravity CLI.
   */
  async run(
    command: string,
    options: AnyRecord = {},
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): Promise<unknown> {
    // The merged catalog decides whether a base model id encodes effort as an
    // id suffix. A catalog lookup failure must degrade to flag-based effort,
    // never block the run.
    const catalog = await context.getProviderModels().catch(() => null);

    return new Promise((resolve, reject) => {
      const sessionId = readOptionalString(options.sessionId);
      // An explicit workspace (chat gateway sends cwd + projectPath) is kept
      // separate from the spawn fallback: only an explicitly requested
      // directory may become a declared agy workspace via --add-dir.
      const explicitWorkspace = readOptionalString(options.cwd)
        ?? readOptionalString(options.projectPath);
      const cwd = explicitWorkspace ? path.resolve(explicitWorkspace) : process.cwd();
      const model = readOptionalString(options.model);
      const effort = readOptionalString(options.effort);
      const permissionMode = readOptionalString(options.permissionMode);
      const skipPermissions = Boolean(options.skipPermissions || options.toolsSettings?.skipPermissions);
      const sessionSummary = readOptionalString(options.sessionSummary);

      const providerSessionId = sessionId
        ? context.resolveProviderSessionId(sessionId)
        : null;

      let capturedSessionId = providerSessionId;
      let sessionCreatedSent = false;
      let completeSent = false;
      let settled = false;
      let sawErrorResult = false;
      let errorResultMessage: string | null = null;
      let stderrTail = '';
      /**
       * Whether an agent_response text segment is currently streaming. agy
       * interleaves pure-text steps with tool steps inside one turn without
       * any end-of-text marker, so the segment boundary is derived here:
       * the first non-text event after text deltas closes the segment.
       */
      let agentResponseSegmentOpen = false;

      const processKey = sessionId || capturedSessionId || `agy_${Date.now()}_${keylessRunCounter += 1}`;

      /**
       * Builds the user-facing failure description for a non-zero or
       * signal-terminated exit, appending the captured stderr tail because
       * agy reports actionable errors there.
       */
      const describeFailure = (code: number | null): string => {
        const base = code === null
          ? 'Antigravity CLI terminated by signal.'
          : `Antigravity CLI exited with code ${code}`;
        const stderr = stderrTail.trim();
        return stderr ? `${base}\nstderr:\n${stderr}` : base;
      };

      const settleOnce = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
      };

      const notifyTerminalState = ({ code = null, error = null }: { code?: number | null; error?: string | Error | null } = {}) => {
        const finalSessionId = sessionId || capturedSessionId || processKey;
        const normalizedUserId = writer.userId != null ? String(writer.userId) : null;
        const failed = code !== 0 || error !== null || sawErrorResult;
        if (!failed) {
          notifyRunStopped({
            userId: normalizedUserId,
            provider: PROVIDER,
            sessionId: finalSessionId,
            sessionName: sessionSummary,
            stopReason: 'completed',
          });
        } else {
          notifyRunFailed({
            userId: normalizedUserId,
            provider: PROVIDER,
            sessionId: finalSessionId,
            sessionName: sessionSummary,
            error: error
              || (sawErrorResult
                ? (errorResultMessage || 'Antigravity CLI reported an error result.')
                : describeFailure(code)),
          });
        }
      };

      const enginePath = tryResolveEnginePath();
      if (!enginePath) {
        const notInstalledMsg = createNormalizedMessage({
          id: generateMessageId(PROVIDER),
          kind: 'error',
          content: 'Antigravity CLI (agy) is not installed. Please install it first.',
          sessionId: processKey,
          provider: PROVIDER,
          isError: true,
        });
        writer.send(notInstalledMsg);
        settleOnce(() => reject(new Error('Antigravity CLI is not installed.')));
        return;
      }

      // Build CLI arguments
      const args: string[] = [];

      // agy (≤1.1.24) registers the spawn cwd as workspace metadata but still
      // runs its shell tool in ~/.gemini/antigravity-cli/scratch; only an
      // explicit --add-dir makes the agent actually operate in the project
      // directory. Absolute path required (see path.resolve above).
      if (explicitWorkspace) {
        args.push('--add-dir', cwd);
      }

      // Prompt with attachments
      const hasAttachments =
        normalizeAttachmentDescriptors(options.images).length > 0
        || normalizeAttachmentDescriptors(options.files).length > 0;

      if ((command && command.trim()) || hasAttachments) {
        const promptWithAttachments = appendFilesInputTag(
          appendImagesInputTag(command || '', options.images),
          options.files,
        );
        args.push('-p', flattenPromptForWindowsShell(promptWithAttachments));
        args.push('--output-format', 'stream-json');
      }

      // Resume existing conversation
      if (providerSessionId) {
        args.push('--conversation', providerSessionId);
      }

      // Model configuration and reasoning effort share one resolution:
      // variant-family base ids get their tier appended to the model id,
      // legacy suffixed ids keep their embedded tier, and everything else
      // (claude passthroughs, custom models) takes the --effort flag. The
      // family is looked up by base id so a legacy suffixed id from an old
      // session row is validated against the family's real tiers too.
      const requestedBase = model ? splitModelEffortSuffix(model).base : undefined;
      const variantFamily = extractVariantFamilyFromOption(
        catalog?.OPTIONS.find((option) => option.value === requestedBase),
      );
      const modelArgs = resolveAntigravityModelArgs(model, effort, variantFamily);

      if (modelArgs.model) {
        args.push('--model', modelArgs.model);
      }

      if (modelArgs.effort) {
        args.push('--effort', modelArgs.effort);
      }

      // Permission mode (acceptEdits / plan / bypassPermissions); 'default'
      // adds no flags. Chat and headless callers both pass `permissionMode`.
      const permissionModeArgs = permissionMode ? PERMISSION_MODE_ARGS[permissionMode] : undefined;
      if (permissionModeArgs) {
        args.push(...permissionModeArgs);
      }

      // The independent tools-settings toggle forces skip-permissions even
      // when the selected permission mode would not.
      if (skipPermissions && !args.includes('--dangerously-skip-permissions')) {
        args.push('--dangerously-skip-permissions');
      }

      console.debug(`[AntigravityRuntime] Spawning agy with args:`, args);

      let stdoutBuffer = '';

      const processLine = (line: string) => {
        if (!line || !line.trim()) return;

        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          // Not JSON: agy occasionally prints plain progress/notice text on
          // stdout even in stream-json mode; surface it as a text delta.
          const deltaMsg = createNormalizedMessage({
            id: generateMessageId(PROVIDER),
            kind: 'stream_delta',
            content: line,
            sessionId: capturedSessionId || sessionId || null,
            provider: PROVIDER,
          });
          writer.send(deltaMsg);
          agentResponseSegmentOpen = true;
          return;
        }

        try {
          const rawRecord = readObjectRecord(raw);

          // Handle init event for session ID capture. Fully handled here:
          // normalizeMessage's init branch would emit a second session_created
          // for the same event (both flat conversation_id and nested init
          // coexist in real agy output), so return instead of falling through.
          if (rawRecord?.event === 'init' && rawRecord?.conversation_id) {
            const convId = readOptionalString(rawRecord.conversation_id);
            if (convId && !capturedSessionId) {
              capturedSessionId = convId;
              writer.setSessionId?.(capturedSessionId);

              if (!providerSessionId && !sessionCreatedSent) {
                sessionCreatedSent = true;
                writer.send(createNormalizedMessage({
                  id: generateMessageId(PROVIDER),
                  kind: 'session_created',
                  newSessionId: capturedSessionId,
                  sessionId: capturedSessionId,
                  provider: PROVIDER,
                  content: `Antigravity session created: ${capturedSessionId}`,
                }));
              }
            }
            return;
          }

          // Extract and broadcast token budget from step_update or result
          const stepUpdateRecord = readObjectRecord(rawRecord?.step_update);
          const resultRecord = readObjectRecord(rawRecord?.result);
          const usageRecord = readObjectRecord(resultRecord?.usage ?? stepUpdateRecord?.usage ?? rawRecord?.usage);

          // Segment boundary for streaming text: the first event that is not
          // an agent_response text delta (a tool step, a text-less DONE, the
          // terminal result, ...) closes the open text segment with a
          // stream_end. The persisted transcript stores one row per segment,
          // so closing each live segment keeps the client's concatenated
          // bubble shape aligned with history and lets the existing exact-
          // match echo dedupe do its job.
          const stepEvent = rawRecord?.event === 'step_update' ? stepUpdateRecord : null;
          const isTextDeltaStep = Boolean(
            stepEvent
            && readOptionalString(stepEvent.step_type) === 'agent_response'
            && readOptionalString(stepEvent.text_delta),
          );
          if (agentResponseSegmentOpen && !isTextDeltaStep) {
            agentResponseSegmentOpen = false;
            writer.send(createNormalizedMessage({
              id: generateMessageId(PROVIDER),
              kind: 'stream_end',
              sessionId: capturedSessionId || sessionId || null,
              provider: PROVIDER,
            }));
          }
          if (isTextDeltaStep) {
            agentResponseSegmentOpen = true;
          }

          if (usageRecord) {
            const inputTokens = Number(usageRecord.input_tokens ?? usageRecord.inputTokens ?? usageRecord.prompt_tokens ?? 0) || 0;
            const outputTokens = Number(usageRecord.output_tokens ?? usageRecord.outputTokens ?? usageRecord.completion_tokens ?? usageRecord.candidates_tokens ?? 0) || 0;
            const used = Number(usageRecord.total_tokens ?? usageRecord.totalTokens ?? (inputTokens + outputTokens)) || 0;
            if (used > 0 || inputTokens > 0 || outputTokens > 0) {
              const tokenBudget = {
                used,
                total: 1048576,
                inputTokens,
                outputTokens,
                breakdown: {
                  input: inputTokens,
                  output: outputTokens,
                },
              };
              writer.send(createNormalizedMessage({
                id: generateMessageId(PROVIDER),
                kind: 'status',
                text: 'token_budget',
                tokenBudget,
                sessionId: capturedSessionId || sessionId || null,
                provider: PROVIDER,
              }));

              const activeSessionId = capturedSessionId || sessionId;
              if (activeSessionId) {
                void persistAntigravityTokenUsage(activeSessionId, tokenBudget);
              }
            }
          }

          // Handle result event (terminal)
          if (rawRecord?.event === 'result') {
            const resultData = readObjectRecord(rawRecord.result);
            const usageData = readObjectRecord(resultData?.usage);
            const totalTokens = typeof usageData?.total_tokens === 'number' ? usageData.total_tokens : undefined;
            const isError = resultData?.status === 'ERROR' || Boolean(resultData?.error);
            const errorMessage = readOptionalString(resultData?.error);

            if (isError) {
              sawErrorResult = true;
              errorResultMessage = errorMessage ?? null;
              writer.send(createNormalizedMessage({
                id: generateMessageId(PROVIDER),
                kind: 'error',
                content: errorMessage || 'Antigravity CLI reported an error result.',
                sessionId: capturedSessionId || sessionId || null,
                provider: PROVIDER,
                isError: true,
              }));
            }

            if (!completeSent) {
              completeSent = true;
              const completeMsg = createCompleteMessage({
                provider: PROVIDER,
                sessionId: capturedSessionId || sessionId || null,
                exitCode: isError ? 1 : 0,
              });
              if (totalTokens !== undefined) {
                completeMsg.tokens = totalTokens;
              }
              writer.send(completeMsg);
            }
            return;
          }

          // Normalize message and send to writer
          const normalized = context.normalizeMessage(raw, capturedSessionId || sessionId || null);
          for (const msg of normalized) {
            writer.send(msg);
          }
        } catch (error) {
          // The event WAS valid JSON, so a throw here is a normalization bug
          // or an unexpected payload shape — report it as an error instead of
          // masquerading raw JSON as assistant text.
          const detail = error instanceof Error ? error.message : String(error);
          console.error('[AntigravityRuntime] Failed to process provider event:', detail, line);
          writer.send(createNormalizedMessage({
            id: generateMessageId(PROVIDER),
            kind: 'error',
            content: `Antigravity event could not be processed: ${detail}`,
            sessionId: capturedSessionId || sessionId || null,
            provider: PROVIDER,
            isError: true,
          }));
        }
      };

      const agyProcess = crossSpawn(enginePath, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      activeProcesses.set(processKey, agyProcess);

      agyProcess.stdout?.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString('utf8');
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? '';

        for (const line of lines) {
          processLine(line.trim());
        }
      });

      agyProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf8');
        console.warn('[Antigravity CLI stderr]:', text);
        stderrTail = (stderrTail + text).slice(-STDERR_TAIL_LIMIT);
      });

      agyProcess.on('close', (code: number | null) => {
        activeProcesses.delete(processKey);

        if (stdoutBuffer.trim()) {
          processLine(stdoutBuffer.trim());
          stdoutBuffer = '';
        }

        // stdout truncation can swallow the event that would have closed the
        // last text segment; close it before the terminal complete so the
        // client never keeps a synthetic streaming row alive.
        if (agentResponseSegmentOpen) {
          agentResponseSegmentOpen = false;
          writer.send(createNormalizedMessage({
            id: generateMessageId(PROVIDER),
            kind: 'stream_end',
            sessionId: capturedSessionId || sessionId || null,
            provider: PROVIDER,
          }));
        }

        if (!completeSent) {
          completeSent = true;
          writer.send(createCompleteMessage({
            provider: PROVIDER,
            sessionId: capturedSessionId || sessionId || null,
            exitCode: code ?? 0,
          }));
        }

        // A SIGTERM from abort() closes with code null after the chat gateway
        // already completed the run: resolve quietly and notify 'aborted'
        // instead of reporting a failure or a completion.
        const wasAborted = abortedProcessKeys.delete(processKey);
        if (wasAborted) {
          notifyRunStopped({
            userId: writer.userId != null ? String(writer.userId) : null,
            provider: PROVIDER,
            sessionId: sessionId || capturedSessionId || processKey,
            sessionName: sessionSummary,
            stopReason: 'aborted',
          });
          settleOnce(() => resolve({ sessionId: capturedSessionId || sessionId, success: true, aborted: true }));
          return;
        }

        // agy reports actionable errors (auth, quota, bad flags) on stderr
        // only; surface the captured tail to the user instead of leaving it
        // in the server console.
        if (code !== 0 && stderrTail.trim()) {
          writer.send(createNormalizedMessage({
            id: generateMessageId(PROVIDER),
            kind: 'error',
            content: describeFailure(code),
            sessionId: capturedSessionId || sessionId || null,
            provider: PROVIDER,
            isError: true,
          }));
        }

        notifyTerminalState({ code });
        if (code === 0) {
          settleOnce(() => resolve({ sessionId: capturedSessionId || sessionId, success: true }));
        } else {
          settleOnce(() => reject(new Error(describeFailure(code))));
        }
      });

      agyProcess.on('error', (err: Error) => {
        activeProcesses.delete(processKey);
        console.error('[Antigravity CLI error]:', err);

        writer.send(createNormalizedMessage({
          id: generateMessageId(PROVIDER),
          kind: 'error',
          content: err.message,
          sessionId: capturedSessionId || sessionId || null,
          provider: PROVIDER,
          isError: true,
        }));

        if (!completeSent) {
          completeSent = true;
          writer.send(createCompleteMessage({
            provider: PROVIDER,
            sessionId: capturedSessionId || sessionId || null,
            exitCode: 1,
          }));
        }

        notifyTerminalState({ error: err });
        settleOnce(() => reject(err));
      });

      // Close stdin
      agyProcess.stdin?.end();
    });
  }

  /**
   * Aborts an active Antigravity session.
   */
  async abort(sessionId: string): Promise<boolean> {
    const process = activeProcesses.get(sessionId);
    if (process) {
      console.info(`[AntigravityRuntime] Aborting session: ${sessionId}`);
      abortedProcessKeys.add(sessionId);
      process.kill('SIGTERM');
      activeProcesses.delete(sessionId);
      return true;
    }
    return false;
  }
}

export const antigravityRuntime = new AntigravityRuntimeProvider();

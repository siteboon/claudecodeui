import crossSpawn from 'cross-spawn';

import {
  appendFilesInputTag,
  normalizeAttachmentDescriptors
} from '@/shared/image-attachments.js';
import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import {
  aggregateQoderTranscriptTokenUsage,
  createCompleteMessage,
  createNormalizedMessage,
  flattenPromptForWindowsShell,
  readJsonlEntries,
  resolveQoderTranscriptPath
} from '@/shared/utils.js';

import { resolveQoderPermissionOptions } from './qoder-permissions.provider.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;

const activeQoderProcesses = new Map();

function resolveQoderEffort(model, effort, modelsDefinition) {
  const selectedModel = modelsDefinition?.OPTIONS?.find((option) => option.value === model);
  const allowedEfforts = selectedModel?.effort?.values?.map((value) => value.value) || [];
  return typeof effort === 'string' && effort !== 'default' && allowedEfforts.includes(effort)
    ? effort
    : undefined;
}

/**
 * Builds the qodercli argv array from resolved model/effort/session inputs.
 *
 * Extracted from spawnQoder so the ordering invariant — `--attachment` flags
 * before the permission block (which may end with the variadic `--tools`),
 * then `--` separator, then the prompt — can be pinned by tests without
 * spawning the CLI. Consumed by spawnQoder below and by
 * tests/qoder-args.test.ts.
 */
export function buildQoderArgs(options) {
  const {
    resolvedModel,
    resolvedEffort,
    workingDir,
    providerSessionId,
    files,
    command,
    permissionMode,
    toolsSettings,
  } = options;

  // qodercli rejects the literal model name 'default' with
  // "Invalid model 'default'" (exit 42), so the fallback only kicks in
  // when the caller did not resolve a real model name.
  const resolvedModelArg = resolvedModel && resolvedModel !== 'default' ? resolvedModel : undefined;
  const args = ['-p', '--output-format', 'stream-json'];
  if (workingDir) {
    args.push('-w', workingDir);
  }
  if (providerSessionId) {
    // Resume the existing qoder transcript instead of asking qodercli to
    // create a session with an id that already exists on disk, which it
    // rejects with "Session ID ... is already in use."
    args.push('--resume', providerSessionId);
  }
  if (resolvedModelArg) {
    args.push('-m', resolvedModelArg);
  }
  if (resolvedEffort) {
    args.push('--reasoning-effort', resolvedEffort);
  }

  // Attachments come before the permission block on purpose: that block can
  // end with the variadic `--tools`, which keeps consuming bare arguments.
  // Emitting every other flag first means the only thing that can follow
  // `--tools` is the `--` separator, so correctness does not depend on the
  // CLI's "stop at the next dash-prefixed token" parsing detail.
  const fileDescriptors = normalizeAttachmentDescriptors(files);
  for (const descriptor of fileDescriptors) {
    if (descriptor.path) {
      args.push('--attachment', descriptor.path);
    }
  }
  const permissionOptions = resolveQoderPermissionOptions(permissionMode, toolsSettings);
  args.push(...permissionOptions.args);
  if ((command && command.trim()) || fileDescriptors.length > 0) {
    // Files still ride along as an <files_input> path list appended to the
    // prompt (the session history reader strips the tag back out), so the
    // attachment list and the transcript stay consistent.
    const promptWithAttachments = appendFilesInputTag(command?.trim() || '', files);
    if (permissionOptions.requiresPromptSeparator) {
      args.push('--');
    }
    args.push(flattenPromptForWindowsShell(promptWithAttachments));
  }

  return args;
}

function readQoderSessionId(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  // Qoder emits the provider-native session id under camelCase on transcript
  // rows, but the live `system/init` control event may carry it as snake_case
  // `session_id` (Claude-style). Read every spelling so the runtime — the
  // single owner of `session_created` — captures the id on whichever event
  // arrives first, preventing a duplicate emission downstream.
  return event.sessionID || event.sessionId || event.session_id || null;
}

/**
 * Qoder persists every run to `~/.qoder/projects/<encoded-cwd>/<sessionId>.jsonl`
 * (Claude-style JSONL; each line carries a `sessionId`). Assistant rows carry a
 * `usage` object, so token accounting is read straight from the transcript after
 * the process exits.
 *
 * qodercli 1.1.13 leaves every token field at 0 and measures spend as `credits`
 * plus a `context_usage_ratio`, which is why `supportsTokenUsage` is declared
 * false for this provider. The reader is kept because it costs one streamed pass
 * and starts producing real numbers the moment the CLI populates those fields.
 */
async function readQoderTokenUsage(sessionId, workingDir) {
  const jsonlPath = resolveQoderTranscriptPath({
    cwd: workingDir || process.cwd(),
    sessionId,
  });
  if (!jsonlPath) {
    return null;
  }

  return aggregateQoderTranscriptTokenUsage(readJsonlEntries(jsonlPath));
}

async function spawnQoder(command, options = {}, ws, context) {
  return new Promise((resolve, reject) => {
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
      toolsSettings
    } = options;
    // Callers pass the stable app session id; the CLI resumes with the
    // provider-native id recorded on the session row.
    const providerSessionId = context.resolveProviderSessionId(sessionId);
    const workingDir = cwd || projectPath || process.cwd();
    // Process-map key: the app session id when the caller supplied one, so
    // abort-by-app-id always works.
    const processKey = sessionId || Date.now().toString();
    let capturedSessionId = providerSessionId;
    let sessionCreatedSent = false;
    let stdoutLineBuffer = '';
    let terminalNotificationSent = false;
    let qoderProcess = null;
    // Unified lifecycle contract: exactly one terminal `complete` per run
    // (close and error handlers can both fire for spawn failures).
    let completeSent = false;

    const notifyTerminalState = ({ code = null, error = null } = {}) => {
      if (terminalNotificationSent) {
        return;
      }

      terminalNotificationSent = true;
      // Notifications are app-facing, so they carry the app session id.
      const finalSessionId = sessionId || capturedSessionId || processKey;
      if (code === 0 && !error) {
        notifyRunStopped({
          userId: ws?.userId || null,
          provider: 'qoder',
          sessionId: finalSessionId,
          sessionName: sessionSummary,
          stopReason: 'completed',
        });
        return;
      }

      notifyRunFailed({
        userId: ws?.userId || null,
        provider: 'qoder',
        sessionId: finalSessionId,
        sessionName: sessionSummary,
        error: error || `Qoder CLI exited with code ${code}`,
      });
    };

    const registerSession = (nextSessionId) => {
      if (!nextSessionId || capturedSessionId === nextSessionId) {
        return;
      }

      capturedSessionId = nextSessionId;
      // Legacy/direct callers without an app session id re-key the process
      // under the provider-native id once it is known.
      if (!sessionId && processKey !== capturedSessionId && qoderProcess) {
        activeQoderProcesses.delete(processKey);
        activeQoderProcesses.set(capturedSessionId, qoderProcess);
      }
      if (qoderProcess) {
        qoderProcess.sessionId = capturedSessionId;
      }

      if (ws.setSessionId && typeof ws.setSessionId === 'function') {
        ws.setSessionId(capturedSessionId);
      }

      if (!providerSessionId && !sessionCreatedSent) {
        sessionCreatedSent = true;
        ws.send(createNormalizedMessage({
          kind: 'session_created',
          newSessionId: capturedSessionId,
          sessionId: capturedSessionId,
          provider: 'qoder',
        }));
      }
    };

    const processQoderOutputLine = (line) => {
      if (!line || !line.trim()) {
        return;
      }

      let response;
      try {
        response = JSON.parse(line);
      } catch {
        ws.send(createNormalizedMessage({
          kind: 'stream_delta',
          content: line,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'qoder',
        }));
        return;
      }

      try {
        registerSession(readQoderSessionId(response));
        const normalized = context.normalizeMessage(response, capturedSessionId || sessionId || null);
        for (const msg of normalized) {
          ws.send(msg);
        }
      } catch (error) {
        const errorContent = error instanceof Error ? error.message : String(error);
        console.error('[Qoder] Failed to process JSON output:', errorContent);
        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'qoder',
        }));
      }
    };

    void context.resolveResumeModel(sessionId, model).then(async (resolvedModel) => {
      let effortModels = null;
      try {
        effortModels = await context.getProviderModels();
      } catch (error) {
        console.warn('[Qoder] Unable to load provider models for effort validation:', error);
      }

      const resolvedEffort = resolveQoderEffort(resolvedModel, effort, effortModels);
      // qoder's CLI has no image entry point (supportsImages=false). Tell the
      // user instead of dropping them silently, otherwise the model just looks
      // like it ignored the picture.
      const ignoredImageCount = Array.isArray(images) ? images.length : 0;
      if (ignoredImageCount > 0) {
        ws.send(createNormalizedMessage({
          kind: 'status',
          text: `Ignored ${ignoredImageCount} image attachment(s): Qoder CLI does not accept images.`,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'qoder',
        }));
      }

      const args = buildQoderArgs({
        resolvedModel,
        resolvedEffort,
        workingDir,
        providerSessionId,
        files,
        command,
        permissionMode,
        toolsSettings,
      });

      qoderProcess = spawnFunction('qodercli', args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      activeQoderProcesses.set(processKey, qoderProcess);
      qoderProcess.sessionId = processKey;
      qoderProcess.stdin.end();

      qoderProcess.stdout.on('data', (data) => {
        stdoutLineBuffer += data.toString();
        const completeLines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = completeLines.pop() || '';

        completeLines.forEach((line) => {
          processQoderOutputLine(line.trim());
        });
      });

      qoderProcess.stderr.on('data', (data) => {
        const stderrText = data.toString();
        if (!stderrText.trim()) {
          return;
        }

        ws.send(createNormalizedMessage({
          kind: 'error',
          content: stderrText,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'qoder',
        }));
      });

      qoderProcess.on('close', async (code) => {
        const finalSessionId = sessionId || capturedSessionId || processKey;
        activeQoderProcesses.delete(finalSessionId);
        activeQoderProcesses.delete(processKey);

        if (stdoutLineBuffer.trim()) {
          processQoderOutputLine(stdoutLineBuffer.trim());
          stdoutLineBuffer = '';
        }

        // Qoder's own transcript is keyed by the provider-native id under the
        // encoded working directory.
        const tokenBudget = await readQoderTokenUsage(capturedSessionId, workingDir);
        if (tokenBudget) {
          ws.send(createNormalizedMessage({
            kind: 'status',
            text: 'token_budget',
            tokenBudget,
            sessionId: finalSessionId,
            provider: 'qoder',
          }));
        }

        // Terminal complete — skipped for aborted runs (abort-session
        // already sent the aborted complete on this run's behalf).
        if (!completeSent && !qoderProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'qoder', sessionId: finalSessionId, exitCode: code }));
        }

        if (code === 0) {
          notifyTerminalState({ code });
          resolve();
          return;
        }

        if (code === 127 || code === null) {
          const installed = await context.isProviderInstalled();
          if (!installed) {
            ws.send(createNormalizedMessage({
              kind: 'error',
              content: 'qodercli is not installed. Install it with: npm install -g @qoder-ai/qodercli',
              sessionId: finalSessionId,
              provider: 'qoder',
            }));
          }
        }

        notifyTerminalState({ code });
        reject(new Error(code === null ? 'Qoder CLI process was terminated' : `Qoder CLI exited with code ${code}`));
      });

      qoderProcess.on('error', async (error) => {
        const finalSessionId = sessionId || capturedSessionId || processKey;
        activeQoderProcesses.delete(finalSessionId);
        activeQoderProcesses.delete(processKey);

        const installed = await context.isProviderInstalled();
        const errorContent = !installed
          ? 'qodercli is not installed. Install it with: npm install -g @qoder-ai/qodercli'
          : error.message;

        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: finalSessionId,
          provider: 'qoder',
        }));
        if (!completeSent && !qoderProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'qoder', sessionId: finalSessionId, exitCode: 1 }));
        }
        notifyTerminalState({ error });
        reject(error);
      });
    }).catch(reject);
  });
}

function abortQoderSession(sessionId) {
  // Named `qoderProcess` rather than `process` so it cannot shadow the global.
  const qoderProcess = activeQoderProcesses.get(sessionId);
  if (!qoderProcess) {
    return false;
  }

  // The abort handler sends the terminal complete (aborted: true); flag the
  // process so its close handler does not emit a second one.
  qoderProcess.aborted = true;
  qoderProcess.kill('SIGTERM');
  activeQoderProcesses.delete(sessionId);
  return true;
}

// The provider's only runtime contract, consumed by qoder.provider.ts and
// resolved through providerRegistry by providerRuntimeService.
export const qoderRuntime = {
  run: spawnQoder,
  abort: abortQoderSession,
};

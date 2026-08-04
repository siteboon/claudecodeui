import fsSync from 'node:fs';
import path from 'node:path';

import crossSpawn from 'cross-spawn';

import {
  appendFilesInputTag,
  normalizeAttachmentDescriptors
} from '@/shared/image-attachments.js';
import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import { createCompleteMessage, createNormalizedMessage, flattenPromptForWindowsShell, getQoderProjectsDir } from '@/shared/utils.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;

const activeQoderProcesses = new Map();

/**
 * Maps the UI permission mode onto qodercli's non-interactive controls
 * (verified against qodercli v1.1.13):
 * - bypassPermissions → `--permission-mode bypass_permissions`, auto-approves
 *                       every permission prompt.
 * - acceptEdits       → `--permission-mode accept_edits`, auto-accepts file
 *                       edits while still prompting for other tools.
 * - plan              → qodercli has no read-only plan mode; falls through to
 *                       the default (no extra flags).
 * - default           → nothing; qoder's own settings.json governs.
 *
 * Exported for tests only.
 */
export function resolveQoderPermissionOptions(permissionMode) {
  switch (permissionMode) {
    case 'bypassPermissions':
      return { args: ['--permission-mode', 'bypass_permissions'], env: {} };
    case 'acceptEdits':
      return { args: ['--permission-mode', 'accept_edits'], env: {} };
    default:
      return { args: [], env: {} };
  }
}

function resolveQoderEffort(model, effort, modelsDefinition) {
  const selectedModel = modelsDefinition?.OPTIONS?.find((option) => option.value === model);
  const allowedEfforts = selectedModel?.effort?.values?.map((value) => value.value) || [];
  return typeof effort === 'string' && effort !== 'default' && allowedEfforts.includes(effort)
    ? effort
    : undefined;
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
 * (Claude-style JSONL; each line carries a `sessionId`). Assistant rows carry
 * a `usage` object with input/output/cache token counts, so token accounting
 * is read straight from the transcript after the process exits.
 */
function readQoderTokenUsage(sessionId, workingDir) {
  if (!sessionId) {
    return null;
  }

  const encodedCwd = (workingDir || process.cwd()).replace(/\//g, '-');
  const jsonlPath = path.join(getQoderProjectsDir(), encodedCwd, `${sessionId}.jsonl`);
  if (!fsSync.existsSync(jsonlPath)) {
    return null;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  try {
    const content = fsSync.readFileSync(jsonlPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry?.type !== 'assistant' || !entry?.message?.usage) {
        continue;
      }

      const usage = entry.message.usage;
      inputTokens += Number(usage.input_tokens || 0);
      outputTokens += Number(usage.output_tokens || 0);
      cacheReadTokens += Number(usage.cache_read_input_tokens || 0);
      cacheCreationTokens += Number(usage.cache_creation_input_tokens || 0);
    }
  } catch {
    return null;
  }

  const used = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
  if (used <= 0) {
    return null;
  }

  const computedInput = inputTokens + cacheReadTokens;
  return {
    used,
    inputTokens: computedInput,
    outputTokens,
    breakdown: {
      input: computedInput,
      output: outputTokens,
    },
  };
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
      permissionMode
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
      const permissionOptions = resolveQoderPermissionOptions(permissionMode);
      args.push(...permissionOptions.args);
      const fileDescriptors = normalizeAttachmentDescriptors(files);
      // qoder's CLI takes one --attachment per file; images are not supported
      // (supportsImages=false), so image descriptors are skipped.
      for (const descriptor of fileDescriptors) {
        if (descriptor.path) {
          args.push('--attachment', descriptor.path);
        }
      }
      if ((command && command.trim()) || fileDescriptors.length > 0) {
        // Files still ride along as an <files_input> path list appended to the
        // prompt (the session history reader strips the tag back out), so the
        // attachment list and the transcript stay consistent.
        const promptWithAttachments = appendFilesInputTag(command?.trim() || '', files);
        args.push(flattenPromptForWindowsShell(promptWithAttachments));
      }

      qoderProcess = spawnFunction('qodercli', args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...permissionOptions.env },
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
        const tokenBudget = readQoderTokenUsage(capturedSessionId, workingDir);
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
  const process = activeQoderProcesses.get(sessionId);
  if (!process) {
    return false;
  }

  // The abort handler sends the terminal complete (aborted: true); flag the
  // process so its close handler does not emit a second one.
  process.aborted = true;
  process.kill('SIGTERM');
  activeQoderProcesses.delete(sessionId);
  return true;
}

function isQoderSessionActive(sessionId) {
  return activeQoderProcesses.has(sessionId);
}

function getActiveQoderSessions() {
  return Array.from(activeQoderProcesses.keys());
}

export const qoderRuntime = {
  run: spawnQoder,
  abort: abortQoderSession,
};

export {
  spawnQoder,
  abortQoderSession,
  isQoderSessionActive,
  getActiveQoderSessions,
};

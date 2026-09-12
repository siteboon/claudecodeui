import crossSpawn from 'cross-spawn';

import {
  appendFilesInputTag,
  appendImagesInputTag,
  normalizeAttachmentDescriptors
} from '@/shared/image-attachments.js';
import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import { AppError, createCompleteMessage, createNormalizedMessage, flattenPromptForWindowsShell } from '@/shared/utils.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;

const activePiProcesses = new Map();

/**
 * Builds the `pi -p --mode json` argument vector for one run.
 *
 * Verified against pi 0.85.1 (docs/pi-notes.md):
 * - the prompt is the final positional argument (print mode reads it, no stdin);
 * - `--session` resumes a provider session with its full uuid (resumed runs
 *   keep the same session id and append to the same session file);
 * - `--model` accepts a bare model id or a `provider/model` pair;
 * - there is no `--dir`/`--cwd` flag — the working directory is the spawn
 *   `cwd` option.
 *
 * Exported for tests only.
 */
export function buildPiArgs({ providerSessionId, model, prompt }) {
  const args = ['-p', '--mode', 'json'];
  if (providerSessionId) {
    args.push('--session', providerSessionId);
  }
  if (model) {
    args.push('--model', model);
  }
  if (prompt && prompt.trim()) {
    args.push(flattenPromptForWindowsShell(prompt));
  }
  return args;
}

/**
 * Reads the provider-native session id out of one parsed stdout event.
 *
 * Only the `session` header carries an id; the streaming events reference
 * messages and tool calls, never the session.
 */
function readPiSessionId(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  return event.type === 'session' && typeof event.id === 'string' ? event.id : null;
}

/**
 * Maps pi's cumulative usage counters onto the token-budget shape the chat
 * composer reads (`inputTokens`/`outputTokens`/`used`/`breakdown`, mirroring
 * the opencode runtime), keeping pi's own totals and cost as extra fields.
 *
 * pi reports cache reads separately; like opencode, they count as input.
 */
function readPiTokenBudget(usage) {
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const inputTokens = Number(usage.input || 0) + Number(usage.cacheRead || 0);
  const outputTokens = Number(usage.output || 0);
  const used = Number(usage.totalTokens || 0) || inputTokens + outputTokens;
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
    totalTokens: Number(usage.totalTokens || 0),
    cost: usage.cost && typeof usage.cost === 'object' ? usage.cost.total : undefined,
  };
}

/**
 * Parses one stdout line from `pi -p --mode json` and forwards what it yields.
 *
 * Exported for tests only; the runtime passes a ctx bag because the mutable
 * state (captured session id, last usage) lives in the run closure.
 *
 * - Unparseable lines (pi's own warnings mixed into stdout) stream through as
 *   deltas rather than killing the run.
 * - The `session` header registers the provider-native id (contract: new
 *   provider sessions announce `session_created` once, and the writer learns
 *   the id before any content event).
 * - Every event's top-level `usage` is cumulative, so the last one seen wins.
 * - Event-to-message mapping is `context.normalizeMessage`; the runtime never
 *   interprets event contents itself.
 */
export function processPiOutputLine(line, ctx) {
  if (!line || !line.trim()) {
    return;
  }

  let event;
  try {
    event = JSON.parse(line);
  } catch {
    ctx.ws.send(createNormalizedMessage({
      kind: 'stream_delta',
      content: line,
      sessionId: ctx.getCapturedSessionId() || ctx.sessionId || null,
      provider: 'pi',
    }));
    return;
  }

  try {
    const nextSessionId = readPiSessionId(event);
    if (nextSessionId) {
      ctx.registerSession(nextSessionId);
    }
    if (event && typeof event === 'object' && event.usage && typeof event.usage === 'object') {
      ctx.setUsage(event.usage);
    }
    const normalized = ctx.normalizeMessage(event, ctx.getCapturedSessionId() || ctx.sessionId || null);
    for (const msg of normalized) {
      ctx.ws.send(msg);
    }
  } catch (error) {
    const errorContent = error instanceof Error ? error.message : String(error);
    console.error('[Pi] Failed to process JSON output:', errorContent);
    ctx.ws.send(createNormalizedMessage({
      kind: 'error',
      content: errorContent,
      sessionId: ctx.getCapturedSessionId() || ctx.sessionId || null,
      provider: 'pi',
    }));
  }
}

async function spawnPi(command, options = {}, ws, context) {
  return new Promise((resolve, reject) => {
    const {
      sessionId,
      projectPath,
      cwd,
      model,
      sessionSummary,
      images,
      files
      // `permissionMode` and `effort` are deliberately NOT destructured: pi
      // has no permission system and no reasoning-effort lever (see the pi
      // capabilities), so neither option maps to any CLI flag or env var.
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
    let lastUsage = null;
    let stdoutLineBuffer = '';
    let terminalNotificationSent = false;
    let piProcess = null;
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
          provider: 'pi',
          sessionId: finalSessionId,
          sessionName: sessionSummary,
          stopReason: 'completed',
        });
        return;
      }

      notifyRunFailed({
        userId: ws?.userId || null,
        provider: 'pi',
        sessionId: finalSessionId,
        sessionName: sessionSummary,
        error: error || `Pi CLI exited with code ${code}`,
      });
    };

    const registerSession = (nextSessionId) => {
      if (!nextSessionId || capturedSessionId === nextSessionId) {
        return;
      }

      capturedSessionId = nextSessionId;
      // Legacy/direct callers without an app session id re-key the process
      // under the provider-native id once it is known.
      if (!sessionId && processKey !== capturedSessionId && piProcess) {
        activePiProcesses.delete(processKey);
        activePiProcesses.set(capturedSessionId, piProcess);
      }
      if (piProcess) {
        piProcess.sessionId = capturedSessionId;
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
          provider: 'pi',
        }));
      }
    };

    const processCtx = {
      ws,
      sessionId,
      getCapturedSessionId: () => capturedSessionId,
      registerSession,
      setUsage: (usage) => {
        lastUsage = usage;
      },
      normalizeMessage: (raw, normalizedSessionId) => context.normalizeMessage(raw, normalizedSessionId),
    };

    void context.resolveResumeModel(sessionId, model).then(async (resolvedModel) => {
      const args = buildPiArgs({ providerSessionId, model: resolvedModel });
      const hasAttachments =
        normalizeAttachmentDescriptors(images).length > 0
        || normalizeAttachmentDescriptors(files).length > 0;
      if ((command && command.trim()) || hasAttachments) {
        // Attachment paths ride along as <images_input>/<files_input> blocks
        // appended to the prompt; the session history reader strips the tags
        // back out. pi is a .cmd shim on Windows, so the whole argument must
        // be newline-free or cmd.exe silently truncates it.
        const promptWithAttachments = appendFilesInputTag(
          appendImagesInputTag(command?.trim() || '', images),
          files
        );
        args.push(flattenPromptForWindowsShell(promptWithAttachments));
      }

      piProcess = spawnFunction('pi', args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        // pi has no permission levers, so unlike opencode there is no env
        // override to merge here — the user's own pi config governs.
        env: { ...process.env },
      });

      activePiProcesses.set(processKey, piProcess);
      piProcess.sessionId = processKey;
      piProcess.stdin.end();

      piProcess.stdout.on('data', (data) => {
        stdoutLineBuffer += data.toString();
        const completeLines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = completeLines.pop() || '';

        completeLines.forEach((line) => {
          processPiOutputLine(line.trim(), processCtx);
        });
      });

      piProcess.stderr.on('data', (data) => {
        const stderrText = data.toString();
        if (!stderrText.trim()) {
          return;
        }

        ws.send(createNormalizedMessage({
          kind: 'error',
          content: stderrText,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'pi',
        }));
      });

      piProcess.on('close', async (code) => {
        const finalSessionId = sessionId || capturedSessionId || processKey;
        activePiProcesses.delete(finalSessionId);
        activePiProcesses.delete(processKey);

        if (stdoutLineBuffer.trim()) {
          processPiOutputLine(stdoutLineBuffer.trim(), processCtx);
          stdoutLineBuffer = '';
        }

        // pi reports cumulative usage on every event; the last one seen is
        // the run's final accounting.
        const tokenBudget = readPiTokenBudget(lastUsage);
        if (tokenBudget) {
          ws.send(createNormalizedMessage({
            kind: 'status',
            text: 'token_budget',
            tokenBudget,
            sessionId: finalSessionId,
            provider: 'pi',
          }));
        }

        // Terminal complete — skipped for aborted runs (abort-session
        // already sent the aborted complete on this run's behalf).
        if (!completeSent && !piProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({
            provider: 'pi',
            sessionId: finalSessionId,
            actualSessionId: capturedSessionId || null,
            exitCode: code,
          }));
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
              content: 'Pi CLI is not installed. Install it from https://pi.dev/',
              sessionId: finalSessionId,
              provider: 'pi',
            }));
          }
        }

        notifyTerminalState({ code });
        reject(new Error(code === null ? 'pi process was terminated' : `pi exited with code ${code}`));
      });

      piProcess.on('error', async (error) => {
        const finalSessionId = sessionId || capturedSessionId || processKey;
        activePiProcesses.delete(finalSessionId);
        activePiProcesses.delete(processKey);

        const installed = await context.isProviderInstalled();
        const notInstalled = error.code === 'ENOENT' && !installed;
        const errorContent = !installed
          ? 'Pi CLI is not installed. Install it from https://pi.dev/'
          : error.message;

        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: finalSessionId,
          provider: 'pi',
        }));
        if (!completeSent && !piProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'pi', sessionId: finalSessionId, exitCode: 1 }));
        }
        notifyTerminalState({ error });
        if (notInstalled) {
          reject(new AppError('Pi CLI is not installed. Install it from https://pi.dev/', {
            code: 'PROVIDER_NOT_INSTALLED',
          }));
          return;
        }
        reject(error);
      });
    }).catch(reject);
  });
}

function abortPiSession(sessionId) {
  const process = activePiProcesses.get(sessionId);
  if (!process) {
    return false;
  }

  // The abort handler sends the terminal complete (aborted: true); flag the
  // process so its close handler does not emit a second one.
  process.aborted = true;
  process.kill('SIGTERM');
  activePiProcesses.delete(sessionId);
  return true;
}

function isPiSessionActive(sessionId) {
  return activePiProcesses.has(sessionId);
}

function getActivePiSessions() {
  return Array.from(activePiProcesses.keys());
}

export const piRuntime = {
  run: spawnPi,
  abort: abortPiSession,
};

export {
  spawnPi,
  abortPiSession,
  isPiSessionActive,
  getActivePiSessions,
};

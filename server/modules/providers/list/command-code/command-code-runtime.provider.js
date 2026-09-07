import crossSpawn from 'cross-spawn';

import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import {
  createCompleteMessage,
  createNormalizedMessage,
  flattenPromptForWindowsShell,
} from '@/shared/utils.js';

// cross-spawn resolves `.cmd`/`.ps1` shims on Windows and delegates to
// child_process.spawn everywhere else. The CLI is always invoked as
// `command-code` (the Windows `cmdc` alias is never used directly).
const spawnFunction = crossSpawn;

const COMMAND_CODE_BINARY = 'command-code';

const activeCommandCodeProcesses = new Map();

/**
 * Maps the UI permission mode onto Command Code's headless permission levers.
 *
 * Command Code's `--permission-mode` vocabulary (`default`, `plan`,
 * `auto-accept`, `dont-ask`; legacy `standard`) differs from the frontend's
 * `PermissionMode` union (`default`, `acceptEdits`, `auto`, `bypassPermissions`,
 * `plan`). The runtime owns the ONLY translation table between the two:
 *
 * - plan              -> `--plan` (read-only exploration)
 * - bypassPermissions -> `--yolo` (alias `--dangerously-skip-permissions`)
 * - acceptEdits       -> `--permission-mode auto-accept`
 * - default / auto    -> `--permission-mode default`
 *
 * Exported for tests.
 */
export function resolveCommandCodePermissionArgs(permissionMode) {
  switch (permissionMode) {
    case 'plan':
      return ['--plan'];
    case 'bypassPermissions':
      return ['--yolo'];
    case 'acceptEdits':
      return ['--permission-mode', 'auto-accept'];
    default:
      return ['--permission-mode', 'default'];
  }
}

/**
 * Reads the session id Command Code reports on an NDJSON result frame.
 *
 * The result frame (`{"type":"result","subtype":"success","sessionId":...}`)
 * is the last line of the stream and carries the provider-native session id;
 * it is the only authoritative source for a freshly created session.
 */
function readResultSessionId(parsed) {
  if (!parsed || typeof parsed !== 'object' || parsed.type !== 'result') {
    return null;
  }
  return typeof parsed.sessionId === 'string' && parsed.sessionId.trim()
    ? parsed.sessionId
    : null;
}

/**
 * Reads the token usage Command Code reports on the NDJSON result frame.
 *
 * The result frame carries a `usage` object with the run's token totals.
 * Returns null when the frame has no usable usage so callers can skip the
 * `token_budget` status.
 */
function readResultUsage(parsed) {
  if (!parsed || typeof parsed !== 'object' || parsed.type !== 'result') {
    return null;
  }
  const usage = parsed.usage;
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const input = Number(usage.inputTokens ?? usage.input ?? 0);
  const output = Number(usage.outputTokens ?? usage.output ?? 0);
  const used = input + output;
  if (used <= 0) {
    return null;
  }

  return {
    used,
    inputTokens: input,
    outputTokens: output,
    breakdown: { input, output },
  };
}

async function spawnCommandCode(command, options = {}, ws, context) {
  return new Promise((resolve, reject) => {
    const {
      sessionId,
      projectPath,
      cwd,
      model,
      effort,
      sessionSummary,
      permissionMode,
      images,
      files,
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
    let commandCodeProcess = null;
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
          provider: 'command-code',
          sessionId: finalSessionId,
          sessionName: sessionSummary,
          stopReason: 'completed',
        });
        return;
      }

      notifyRunFailed({
        userId: ws?.userId || null,
        provider: 'command-code',
        sessionId: finalSessionId,
        sessionName: sessionSummary,
        error: error || `Command Code CLI exited with code ${code}`,
      });
    };

    const registerSession = (nextSessionId) => {
      if (!nextSessionId || capturedSessionId === nextSessionId) {
        return;
      }

      capturedSessionId = nextSessionId;
      if (!sessionId && processKey !== capturedSessionId && commandCodeProcess) {
        activeCommandCodeProcesses.delete(processKey);
        activeCommandCodeProcesses.set(capturedSessionId, commandCodeProcess);
      }
      if (commandCodeProcess) {
        commandCodeProcess.sessionId = capturedSessionId;
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
          provider: 'command-code',
        }));
      }
    };

    const processCommandCodeOutputLine = (line) => {
      if (!line || !line.trim()) {
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        // Non-JSON lines (e.g. a stray banner) are forwarded as raw deltas so
        // nothing the CLI prints is silently dropped.
        ws.send(createNormalizedMessage({
          kind: 'stream_delta',
          content: line,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'command-code',
        }));
        return;
      }

      try {
        const resultSessionId = readResultSessionId(parsed);
        registerSession(resultSessionId);

        // The result frame is terminal and carries the run's token usage.
        // Emit the usage as a status once it arrives.
        const tokenBudget = readResultUsage(parsed);
        if (tokenBudget) {
          ws.send(createNormalizedMessage({
            kind: 'status',
            text: 'token_budget',
            tokenBudget,
            sessionId: capturedSessionId || sessionId || null,
            provider: 'command-code',
          }));
        }

        const normalized = context.normalizeMessage(parsed, capturedSessionId || sessionId || null);
        for (const msg of normalized) {
          ws.send(msg);
        }
      } catch (error) {
        const errorContent = error instanceof Error ? error.message : String(error);
        console.error('[CommandCode] Failed to process JSON output:', errorContent);
        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'command-code',
        }));
      }
    };

    void context.resolveResumeModel(sessionId, model).then(async (resolvedModel) => {
      const args = ['-p', '--output-format', 'json'];
      if (providerSessionId) {
        args.push('--resume', providerSessionId);
      }
      if (resolvedModel) {
        args.push('-m', resolvedModel);
      }
      if (typeof effort === 'string' && effort !== 'default') {
        args.push('--effort', effort);
      }
      args.push('--no-auto-update');
      args.push('--skip-onboarding');
      args.push(...resolveCommandCodePermissionArgs(permissionMode));

      const hasAttachments =
        (Array.isArray(images) && images.length > 0)
        || (Array.isArray(files) && files.length > 0);
      if ((command && command.trim()) || hasAttachments) {
        // Note: Command Code's headless `-p` mode has no image/file attachment
        // flag today; images/files are intentionally not appended (AD-11 sets
        // supportsImages/supportsFiles false). The prompt is flattened on win32
        // because `command-code` is a `.cmd`/`.ps1` shim there and cmd.exe
        // truncates argv at the first newline.
        args.push(flattenPromptForWindowsShell(command?.trim() || ''));
      }

      commandCodeProcess = spawnFunction(COMMAND_CODE_BINARY, args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      activeCommandCodeProcesses.set(processKey, commandCodeProcess);
      commandCodeProcess.sessionId = processKey;
      commandCodeProcess.stdin.end();

      commandCodeProcess.stdout.on('data', (data) => {
        stdoutLineBuffer += data.toString();
        const completeLines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = completeLines.pop() || '';

        completeLines.forEach((line) => {
          processCommandCodeOutputLine(line.trim());
        });
      });

      commandCodeProcess.stderr.on('data', (data) => {
        const stderrText = data.toString();
        if (!stderrText.trim()) {
          return;
        }
        ws.send(createNormalizedMessage({
          kind: 'error',
          content: stderrText,
          sessionId: capturedSessionId || sessionId || null,
          provider: 'command-code',
        }));
      });

      commandCodeProcess.on('close', async (code) => {
        const finalSessionId = sessionId || capturedSessionId || processKey;
        activeCommandCodeProcesses.delete(finalSessionId);
        activeCommandCodeProcesses.delete(processKey);

        if (commandCodeProcess.aborted) {
          // The abort caller already reported terminal completion; do nothing
          // further so an aborted run never triggers a second notification or
          // an install probe.
          return;
        }

        if (stdoutLineBuffer.trim()) {
          processCommandCodeOutputLine(stdoutLineBuffer.trim());
          stdoutLineBuffer = '';
        }

        // Terminal complete — skipped for aborted runs (abort-session already
        // sent the aborted complete on this run's behalf).
        if (!completeSent) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'command-code', sessionId: finalSessionId, exitCode: code }));
        }

        // Exit 8 (max-turns reached) still produced a valid partial result, so
        // it is not treated as a hard failure. We surface it via the
        // terminal complete (exitCode 8) and resolve the run; the frontend can
        // distinguish max_turns from success by exitCode.
        if (code === 0 || code === 8) {
          notifyTerminalState({ code });
          resolve();
          return;
        }

        if (code === 130) {
          notifyTerminalState({ code });
          reject(new Error('Command Code CLI was interrupted'));
          return;
        }

        if (code === 127 || code === null) {
          const installed = await context.isProviderInstalled();
          if (!installed) {
            ws.send(createNormalizedMessage({
              kind: 'error',
              content: 'Command Code CLI is not installed. Install it with: npm i -g command-code',
              sessionId: finalSessionId,
              provider: 'command-code',
            }));
          }
        }

        notifyTerminalState({ code });
        reject(new Error(code === null ? 'Command Code CLI process was terminated' : `Command Code CLI exited with code ${code}`));
      });

      commandCodeProcess.on('error', async (error) => {
        const finalSessionId = sessionId || capturedSessionId || processKey;
        activeCommandCodeProcesses.delete(finalSessionId);
        activeCommandCodeProcesses.delete(processKey);

        if (commandCodeProcess.aborted) {
          // Abort already reported terminal completion.
          return;
        }

        const installed = await context.isProviderInstalled();
        const errorContent = !installed
          ? 'Command Code CLI is not installed. Install it with: npm i -g command-code'
          : error.message;

        ws.send(createNormalizedMessage({
          kind: 'error',
          content: errorContent,
          sessionId: finalSessionId,
          provider: 'command-code',
        }));
        if (!completeSent) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'command-code', sessionId: finalSessionId, exitCode: 1 }));
        }
        notifyTerminalState({ error });
        reject(error);
      });
    }).catch(reject);
  });
}

function abortCommandCodeSession(sessionId) {
  const process = activeCommandCodeProcesses.get(sessionId);
  if (!process) {
    return false;
  }

  process.aborted = true;
  process.kill('SIGTERM');
  activeCommandCodeProcesses.delete(sessionId);
  return true;
}

function isCommandCodeSessionActive(sessionId) {
  return activeCommandCodeProcesses.has(sessionId);
}

export const commandCodeRuntime = {
  run: spawnCommandCode,
  abort: abortCommandCodeSession,
};

export {
  spawnCommandCode,
  abortCommandCodeSession,
  isCommandCodeSessionActive,
};

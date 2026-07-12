import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import pty, { type IPty } from 'node-pty';
import { WebSocket, type RawData } from 'ws';

import { parseIncomingJsonObject } from '@/shared/utils.js';

type ShellIncomingMessage = {
  type?: string;
  data?: string;
  cols?: number;
  rows?: number;
  projectPath?: string;
  sessionId?: string;
  hasSession?: boolean;
  provider?: string;
  initialCommand?: string;
  isPlainShell?: boolean;
  forceRestart?: boolean;
  shellClientId?: string;
};

type PtySessionEntry = {
  pty: IPty;
  ws: WebSocket | null;
  buffer: string[];
  timeoutId: NodeJS.Timeout | null;
  projectPath: string;
  sessionId: string | null;
  // Session id this PTY's `claude` was launched with (via --session-id), so a
  // later init that references the session by id can find this same PTY.
  assignedClaudeSessionId: string | null;
};

const ptySessionsMap = new Map<string, PtySessionEntry>();
// Maps a pre-assigned Claude session id to the PTY registry key it lives under.
// A shell that starts as "new" is keyed by its client identity; once the UI
// re-opens the same conversation by session id, this alias routes the init back
// to the original PTY instead of spawning a duplicate `claude --resume`.
const claudeSessionAliasMap = new Map<string, string>();
const PTY_SESSION_TIMEOUT = 30 * 60 * 1000;
const SHELL_URL_PARSE_BUFFER_LIMIT = 32768;

/**
 * Drops a PTY registry entry along with its pending kill timer and any Claude
 * session alias that still routes to it. Callers decide whether to kill the pty.
 */
function deletePtySessionEntry(key: string, session: PtySessionEntry): void {
  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
  }

  if (
    session.assignedClaudeSessionId &&
    claudeSessionAliasMap.get(session.assignedClaudeSessionId) === key
  ) {
    claudeSessionAliasMap.delete(session.assignedClaudeSessionId);
  }

  ptySessionsMap.delete(key);
}

type ShellWebSocketDependencies = {
  resolveProviderSessionId: (
    sessionId: string,
    provider: string,
  ) => string | null | undefined;
  stripAnsiSequences: (content: string) => string;
  normalizeDetectedUrl: (url: string) => string | null;
  extractUrlsFromText: (content: string) => string[];
  shouldAutoOpenUrlFromOutput: (content: string) => boolean;
};

/**
 * Reads a string field from untyped payloads and falls back when absent.
 */
function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Reads a boolean field from untyped payloads and falls back when absent.
 */
function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Reads a finite number field from untyped payloads and falls back when absent.
 */
function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Parses incoming websocket shell messages and keeps processing safe when
 * malformed payloads are received.
 */
function parseShellMessage(rawMessage: RawData): ShellIncomingMessage | null {
  const payload = parseIncomingJsonObject(rawMessage);
  if (!payload) {
    return null;
  }

  return payload as ShellIncomingMessage;
}

const SAFE_SESSION_ID_PATTERN = /^[a-zA-Z0-9_.\-:]+$/;

function resolveResumeSessionId(
  message: ShellIncomingMessage,
  dependencies: ShellWebSocketDependencies
): string {
  const hasSession = readBoolean(message.hasSession);
  const sessionId = readString(message.sessionId);
  const provider = readString(message.provider, 'claude');

  if (!hasSession || !sessionId) {
    return '';
  }

  let resumeSessionId: string | null | undefined;
  try {
    resumeSessionId = dependencies.resolveProviderSessionId(sessionId, provider);
  } catch (error) {
    console.error('Failed to resolve provider session ID:', error);
    resumeSessionId = undefined;
  }

  const resolvedSessionId = resumeSessionId === undefined ? sessionId : resumeSessionId;
  if (!resolvedSessionId || !SAFE_SESSION_ID_PATTERN.test(resolvedSessionId)) {
    return '';
  }

  return resolvedSessionId;
}

// Client-generated shell identities are uuid-shaped; anything else is ignored
// so a malformed value degrades to the legacy shared key instead of erroring.
const SAFE_SHELL_CLIENT_ID_PATTERN = /^[a-zA-Z0-9-]{1,64}$/;

export type PtySessionKeyParts = {
  projectPath: string;
  sessionId: string | null;
  shellClientId: string | null;
  isPlainShell: boolean;
  initialCommand: string;
};

/**
 * Resolves the PTY registry key for a shell init.
 *
 * Shells opened for an existing session are keyed by that session id, so any
 * client (including another device) reattaches to the same PTY. Shells opened
 * as "new" have no session id yet; keying them all to a shared default made
 * every new-session shell in a project collide on one PTY (see #1004), so when
 * the client supplies a per-tab identity the key includes it — distinct tabs
 * get distinct PTYs while the same tab still reattaches after a remount.
 * Clients that don't send an identity keep the legacy shared key.
 */
export function resolvePtySessionKey(parts: PtySessionKeyParts): string {
  const commandSuffix =
    parts.isPlainShell && parts.initialCommand
      ? `_cmd_${Buffer.from(parts.initialCommand).toString('base64').slice(0, 16)}`
      : '';

  if (parts.sessionId) {
    return `${parts.projectPath}_${parts.sessionId}${commandSuffix}`;
  }

  const clientId =
    parts.shellClientId && SAFE_SHELL_CLIENT_ID_PATTERN.test(parts.shellClientId)
      ? parts.shellClientId
      : null;
  if (clientId) {
    return `${parts.projectPath}_new_${clientId}${commandSuffix}`;
  }

  return `${parts.projectPath}_default${commandSuffix}`;
}

/**
 * Follows a Claude session-id alias to the PTY it was launched under, dropping
 * the alias when that PTY is gone. Pure so the routing is unit-testable.
 */
export function resolveSessionAlias(
  aliasMap: Map<string, string>,
  liveKeys: { has(key: string): boolean },
  sessionId: string,
): string | null {
  const key = aliasMap.get(sessionId);
  if (!key) {
    return null;
  }

  if (!liveKeys.has(key)) {
    aliasMap.delete(sessionId);
    return null;
  }

  return key;
}

export type BuildShellCommandOptions = {
  // Pre-assigned session id for a brand-new Claude session (claude --session-id).
  // Knowing the id at spawn time lets the server route later by-id opens back to
  // this PTY instead of forking a duplicate `claude --resume` (see #1004).
  newClaudeSessionId?: string | null;
};

/**
 * Resolves provider command line for plain shell and agent-backed shell modes.
 */
export function buildShellCommand(
  message: ShellIncomingMessage,
  dependencies: ShellWebSocketDependencies,
  options: BuildShellCommandOptions = {}
): string {
  const hasSession = readBoolean(message.hasSession);
  const initialCommand = readString(message.initialCommand);
  const provider = readString(message.provider, 'claude');
  const resumeSessionId = resolveResumeSessionId(message, dependencies);
  const isPlainShell =
    readBoolean(message.isPlainShell) ||
    (!!initialCommand && !hasSession) ||
    provider === 'plain-shell';

  if (isPlainShell) {
    return initialCommand;
  }

  if (provider === 'cursor') {
    if (resumeSessionId) {
      return `cursor-agent --resume="${resumeSessionId}"`;
    }
    return 'cursor-agent';
  }

  if (provider === 'codex') {
    if (resumeSessionId) {
      if (os.platform() === 'win32') {
        return `codex resume "${resumeSessionId}"; if ($LASTEXITCODE -ne 0) { codex }`;
      }
      return `codex resume "${resumeSessionId}" || codex`;
    }
    return 'codex';
  }

  if (provider === 'opencode') {
    if (resumeSessionId) {
      return `opencode --session "${resumeSessionId}"`;
    }
    return initialCommand || 'opencode';
  }

  if (resumeSessionId) {
    if (os.platform() === 'win32') {
      return `claude --resume "${resumeSessionId}"; if ($LASTEXITCODE -ne 0) { claude }`;
    }
    return `claude --resume "${resumeSessionId}" || claude`;
  }

  if (initialCommand) {
    return initialCommand;
  }

  if (options.newClaudeSessionId) {
    // Fall back to a plain launch on CLIs that predate --session-id, mirroring
    // the resume fallback above. On such CLIs the pre-assigned id never comes
    // into existence, so the registered alias can never be resolved by a
    // by-id open — it just ages out when the PTY exits.
    if (os.platform() === 'win32') {
      return `claude --session-id "${options.newClaudeSessionId}"; if ($LASTEXITCODE -ne 0) { claude }`;
    }
    return `claude --session-id "${options.newClaudeSessionId}" || claude`;
  }

  return 'claude';
}

function readEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const resolvedKey = Object.keys(env).find((envKey) => envKey.toLowerCase() === key.toLowerCase());
  return resolvedKey ? env[resolvedKey] : undefined;
}

function getPathEnvKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
}

function prioritizeUserNpmGlobalBin(env: NodeJS.ProcessEnv): { key: string; value: string | undefined } {
  const pathKey = getPathEnvKey(env);
  const currentPath = env[pathKey];
  if (!currentPath) {
    return { key: pathKey, value: currentPath };
  }

  const delimiter = path.delimiter;
  const pathEntries = currentPath.split(delimiter).filter(Boolean);
  const npmPrefix = readEnvValue(env, 'npm_config_prefix');
  const appData = readEnvValue(env, 'APPDATA');
  const candidates = [
    npmPrefix || '',
    npmPrefix ? path.join(npmPrefix, 'bin') : '',
    appData ? path.join(appData, 'npm') : '',
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm'),
    path.join(os.homedir(), '.npm-global', 'bin'),
  ].filter(Boolean);

  const normalizedPathEntries = pathEntries.map((entry) => os.platform() === 'win32' ? entry.toLowerCase() : entry);
  const preferredEntries = candidates.filter((candidate, index) => {
    const normalizedCandidate = os.platform() === 'win32' ? candidate.toLowerCase() : candidate;
    return (
      candidates.indexOf(candidate) === index &&
      normalizedPathEntries.includes(normalizedCandidate)
    );
  });

  if (preferredEntries.length === 0) {
    return { key: pathKey, value: currentPath };
  }

  const normalizedPreferredEntries = preferredEntries.map((entry) =>
    os.platform() === 'win32' ? entry.toLowerCase() : entry
  );

  const value = [
    ...preferredEntries,
    ...pathEntries.filter((entry) => {
      const normalizedEntry = os.platform() === 'win32' ? entry.toLowerCase() : entry;
      return !normalizedPreferredEntries.includes(normalizedEntry);
    }),
  ].join(delimiter);

  return { key: pathKey, value };
}

/**
 * Handles websocket connections used by the standalone shell terminal UI.
 */
export function handleShellConnection(
  ws: WebSocket,
  dependencies: ShellWebSocketDependencies
): void {
  console.log('[INFO] Shell websocket connected');

  let shellProcess: IPty | null = null;
  let ptySessionKey: string | null = null;
  let urlDetectionBuffer = '';
  const announcedAuthUrls = new Set<string>();

  // After another window takes over this PTY (init on the same key), this
  // socket must stop driving it — a detached client typing or resizing a
  // shared process is exactly the cross-talk described in #1004.
  const isAttachedSocket = (): boolean => {
    if (!ptySessionKey) {
      return false;
    }
    return ptySessionsMap.get(ptySessionKey)?.ws === ws;
  };

  ws.on('message', async (rawMessage) => {
    try {
      const data = parseShellMessage(rawMessage);
      if (!data?.type) {
        throw new Error('Invalid websocket payload');
      }

      if (data.type === 'init') {
        const projectPath = readString(data.projectPath, process.cwd());
        const sessionId = readString(data.sessionId) || null;
        const hasSession = readBoolean(data.hasSession);
        const provider = readString(data.provider, 'claude');
        const initialCommand = readString(data.initialCommand);
        const forceRestart = readBoolean(data.forceRestart);
        const isPlainShell =
          readBoolean(data.isPlainShell) ||
          (!!initialCommand && !hasSession) ||
          provider === 'plain-shell';

        urlDetectionBuffer = '';
        announcedAuthUrls.clear();

        const isLoginCommand =
          !!initialCommand &&
          (initialCommand.includes('setup-token') ||
            initialCommand.includes('cursor-agent login') ||
            initialCommand.includes('auth login'));

        const shellClientId = readString(data.shellClientId) || null;
        ptySessionKey = resolvePtySessionKey({
          projectPath,
          sessionId,
          shellClientId,
          isPlainShell,
          initialCommand,
        });

        // A conversation that started as a "new" shell lives under its client
        // identity key. When the UI later opens the same conversation by its
        // session id, follow the alias back to that PTY instead of spawning a
        // duplicate `claude --resume` alongside the still-running original.
        if (sessionId) {
          const aliasedKey = resolveSessionAlias(
            claudeSessionAliasMap,
            ptySessionsMap,
            sessionId,
          );
          if (aliasedKey) {
            ptySessionKey = aliasedKey;
          }
        }

        if (isLoginCommand || forceRestart) {
          const oldSession = ptySessionsMap.get(ptySessionKey);
          if (oldSession) {
            oldSession.pty.kill();
            deletePtySessionEntry(ptySessionKey, oldSession);
          }
          // The kill may have removed an alias-routed entry (and its alias).
          // Recompute the canonical key for this init so the restarted PTY is
          // registered where later by-id opens will look for it, instead of
          // stranding it under the previous tab's client-identity key.
          ptySessionKey = resolvePtySessionKey({
            projectPath,
            sessionId,
            shellClientId,
            isPlainShell,
            initialCommand,
          });
        }

        const existingSession =
          isLoginCommand || forceRestart ? null : ptySessionsMap.get(ptySessionKey);
        if (existingSession) {
          shellProcess = existingSession.pty;
          if (existingSession.timeoutId) {
            clearTimeout(existingSession.timeoutId);
          }

          ws.send(
            JSON.stringify({
              type: 'output',
              data: '\x1b[36m[Reconnected to existing session]\x1b[0m\r\n',
            })
          );

          if (existingSession.buffer.length > 0) {
            existingSession.buffer.forEach((bufferedData) => {
              ws.send(
                JSON.stringify({
                  type: 'output',
                  data: bufferedData,
                })
              );
            });
          }

          // Never steal a live client silently: tell it the PTY moved to
          // another window before rebinding the output stream, so it doesn't
          // keep rendering a shell it no longer owns.
          const previousWs = existingSession.ws;
          if (previousWs && previousWs !== ws && previousWs.readyState === WebSocket.OPEN) {
            try {
              previousWs.send(
                JSON.stringify({ type: 'session_detached', reason: 'attached_elsewhere' })
              );
              previousWs.send(
                JSON.stringify({
                  type: 'output',
                  data: '\r\n\x1b[33m[Detached: this shell was attached from another window]\x1b[0m\r\n',
                })
              );
            } catch {
              // The old socket may be mid-teardown; attaching proceeds regardless.
            }
          }

          existingSession.ws = ws;
          return;
        }

        const resolvedProjectPath = path.resolve(projectPath);
        try {
          const stats = fs.statSync(resolvedProjectPath);
          if (!stats.isDirectory()) {
            throw new Error('Not a directory');
          }
        } catch {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid project path' }));
          return;
        }

        const safeSessionIdPattern = /^[a-zA-Z0-9_.\-:]+$/;
        if (sessionId && !safeSessionIdPattern.test(sessionId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid session ID' }));
          return;
        }

        const resumeSessionId = resolveResumeSessionId(data, dependencies);
        // Launch brand-new Claude sessions with a pre-assigned session id so
        // the conversation's id is known from the start; the alias lets a later
        // by-id open reattach to this PTY instead of forking a duplicate.
        const isClaudeProvider =
          provider !== 'cursor' && provider !== 'codex' && provider !== 'opencode';
        const newClaudeSessionId =
          !isPlainShell && isClaudeProvider && !resumeSessionId && !initialCommand
            ? randomUUID()
            : null;
        const shellCommand = buildShellCommand(data, dependencies, { newClaudeSessionId });
        const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
        const shellArgs =
          os.platform() === 'win32' ? ['-Command', shellCommand] : ['-c', shellCommand];
        const termCols = readNumber(data.cols, 80);
        const termRows = readNumber(data.rows, 24);
        const prioritizedPath = prioritizeUserNpmGlobalBin(process.env);

        shellProcess = pty.spawn(shell, shellArgs, {
          name: 'xterm-256color',
          cols: termCols,
          rows: termRows,
          cwd: resolvedProjectPath,
          env: {
            ...process.env,
            [prioritizedPath.key]: prioritizedPath.value,
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            FORCE_COLOR: '3',
          },
        });

        ptySessionsMap.set(ptySessionKey, {
          pty: shellProcess,
          ws,
          buffer: [],
          timeoutId: null,
          projectPath,
          sessionId,
          assignedClaudeSessionId: newClaudeSessionId,
        });

        if (newClaudeSessionId) {
          claudeSessionAliasMap.set(newClaudeSessionId, ptySessionKey);
        }

        shellProcess.onData((chunk) => {
          if (!ptySessionKey) {
            return;
          }

          const session = ptySessionsMap.get(ptySessionKey);
          if (!session) {
            return;
          }

          if (session.buffer.length < 5000) {
            session.buffer.push(chunk);
          } else {
            session.buffer.shift();
            session.buffer.push(chunk);
          }

          if (session.ws && session.ws.readyState === WebSocket.OPEN) {
            let outputData = chunk;
            const cleanChunk = dependencies.stripAnsiSequences(chunk);
            urlDetectionBuffer = `${urlDetectionBuffer}${cleanChunk}`.slice(-SHELL_URL_PARSE_BUFFER_LIMIT);

            outputData = outputData.replace(
              /OPEN_URL:\s*(https?:\/\/[^\s\x1b\x07]+)/g,
              '[INFO] Opening in browser: $1'
            );

            const emitAuthUrl = (detectedUrl: string, autoOpen = false) => {
              const normalizedUrl = dependencies.normalizeDetectedUrl(detectedUrl);
              if (!normalizedUrl) {
                return;
              }

              const isNewUrl = !announcedAuthUrls.has(normalizedUrl);
              if (isNewUrl) {
                announcedAuthUrls.add(normalizedUrl);
                session.ws?.send(
                  JSON.stringify({
                    type: 'auth_url',
                    url: normalizedUrl,
                    autoOpen,
                  })
                );
              }
            };

            const normalizedDetectedUrls = dependencies.extractUrlsFromText(urlDetectionBuffer)
              .map((url) => dependencies.normalizeDetectedUrl(url))
              .filter((url): url is string => Boolean(url));

            const dedupedDetectedUrls = Array.from(new Set(normalizedDetectedUrls)).filter(
              (url, _, urls) =>
                !urls.some((otherUrl) => otherUrl !== url && otherUrl.startsWith(url))
            );

            dedupedDetectedUrls.forEach((url) => emitAuthUrl(url, false));

            if (
              dependencies.shouldAutoOpenUrlFromOutput(cleanChunk) &&
              dedupedDetectedUrls.length > 0
            ) {
              const bestUrl = dedupedDetectedUrls.reduce((longest, current) =>
                current.length > longest.length ? current : longest
              );
              emitAuthUrl(bestUrl, true);
            }

            session.ws.send(
              JSON.stringify({
                type: 'output',
                data: outputData,
              })
            );
          }
        });

        shellProcess.onExit((exitCode) => {
          if (!ptySessionKey) {
            return;
          }

          const session = ptySessionsMap.get(ptySessionKey);
          if (session && session.pty !== shellProcess) {
            return;
          }

          if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
            session.ws.send(
              JSON.stringify({
                type: 'output',
                data: `\r\n\x1b[33mProcess exited with code ${exitCode.exitCode}${
                  exitCode.signal != null ? ` (${exitCode.signal})` : ''
                }\x1b[0m\r\n`,
              })
            );
          }

          if (session) {
            deletePtySessionEntry(ptySessionKey, session);
          } else {
            ptySessionsMap.delete(ptySessionKey);
          }
          shellProcess = null;
        });

        let welcomeMsg = `\x1b[36mStarting terminal in: ${projectPath}\x1b[0m\r\n`;
        if (!isPlainShell) {
          const providerName =
            provider === 'cursor'
              ? 'Cursor'
              : provider === 'codex'
                ? 'Codex'
                : provider === 'opencode'
                    ? 'OpenCode'
                  : 'Claude';
          welcomeMsg = hasSession && resumeSessionId
            ? `\x1b[36mResuming ${providerName} session ${resumeSessionId} in: ${projectPath}\x1b[0m\r\n`
            : `\x1b[36mStarting new ${providerName} session in: ${projectPath}\x1b[0m\r\n`;
        }

        ws.send(
          JSON.stringify({
            type: 'output',
            data: welcomeMsg,
          })
        );
        return;
      }

      if (data.type === 'input') {
        if (shellProcess && isAttachedSocket()) {
          shellProcess.write(readString(data.data));
        }
        return;
      }

      if (data.type === 'resize') {
        if (shellProcess && isAttachedSocket()) {
          shellProcess.resize(readNumber(data.cols, 80), readNumber(data.rows, 24));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ERROR] Shell WebSocket error:', message);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'output',
            data: `\r\n\x1b[31mError: ${message}\x1b[0m\r\n`,
          })
        );
      }
    }
  });

  ws.on('close', () => {
    if (!ptySessionKey) {
      return;
    }

    const session = ptySessionsMap.get(ptySessionKey);
    if (!session) {
      return;
    }

    // A newer socket may own this PTY (explicit takeover). A stale close from
    // this socket must not detach the live client or arm a kill timer against
    // the PTY it is using.
    if (session.ws !== ws) {
      return;
    }

    session.ws = null;
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
    }
    session.timeoutId = setTimeout(() => {
      if (ptySessionsMap.get(ptySessionKey as string) !== session) {
        return;
      }

      session.pty.kill();
      deletePtySessionEntry(ptySessionKey as string, session);
    }, PTY_SESSION_TIMEOUT);
  });

  ws.on('error', (error) => {
    console.error('[ERROR] Shell WebSocket error:', error);
  });
}

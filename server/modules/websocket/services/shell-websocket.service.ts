import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import pty, { type IPty, type IWindowsPtyForkOptions } from 'node-pty';
import { WebSocket, type RawData } from 'ws';

import { parseIncomingJsonObject, stripAnsiSequences } from '@/shared/utils.js';

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
  bypassPermissions?: boolean;
  colorScheme?: string;
};

type ShellColorScheme = 'light' | 'dark';

type PtySessionEntry = {
  pty: IPty;
  ws: WebSocket | null;
  buffer: string[];
  timeoutId: NodeJS.Timeout | null;
  projectPath: string;
  sessionId: string | null;
  // The app theme a Claude CLI in this pty was launched for; null for any other
  // program. A running CLI keeps its launch-time colours, so a reattaching
  // client needs this, not its own current theme, to know if they differ.
  claudeColorScheme: ShellColorScheme | null;
};

const ptySessionsMap = new Map<string, PtySessionEntry>();
const PTY_SESSION_TIMEOUT = 30 * 60 * 1000;
const SHELL_URL_PARSE_BUFFER_LIMIT = 32768;
const TRAILING_URL_PUNCTUATION_REGEX = /[)\]}>.,;:!?]+$/;

function normalizeDetectedUrl(url: string): string | null {
  const cleanedUrl = url.trim().replace(TRAILING_URL_PUNCTUATION_REGEX, '');
  if (!cleanedUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(cleanedUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null;
    }
    return parsedUrl.toString();
  } catch {
    return null;
  }
}

function extractUrlsFromText(value: string): string[] {
  const directMatches = value.match(/https?:\/\/[^\s<>"'`\\\x1b\x07]+/gi) ?? [];

  // Terminal width can split a URL across lines, so valid URL characters on
  // immediately following lines are joined before the URL is validated.
  const wrappedMatches: string[] = [];
  const urlContinuationPattern = /^[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+$/;
  const lines = value.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].trim();
    const startMatch = line.match(/https?:\/\/[^\s<>"'`\\\x1b\x07]+/i);
    if (!startMatch) {
      continue;
    }

    let combinedUrl = startMatch[0];
    let continuationIndex = lineIndex + 1;
    while (continuationIndex < lines.length) {
      const continuation = lines[continuationIndex].trim();
      if (!continuation || !urlContinuationPattern.test(continuation)) {
        break;
      }
      combinedUrl += continuation;
      continuationIndex += 1;
    }

    wrappedMatches.push(combinedUrl);
  }

  return Array.from(new Set([...directMatches, ...wrappedMatches]));
}

/**
 * Tells the client which app theme the Claude CLI in its pty was launched for,
 * so the Shell can suggest a restart once the app theme no longer matches it.
 * Clients that predate this frame ignore unknown frame types.
 */
function sendClaudeColorScheme(ws: WebSocket, colorScheme: ShellColorScheme | null): void {
  if (colorScheme && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'claude_theme', colorScheme }));
  }
}

function shouldAutoOpenUrlFromOutput(value: string): boolean {
  const normalizedOutput = value.toLowerCase();
  return (
    normalizedOutput.includes("browser didn't open") ||
    normalizedOutput.includes('open this url') ||
    normalizedOutput.includes('continue in your browser') ||
    normalizedOutput.includes('press enter to open') ||
    normalizedOutput.includes('open_url:')
  );
}

// Terminal queries the Shell's xterm.js answers.
const TERMINAL_QUERY_REGEX = new RegExp(
  [
    // CSI: DSR and cursor position (also DECXCPR), DA1/DA2/DA3, XTVERSION,
    // DECRQM, kitty keyboard flags, the XTWINOPS size reports.
    /\x1b\[(?:\??\d*n|[>=]?0?c|>0?q|\??[\d;]*\$p|\?u|1[468]t)/.source,
    // OSC 4/10/11/12 colour and OSC 52 clipboard queries that set nothing.
    /\x1b\](?:4(?:;\d+;\?)+|1[0-2](?:;\?)+|52;[a-z0-9]*;\?)(?:\x07|\x1b\\)/.source,
    // DECRQSS.
    /\x1bP\$q[^\x1b]*\x1b\\/.source,
  ].join('|'),
  'g',
);

/**
 * The buffered output a reattaching client replays, as one string without the
 * terminal queries in it. Each one was answered when the program sent it; a new
 * terminal would answer it again, and that reply reaches the program as typed
 * input (OpenConsole turns a second DA1 reply into text and a cursor report
 * nobody waits for into an F3 key, #1665). Joined first because a query can be
 * split across chunks.
 */
function buildReplayOutput(buffer: string[]): string {
  return buffer.join('').replace(TERMINAL_QUERY_REGEX, '');
}

type ShellWebSocketDependencies = {
  resolveProviderSessionId: (
    sessionId: string,
    provider: string,
  ) => string | null | undefined;
  spawnPty?: typeof pty.spawn;
  // Where node-pty is installed (null: nowhere); defaults to the package this
  // server resolves. Only read on Windows, to find node-pty's bundled ConPTY.
  nodePtyRoot?: string | null;
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
 * Reads the app theme the Shell tab is painted in. Older clients send none and
 * anything unexpected is ignored, which keeps the launch exactly as before.
 */
function readColorScheme(value: unknown): ShellColorScheme | null {
  return value === 'light' || value === 'dark' ? value : null;
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

type ShellLaunch = {
  command: string;
  /**
   * Whether the command starts a Claude CLI that paints in the app's colour
   * scheme, so a later theme toggle can be applied by restarting it.
   */
  claudeFollowsAppTheme: boolean;
};

/**
 * Resolves provider command line for plain shell and agent-backed shell modes.
 */
function buildShellCommand(
  message: ShellIncomingMessage,
  dependencies: ShellWebSocketDependencies,
  projectPath: string
): ShellLaunch {
  const hasSession = readBoolean(message.hasSession);
  const initialCommand = readString(message.initialCommand);
  const provider = readString(message.provider, 'claude');
  const resumeSessionId = resolveResumeSessionId(message, dependencies);
  const isPlainShell =
    readBoolean(message.isPlainShell) ||
    (!!initialCommand && !hasSession) ||
    provider === 'plain-shell';

  const otherProgram = (command: string): ShellLaunch => ({ command, claudeFollowsAppTheme: false });

  if (isPlainShell) {
    return otherProgram(initialCommand);
  }

  if (provider === 'cursor') {
    if (resumeSessionId) {
      return otherProgram(`cursor-agent --resume="${resumeSessionId}"`);
    }
    return otherProgram('cursor-agent');
  }

  if (provider === 'codex') {
    if (resumeSessionId) {
      if (os.platform() === 'win32') {
        return otherProgram(`codex resume "${resumeSessionId}"; if ($LASTEXITCODE -ne 0) { codex }`);
      }
      return otherProgram(`codex resume "${resumeSessionId}" || codex`);
    }
    return otherProgram('codex');
  }

  if (provider === 'opencode') {
    if (resumeSessionId) {
      return otherProgram(`opencode --session "${resumeSessionId}"`);
    }
    return otherProgram(initialCommand || 'opencode');
  }

  // Launching with the flag is what unlocks "bypass permissions" in the CLI's
  // shift+tab permission-mode cycle; it cannot be enabled from inside a
  // session started without it.
  const bypassFlag = readBoolean(message.bypassPermissions)
    ? ' --dangerously-skip-permissions'
    : '';
  const theme = buildClaudeThemeLaunch(readColorScheme(message.colorScheme), projectPath);
  const launchFlags = `${bypassFlag}${theme.flag}`;
  if (resumeSessionId) {
    const command = os.platform() === 'win32'
      ? `claude --resume "${resumeSessionId}"${launchFlags}; if ($LASTEXITCODE -ne 0) { claude${launchFlags} }`
      : `claude --resume "${resumeSessionId}"${launchFlags} || claude${launchFlags}`;
    return { command, claudeFollowsAppTheme: theme.followsAppTheme };
  }
  if (initialCommand) {
    // A caller's own command (e.g. `claude /login`) is launched as given.
    return otherProgram(initialCommand);
  }
  return { command: `claude${launchFlags}`, claudeFollowsAppTheme: theme.followsAppTheme };
}

// Claude Code's built-in theme ids (the `/theme` picker of CLI 2.1.280). A
// `custom:<slug>` theme is valid too; any other value is ignored by the CLI.
const CLAUDE_THEME_IDS = new Set([
  'auto',
  'dark',
  'light',
  'dark-daltonized',
  'light-daltonized',
  'dark-ansi',
  'light-ansi',
]);

// Dark themes and their light counterparts. A light theme, `auto` (it asks the
// terminal for its background, which xterm answers from the live theme) or a
// custom theme is the user's own choice and is left alone.
const LIGHT_CLAUDE_THEME_BY_DARK_THEME = new Map([
  ['dark', 'light'],
  ['dark-daltonized', 'light-daltonized'],
  ['dark-ansi', 'light-ansi'],
]);

// The CLI refuses settings files over 2 MiB, so a bigger one holds no theme it
// would use. The legacy global config (`~/.claude.json`) is not a settings file
// and can grow to several MB; its cap is only there so a huge file is never
// pulled into the server's memory.
const MAX_CLAUDE_SETTINGS_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CLAUDE_GLOBAL_CONFIG_FILE_BYTES = 64 * 1024 * 1024;

/**
 * Reads a config file only when it is a regular, non-empty file of sane size,
 * else returns null. The project can be a cloned repository whose
 * `.claude/settings.local.json` is a symlink to a FIFO or to a device such as
 * /dev/zero: reading one would stall the server's event loop or exhaust its
 * memory. `statSync` follows the symlink without opening the target. Empty
 * files are skipped too: they hold no theme, and kernel pseudo-files (procfs,
 * tracefs) report a size of 0 even when a read would block.
 */
function readRegularConfigFile(filePath: string, maxBytes = MAX_CLAUDE_SETTINGS_FILE_BYTES): string | null {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size === 0 || stats.size > maxBytes) {
      return null;
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Reads the `theme` key of one Claude config file. A missing, unreadable,
 * special (FIFO, device) or unparsable file, or a value the CLI would reject,
 * counts as unset.
 */
function readClaudeThemeFile(filePath: string, maxBytes: number): string | null {
  const text = readRegularConfigFile(filePath, maxBytes);
  if (text === null) {
    return null;
  }
  try {
    const config: unknown = JSON.parse(text);
    const theme = config && typeof config === 'object' ? (config as Record<string, unknown>).theme : undefined;
    if (typeof theme !== 'string') {
      return null;
    }
    return CLAUDE_THEME_IDS.has(theme) || theme.startsWith('custom:') ? theme : null;
  } catch {
    return null;
  }
}

/**
 * Finds the theme Claude Code would start with in `projectPath`, read-only and
 * in the CLI's own order: local, project and user settings, then the legacy
 * global config key, then its "dark" default. Managed settings are not read:
 * they outrank `--settings`, so no flag could change their theme anyway.
 */
function resolveClaudeTheme(projectPath: string): string {
  const configDirOverride = process.env.CLAUDE_CONFIG_DIR;
  const configHome = configDirOverride || path.join(os.homedir(), '.claude');
  const legacyGlobalConfigPath = path.join(configHome, '.config.json');
  const configFiles: Array<[string, number]> = [
    [path.join(projectPath, '.claude', 'settings.local.json'), MAX_CLAUDE_SETTINGS_FILE_BYTES],
    [path.join(projectPath, '.claude', 'settings.json'), MAX_CLAUDE_SETTINGS_FILE_BYTES],
    [path.join(configHome, 'settings.json'), MAX_CLAUDE_SETTINGS_FILE_BYTES],
    [
      fs.existsSync(legacyGlobalConfigPath)
        ? legacyGlobalConfigPath
        : path.join(configDirOverride || os.homedir(), '.claude.json'),
      MAX_CLAUDE_GLOBAL_CONFIG_FILE_BYTES,
    ],
  ];

  for (const [filePath, maxBytes] of configFiles) {
    const theme = readClaudeThemeFile(filePath, maxBytes);
    if (theme) {
      return theme;
    }
  }
  return 'dark';
}

let hasLoggedThemeSettingsFileError = false;

/**
 * Returns a settings file that holds only `{"theme": theme}`, writing it when
 * it is missing or differs. It lives in the app's own data folder
 * (`~/.cloudcli`, like the chat assets); the user's Claude config is never
 * written. The write goes through a temp file and a rename, so a CLI starting
 * at the same time never reads half a file. Returns null, and logs once, when
 * the file cannot be written (a read-only home, say): the launch then simply
 * goes ahead without a theme.
 */
function ensureClaudeThemeSettingsFile(theme: string): string | null {
  const contents = `${JSON.stringify({ theme })}\n`;
  let tempPath: string | null = null;
  try {
    const filePath = path.join(os.homedir(), '.cloudcli', `claude-shell-theme-${theme}.json`);
    // Anything but the expected regular file is replaced; the rename never
    // opens what it replaces.
    if (readRegularConfigFile(filePath) !== contents) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      tempPath = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tempPath, contents);
      fs.renameSync(tempPath, filePath);
    }
    return filePath;
  } catch (error) {
    if (tempPath) {
      // Asynchronous and unchecked: cleaning up must not throw into the launch.
      fs.rm(tempPath, { force: true }, () => undefined);
    }
    if (!hasLoggedThemeSettingsFileError) {
      hasLoggedThemeSettingsFileError = true;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[WARN] Shell: cannot write the Claude theme settings file, launching without it: ${message}`);
    }
    return null;
  }
}

/**
 * Quotes one argument for the shell that runs the launch command. bash takes
 * everything between single quotes literally, so a `'` closes the quote, adds
 * an escaped one and reopens it. PowerShell (win32) single quotes are literal
 * too, backslashes included; a quote is doubled, and PowerShell also treats
 * the typographic single quotes as quote characters.
 */
function quoteShellArgument(value: string): string {
  if (os.platform() === 'win32') {
    return `'${value.replace(/['\u2018\u2019\u201A\u201B]/g, '$&$&')}'`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

type ClaudeThemeLaunch = {
  flag: string;
  /** Whether the CLI will paint in the app's colour scheme. */
  followsAppTheme: boolean;
};

/**
 * Claude Code paints its own colours in its own theme, dark by default, so in
 * a light Shell tab its prompt rows became dark bands. Only a light tab gets a
 * flag, and only when the user's theme is a dark one: it is swapped for the
 * matching light variant. `--settings` applies it to this launch only. It is
 * given a file path rather than inline JSON because PowerShell strips the
 * JSON's double quotes when it passes an argument to a native program.
 *
 * The CLI follows the app theme when it gets that flag, when a dark tab runs a
 * dark theme, and with `auto` (it asks the terminal, which xterm answers from
 * the live theme). A light or custom theme the user chose, or a flag that
 * could not be written, paints the same in either app theme, so restarting
 * after a toggle would change nothing.
 */
function buildClaudeThemeLaunch(colorScheme: ShellColorScheme | null, projectPath: string): ClaudeThemeLaunch {
  if (!colorScheme) {
    return { flag: '', followsAppTheme: false };
  }
  const userTheme = resolveClaudeTheme(projectPath);
  if (userTheme === 'auto') {
    return { flag: '', followsAppTheme: true };
  }
  const lightTheme = LIGHT_CLAUDE_THEME_BY_DARK_THEME.get(userTheme);
  if (!lightTheme) {
    return { flag: '', followsAppTheme: false };
  }
  if (colorScheme === 'dark') {
    return { flag: '', followsAppTheme: true };
  }
  const settingsPath = ensureClaudeThemeSettingsFile(lightTheme);
  return settingsPath
    ? { flag: ` --settings ${quoteShellArgument(settingsPath)}`, followsAppTheme: true }
    : { flag: '', followsAppTheme: false };
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

// Windows' own ConPTY host (conhost.exe) is only fixed with the OS. Older ones
// fail fast with 0xC0000409 ("stack-based buffer overrun") on a resize: Server
// 2022's while a typed command line is still being edited, Windows 10's also when
// the resize reflows partly overwritten wide (CJK) glyphs (#1665;
// microsoft/terminal#1856, #4907, #14600). node-pty ships a current conpty.dll +
// OpenConsole.exe; `useConptyDll` runs those instead, as VS Code has done by
// default since 1.121.
const CONPTY_DLL_ENV = 'CLOUDCLI_WINDOWS_USE_CONPTY_DLL';
const CONPTY_DLL_OFF_VALUES = new Set(['0', 'false', 'no', 'off']);

function resolveNodePtyRoot(): string | null {
  try {
    return path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
  } catch {
    return null;
  }
}

/**
 * Whether the conpty.dll + OpenConsole.exe pair sits next to the Windows addon
 * that node-pty will actually load. node-pty takes the first `conpty.node` of
 * `build/Release`, `build/Debug` and `prebuilds/win32-<arch>` (each beside and
 * inside `lib/`) and looks for `conpty/conpty.dll` in that folder. A source
 * rebuild (electron-rebuild) leaves `build/Release/conpty.node` without that
 * folder, and asking for the DLL there would make every spawn throw.
 */
function hasBundledConpty(nodePtyRoot: string): boolean {
  const addonDir = ['build/Release', 'build/Debug', `prebuilds/win32-${process.arch}`]
    .flatMap((dir) => [path.join(nodePtyRoot, dir), path.join(nodePtyRoot, 'lib', dir)])
    .find((dir) => fs.existsSync(path.join(dir, 'conpty.node')));
  return Boolean(addonDir) &&
    ['conpty.dll', 'OpenConsole.exe'].every((file) => fs.existsSync(path.join(addonDir as string, 'conpty', file)));
}

/**
 * On Windows, asks node-pty for its bundled ConPTY when it is installed, unless
 * CLOUDCLI_WINDOWS_USE_CONPTY_DLL is set to 0/false/no/off. Other platforms get
 * no option at all. `nodePtyRoot` undefined means "the node-pty this server
 * resolves"; null means none was found.
 */
function resolveConptyDllOption(nodePtyRoot: string | null | undefined): Pick<IWindowsPtyForkOptions, 'useConptyDll'> {
  if (os.platform() !== 'win32') {
    return {};
  }
  const setting = process.env[CONPTY_DLL_ENV]?.trim().toLowerCase();
  if (setting && CONPTY_DLL_OFF_VALUES.has(setting)) {
    return {};
  }
  const root = nodePtyRoot === undefined ? resolveNodePtyRoot() : nodePtyRoot;
  return root && hasBundledConpty(root) ? { useConptyDll: true } : {};
}

/**
 * Spawns the shell, retrying with Windows' own ConPTY when the bundled one
 * cannot start (a conpty.dll blocked by policy or quarantined by antivirus must
 * not take the Shell tab down).
 */
function spawnShellPty(
  spawnPty: typeof pty.spawn,
  file: string,
  args: string[],
  options: IWindowsPtyForkOptions,
): IPty {
  if (!options.useConptyDll) {
    return spawnPty(file, args, options);
  }
  try {
    return spawnPty(file, args, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[WARN] Bundled ConPTY failed to start (${message}); using the Windows ConPTY instead`);
    const { useConptyDll: _useConptyDll, ...windowsConptyOptions } = options;
    return spawnPty(file, args, windowsConptyOptions);
  }
}

// The part of node-pty's Windows terminal (private, not in its typings) that
// holds the console host's input pipe.
type NodePtyWindowsInternals = {
  _agent?: { inSocket?: { on?: (event: 'error', listener: (error: Error) => void) => unknown } };
};

/**
 * node-pty writes Windows input into the console host's input pipe without an
 * 'error' listener (microsoft/node-pty#942, #976). Input that arrives after the
 * host closed the pipe, but before node-pty reports the exit, fails with EAGAIN
 * or EPIPE, and the unhandled 'error' event would end the whole server. The
 * bundled ConPTY exits together with its shell, so one key pressed while a shell
 * exits was enough (#1665). The listener only logs the first error; the exit is
 * still reported through onExit. node-pty may move its internals, so every step
 * is guarded: another layout only means no listener.
 */
function handleWindowsInputPipeErrors(shellProcess: IPty): void {
  if (os.platform() !== 'win32') {
    return;
  }
  try {
    const inSocket = (shellProcess as unknown as NodePtyWindowsInternals)._agent?.inSocket;
    if (typeof inSocket?.on !== 'function') {
      return;
    }
    let reported = false;
    inSocket.on('error', (error) => {
      if (!reported) {
        reported = true;
        console.warn(`[WARN] Shell input could not reach the console host (${error.message}); dropping it`);
      }
    });
  } catch {
    // A getter of another node-pty version threw; the shell runs without the listener.
  }
}

/**
 * Used by this module's websocket gateway to connect the standalone Shell UI
 * to a retained PTY while keeping process lifecycle ownership on the server.
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
        const colorScheme = readColorScheme(data.colorScheme);
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

        const commandSuffix =
          isPlainShell && initialCommand
            ? `_cmd_${Buffer.from(initialCommand).toString('base64').slice(0, 16)}`
            : '';
        ptySessionKey = `${projectPath}_${sessionId ?? 'default'}${commandSuffix}`;

        if (isLoginCommand || forceRestart) {
          const oldSession = ptySessionsMap.get(ptySessionKey);
          if (oldSession) {
            if (oldSession.timeoutId) {
              clearTimeout(oldSession.timeoutId);
            }
            oldSession.pty.kill();
            ptySessionsMap.delete(ptySessionKey);
          }
        }

        const existingSession =
          isLoginCommand || forceRestart ? null : ptySessionsMap.get(ptySessionKey);
        if (existingSession) {
          shellProcess = existingSession.pty;
          if (existingSession.timeoutId) {
            clearTimeout(existingSession.timeoutId);
            existingSession.timeoutId = null;
          }

          ws.send(
            JSON.stringify({
              type: 'output',
              data: '\x1b[36m[Reconnected to existing session]\x1b[0m\r\n',
            })
          );

          const replay = buildReplayOutput(existingSession.buffer);
          if (replay) {
            ws.send(
              JSON.stringify({
                type: 'output',
                data: replay,
              })
            );
          }

          existingSession.ws = ws;
          sendClaudeColorScheme(ws, existingSession.claudeColorScheme);
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

        const { command: shellCommand, claudeFollowsAppTheme } = buildShellCommand(
          data,
          dependencies,
          resolvedProjectPath,
        );
        const resumeSessionId = resolveResumeSessionId(data, dependencies);
        const claudeColorScheme = claudeFollowsAppTheme ? colorScheme : null;
        const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
        const shellArgs =
          os.platform() === 'win32' ? ['-Command', shellCommand] : ['-c', shellCommand];
        const termCols = readNumber(data.cols, 80);
        const termRows = readNumber(data.rows, 24);
        const prioritizedPath = prioritizeUserNpmGlobalBin(process.env);

        shellProcess = spawnShellPty(dependencies.spawnPty ?? pty.spawn, shell, shellArgs, {
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
            // rxvt's "foreground;background" palette indices (15 = white, 0 = black).
            // Programs that cannot query the terminal (vim, Claude Code's "auto"
            // theme before its OSC 11 reply arrives) read it to pick light or dark.
            ...(colorScheme ? { COLORFGBG: colorScheme === 'light' ? '0;15' : '15;0' } : {}),
          },
          ...resolveConptyDllOption(dependencies.nodePtyRoot),
        });
        handleWindowsInputPipeErrors(shellProcess);

        ptySessionsMap.set(ptySessionKey, {
          pty: shellProcess,
          ws,
          buffer: [],
          timeoutId: null,
          projectPath,
          sessionId,
          claudeColorScheme,
        });

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
            const cleanChunk = stripAnsiSequences(chunk);
            urlDetectionBuffer = `${urlDetectionBuffer}${cleanChunk}`.slice(-SHELL_URL_PARSE_BUFFER_LIMIT);

            outputData = outputData.replace(
              /OPEN_URL:\s*(https?:\/\/[^\s\x1b\x07]+)/g,
              '[INFO] Opening in browser: $1'
            );

            const emitAuthUrl = (detectedUrl: string, autoOpen = false) => {
              const normalizedUrl = normalizeDetectedUrl(detectedUrl);
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

            const normalizedDetectedUrls = extractUrlsFromText(urlDetectionBuffer)
              .map((url) => normalizeDetectedUrl(url))
              .filter((url): url is string => Boolean(url));

            const dedupedDetectedUrls = Array.from(new Set(normalizedDetectedUrls)).filter(
              (url, _, urls) =>
                !urls.some((otherUrl) => otherUrl !== url && otherUrl.startsWith(url))
            );

            dedupedDetectedUrls.forEach((url) => emitAuthUrl(url, false));

            if (
              shouldAutoOpenUrlFromOutput(cleanChunk) &&
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

          if (session?.timeoutId) {
            clearTimeout(session.timeoutId);
          }

          ptySessionsMap.delete(ptySessionKey);
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
        sendClaudeColorScheme(ws, claudeColorScheme);
        return;
      }

      if (data.type === 'input') {
        if (shellProcess) {
          shellProcess.write(readString(data.data));
        }
        return;
      }

      if (data.type === 'resize') {
        if (shellProcess) {
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

    // Mobile networks can deliver an old socket's close after its replacement
    // has attached. Only the socket that currently owns the PTY may detach it.
    if (session.ws !== ws) {
      return;
    }

    session.ws = null;
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
    }
    session.timeoutId = setTimeout(() => {
      // A reconnect may win just as this timer becomes runnable. Re-check the
      // active socket so a queued cleanup can never kill a reattached PTY.
      if (ptySessionsMap.get(ptySessionKey as string) !== session || session.ws !== null) {
        return;
      }

      session.pty.kill();
      ptySessionsMap.delete(ptySessionKey as string);
    }, PTY_SESSION_TIMEOUT);
  });

  ws.on('error', (error) => {
    console.error('[ERROR] Shell WebSocket error:', error);
  });
}

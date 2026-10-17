/**
 * CLI-native slash commands: executed by the provider CLI itself, never by
 * this server. They are advertised so a client can list and complete them,
 * but they are deliberately NOT registered for the command palette's execute
 * endpoint: that endpoint stuffs a resolved command's content back into the
 * composer for resubmission, and a native command like `/compact` would come
 * back as text and resubmit itself, forever.
 *
 * Two sources feed the list, in order of preference:
 *
 * 1. Runtime capture. The Claude Agent SDK hands the full command catalogue
 *    to every client during the session's initialize handshake — it is how
 *    the CLI's own TUI and the VS Code extension build their `/` menus — and
 *    pushes a fresh one on `system/commands_changed` when skills or plugins
 *    change mid-session. The runtime records what it receives here, so the
 *    list always matches the installed CLI, plugins and skills of that
 *    machine. A static table can never do this: the real catalogue differs
 *    per machine and drifts with every CLI release.
 *
 * 2. Static fallback. The other CLIs document their commands but expose no
 *    enumeration (Codex's app-server protocol has `skills/list` for custom
 *    skills but nothing for built-ins; Cursor and OpenCode have neither).
 *    Their tables below are maintained by hand and marked with the source
 *    they were read from.
 */
export type NativeSlashCommand = {
  name: string;
  description: string;
  argumentHint?: string;
};

export type NativeCommandProvider = 'claude' | 'codex' | 'cursor' | 'opencode';

const STATIC_NATIVE_COMMANDS: Record<NativeCommandProvider, NativeSlashCommand[]> = {
  // Fallback only, used until a live session reports the real catalogue.
  // Entries are the built-ins observed across Claude Code versions; the
  // dynamic capture replaces this wholesale the moment a session initializes.
  claude: [
    { name: '/clear', description: 'Start a new session with empty context; the previous one stays resumable' },
    { name: '/compact', description: 'Free up context by summarizing the conversation so far' },
    { name: '/context', description: 'Show current context usage' },
    { name: '/init', description: 'Generate a CLAUDE.md guide for the project' },
    { name: '/review', description: 'Review a pull request' },
    { name: '/security-review', description: 'Complete a security review of the pending changes on the current branch' },
    { name: '/usage', description: 'Show the total cost and duration of the current session' },
  ],

  // From the Codex CLI documentation (developers.openai.com/codex, "Slash
  // commands"), 2026-09. Interactive/UI-only helpers (/vim, /theme, /copy...)
  // are omitted: they act on a terminal the web client does not have.
  codex: [
    { name: '/new', description: 'Start a new conversation within the same CLI session' },
    { name: '/clear', description: 'Clear the terminal and start a new conversation' },
    { name: '/compact', description: 'Summarize the current conversation to free tokens' },
    { name: '/resume', description: 'Resume a saved conversation from the session list' },
    { name: '/fork', description: 'Fork the current conversation into a new thread' },
    { name: '/model', description: 'Select the active model and reasoning effort', argumentHint: '[model]' },
    { name: '/plan', description: 'Switch to plan mode, optionally with an inline prompt' },
    { name: '/goal', description: 'Set, pause, resume, view or clear the task goal' },
    { name: '/status', description: 'Show session configuration and token usage' },
    { name: '/permissions', description: 'Configure what Codex may do without asking for approval' },
    { name: '/approve', description: 'Approve retrying an action the last auto-review declined' },
    { name: '/diff', description: 'Show the Git diff, including untracked files' },
    { name: '/mention', description: 'Attach a file or folder to the conversation', argumentHint: '<path>' },
    { name: '/init', description: 'Generate an AGENTS.md scaffold for the current directory' },
    { name: '/review', description: 'Ask Codex to review your workspace' },
    { name: '/mcp', description: 'List configured MCP tools (`verbose` for details)' },
    { name: '/apps', description: 'Browse apps (connectors) and insert them as prompts' },
    { name: '/skills', description: 'Browse and apply skills' },
    { name: '/hooks', description: 'View and manage lifecycle hooks' },
    { name: '/memories', description: 'Configure the use and generation of memories' },
    { name: '/ps', description: 'Show experimental background terminals and their recent output' },
    { name: '/stop', description: 'Stop all background terminals' },
    { name: '/feedback', description: 'Send logs to the Codex maintainers' },
  ],

  // Best effort: Cursor CLI documents no programmatic enumeration and its
  // docs site lists no stable command catalogue. Keep the well-known core
  // only; `.cursor/commands` customs are listed separately from disk.
  cursor: [
    { name: '/init', description: 'Generate project context for the current directory' },
    { name: '/model', description: 'Switch the active model' },
    { name: '/review', description: 'Review the current changes' },
    { name: '/status', description: 'Show session status' },
  ],

  // The built-ins named by the OpenCode documentation (opencode.ai/docs/
  // commands). OpenCode custom commands from `.opencode/commands/` are
  // listed separately from disk, like the other providers.
  opencode: [
    { name: '/init', description: 'Initialize the project (generate AGENTS.md)' },
    { name: '/undo', description: 'Undo the last change' },
    { name: '/redo', description: 'Redo an undone change' },
    { name: '/share', description: 'Share the current session' },
    { name: '/help', description: 'Show help' },
  ],
};

// Keyed by provider AND the workspace the session ran in: project-scoped
// skills and plugins make the catalogue workspace-specific, so workspace A's
// list must never be served to workspace B. The lookup is exact-match; a
// workspace that has no capture of its own gets the static fallback. An
// existing entry — even an empty one — wins over the fallback: it is what the
// CLI last reported for that workspace.
const dynamicCommands = new Map<string, NativeSlashCommand[]>();

// One generation per capture attempt. Two sessions in the same workspace run
// concurrently, and the SDK does not order initializationResult() against
// stream messages — a generation check is what keeps an older query's late
// initialization from restoring stale commands over a newer capture.
const captureGenerations = new Map<string, number>();

const cacheKey = (provider: string, workspacePath?: string): string =>
  `${provider}::${workspacePath ?? ''}`;

const normalizeCommands = (commands: NativeSlashCommand[]): NativeSlashCommand[] =>
  commands
    .filter((command) => typeof command?.name === 'string' && command.name.length > 0)
    .map((command) => ({
      name: command.name.startsWith('/') ? command.name : `/${command.name}`,
      description: typeof command.description === 'string' ? command.description : '',
      ...(typeof command.argumentHint === 'string' && command.argumentHint.length > 0
        ? { argumentHint: command.argumentHint }
        : {}),
    }));

/**
 * Begins a capture attempt for one live session and returns its recorder.
 * Called by the runtime when a query starts; the recorder handles the
 * initialize handshake and every `commands_changed` push, which the protocol
 * documents as a full replacement — clients must not merge it. An empty
 * catalogue is recorded as such: the CLI said there are none. Writes from a
 * superseded attempt are dropped.
 */
export function beginNativeCommandsCapture(
  provider: NativeCommandProvider,
  workspacePath?: string,
): (commands: NativeSlashCommand[]) => void {
  const key = cacheKey(provider, workspacePath);
  const generation = (captureGenerations.get(key) ?? 0) + 1;
  captureGenerations.set(key, generation);

  return (commands: NativeSlashCommand[]) => {
    if (!Array.isArray(commands) || captureGenerations.get(key) !== generation) {
      return;
    }

    dynamicCommands.set(key, normalizeCommands(commands));
  };
}

/**
 * The native commands to advertise for one provider: the capture from a live
 * session in this workspace if one has reported — even when it reported an
 * empty catalogue — the static fallback otherwise.
 */
export function getNativeCommands(provider: string, workspacePath?: string): NativeSlashCommand[] {
  const dynamic = dynamicCommands.get(cacheKey(provider, workspacePath));
  if (dynamic) {
    return dynamic;
  }

  const fallback = STATIC_NATIVE_COMMANDS[provider as NativeCommandProvider];
  return fallback ? fallback.map((command) => ({ ...command })) : [];
}

/** Clears the runtime capture. Test seam only. */
export function clearNativeCommandsCache(): void {
  dynamicCommands.clear();
  captureGenerations.clear();
}

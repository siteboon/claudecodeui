/**
 * Maps the UI permission settings onto qodercli's non-interactive controls
 * (verified against qodercli v1.1.13).
 *
 * Consumed by the qoder runtime (`qoder-runtime.provider.js`) when spawning
 * qodercli for a chat run, and by `tests/qoder-permissions.test.ts`.
 */

/**
 * Permission settings persisted by the Settings > Qoder > Permissions panel
 * under the `qoder-settings` localStorage key, and forwarded by the chat
 * composer as `toolsSettings` on every send.
 */
export type QoderToolsSettings = {
  skipPermissions?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  restrictedTools?: string[];
};

/** CLI arguments and env additions to apply to the spawned qodercli process. */
export type QoderPermissionOptions = {
  args: string[];
  env: Record<string, string>;
  /**
   * Set once `--tools` is emitted. qodercli declares it variadic
   * (`--tools <tools...>`), so it keeps consuming bare arguments and swallows
   * the trailing prompt; the caller must emit `--` before the prompt.
   */
  requiresPromptSeparator: boolean;
};

/**
 * Maps the UI permission mode plus the persisted tools settings onto
 * qodercli's non-interactive controls:
 * - skipPermissions or `bypassPermissions` → `--permission-mode
 *   bypass_permissions`, auto-approving every permission prompt. Without it,
 *   a non-interactive run that hits a prompt fails with "Permission
 *   confirmation required but no interactive handler is available."
 * - `acceptEdits` → `--permission-mode accept_edits`, auto-accepting file
 *   edits while still prompting for other tools.
 * - `default` (and anything else, e.g. an unsupported plan mode) → no mode
 *   flag; qoder's own settings.json governs.
 * - allowedTools / disallowedTools map 1:1 onto repeated `--allowed-tools` /
 *   `--disallowed-tools` flags. Both are approval hints rather than a sandbox:
 *   an allow entry only skips the confirmation prompt and never narrows the
 *   tool set, and qodercli 1.1.13 does not enforce the `Bash(cmd:*)`
 *   sub-command scope, so only bare tool names behave predictably.
 * - restrictedTools maps onto the variadic `--tools`, the only flag that
 *   actually removes tools from the session. Emitting it forces the caller to
 *   separate the prompt with `--`.
 */
export function resolveQoderPermissionOptions(
  permissionMode?: string | null,
  toolsSettings?: QoderToolsSettings | null,
): QoderPermissionOptions {
  const args: string[] = [];

  if (toolsSettings?.skipPermissions || permissionMode === 'bypassPermissions') {
    args.push('--permission-mode', 'bypass_permissions');
  } else if (permissionMode === 'acceptEdits') {
    args.push('--permission-mode', 'accept_edits');
  }

  for (const tool of toolsSettings?.allowedTools ?? []) {
    if (tool.trim()) {
      args.push('--allowed-tools', tool);
    }
  }

  for (const tool of toolsSettings?.disallowedTools ?? []) {
    if (tool.trim()) {
      args.push('--disallowed-tools', tool);
    }
  }

  // `--tools` takes all of its values as one variadic list, so it has to come
  // last in this arg block and be followed by `--` before the prompt.
  const restrictedTools = (toolsSettings?.restrictedTools ?? []).filter((tool) => tool.trim());
  if (restrictedTools.length > 0) {
    args.push('--tools', ...restrictedTools);
  }

  return { args, env: {}, requiresPromptSeparator: restrictedTools.length > 0 };
}

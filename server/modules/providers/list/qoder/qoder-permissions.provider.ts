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
};

/** CLI arguments and env additions to apply to the spawned qodercli process. */
export type QoderPermissionOptions = {
  args: string[];
  env: Record<string, string>;
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
 *   `--disallowed-tools` flags.
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

  return { args, env: {} };
}

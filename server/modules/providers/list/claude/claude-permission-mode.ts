import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';


/**
 * Decides which `permissionMode` reaches the Claude Agent SDK.
 *
 * The distinction that matters is *explicitly requested* vs *omitted*, not which
 * mode was named:
 *
 * - An explicit mode is forwarded verbatim, including `'default'`. Forwarding
 *   `'default'` is what keeps a caller's choice authoritative: when it is
 *   omitted instead, the SDK falls back to the user's own `defaultMode` in their
 *   Claude Code settings, which can silently replace the structural approval
 *   flow the caller asked for.
 * - An omitted mode preserves the existing Web-session behaviour, where the
 *   global `skipPermissions` setting decides.
 */
export function resolveClaudePermissionMode(
  requestedMode: string | undefined,
  skipPermissions: boolean,
): PermissionMode | undefined {
  if (requestedMode !== undefined) {
    return requestedMode as PermissionMode;
  }
  return skipPermissions ? 'bypassPermissions' : undefined;
}

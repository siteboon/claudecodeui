import type { ToolStatus } from '../components/ToolStatusBadge';

/** Tools that modify files and should show lifecycle badges. */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'ApplyPatch', 'MultiEdit']);

export type DiffLifecycleState = 'pending' | 'applied' | 'reverted' | 'failed';

/**
 * Derive the diff lifecycle status for a file-modifying tool.
 *
 * Returns `null` for non-edit tools (caller should fall back to normal status).
 *
 * @param toolName  The canonical tool name (e.g. "Edit")
 * @param toolResult  The tool result object, or null if still pending
 * @param overrideState  Optional manual override (e.g. user clicked "Revert")
 */
export function deriveDiffLifecycleStatus(
  toolName: string,
  toolResult: { isError?: boolean; content?: unknown } | null | undefined,
  overrideState?: DiffLifecycleState,
): ToolStatus | null {
  if (!EDIT_TOOLS.has(toolName)) {
    return null;
  }

  // Manual override (e.g. reverted by user)
  if (overrideState) {
    return overrideState;
  }

  // No result yet → pending (waiting for approval or execution)
  if (!toolResult) {
    return 'pending';
  }

  // Error in result
  if (toolResult.isError) {
    return 'failed';
  }

  // Successful completion
  return 'applied';
}

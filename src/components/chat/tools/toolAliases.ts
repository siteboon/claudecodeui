/**
 * Canonical tool names.
 *
 * Claude Code renames tools occasionally, and every rename silently degrades
 * this UI: a tool with no config falls through to `Default`, which titles the
 * block "Parameters" and dumps the whole input as JSON. For most tools that is
 * merely ugly. For the subagent tool it is a wall of text — the entire prompt
 * sent to the subagent, rendered inline — which is what made spawning an agent
 * look like a huge message the user had typed themselves.
 *
 * The subagent tool was `Task` and is now `Agent`. Six separate places keyed
 * off the literal 'Task' (config lookup, subagent-container detection, icon
 * category, the container's own switch), so the rename broke all six
 * independently and each would have needed spotting on its own.
 *
 * Hence one map, applied at every name-based decision, rather than an
 * `|| 'Agent'` sprinkled per site: the next rename is a one-line change here
 * instead of another scavenger hunt.
 */
const TOOL_NAME_ALIASES: Record<string, string> = {
  // Subagent spawning. Keep BOTH directions working: a transcript recorded
  // before the rename still says 'Task', and one recorded after says 'Agent'.
  Agent: 'Task',
};

/**
 * Resolves a tool name to the one this UI has config and behaviour for.
 * Unknown names pass through untouched.
 */
export function canonicalToolName(toolName: string | null | undefined): string {
  if (!toolName) return '';
  return TOOL_NAME_ALIASES[toolName] ?? toolName;
}

/** True when this tool spawns a subagent, under any of its historical names. */
export function isSubagentTool(toolName: string | null | undefined): boolean {
  return canonicalToolName(toolName) === 'Task';
}

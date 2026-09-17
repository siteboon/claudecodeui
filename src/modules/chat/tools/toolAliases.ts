/**
 * Tool names that have changed, and the one place that knows about it.
 *
 * Claude Code renamed its subagent tool from `Task` to `Agent`. Both names are
 * live: `Agent` is what arrives now, `Task` is what every transcript written
 * before the rename still holds, and those transcripts are read forever.
 *
 * The reason this is a shared map rather than an `|| 'Agent'` at each call site
 * is the failure mode. A name-keyed decision that misses does not throw and does
 * not log — the row silently loses its container, its colour, or its place in a
 * lifecycle rule. Nothing fails loudly enough to notice, and each site regresses
 * on its own. Two of ours had already drifted apart by the time anyone looked.
 *
 * The next rename should be one line here.
 */

/** Every name the subagent-spawning tool has been known by, newest first. */
export const SUBAGENT_TOOL_NAMES = ['Agent', 'Task'] as const;

/** The name to prefer when writing something new. */
export const CANONICAL_SUBAGENT_TOOL = SUBAGENT_TOOL_NAMES[0];

const SUBAGENT_TOOL_NAME_SET: ReadonlySet<string> = new Set(SUBAGENT_TOOL_NAMES);

/**
 * Whether a tool name spawns a subagent, under any name it has ever had.
 *
 * @param toolName - Tool name as it arrived, from any provider or any vintage of transcript
 */
export function isSubagentToolName(toolName: string | undefined | null): boolean {
  return Boolean(toolName) && SUBAGENT_TOOL_NAME_SET.has(toolName as string);
}

import type { Plugin } from '@/shared/types';

/** True when a manifest pattern (an exact tool name, or a prefix ending in `*`) covers `toolName`. */
export function toolPatternMatches(pattern: string, toolName: string): boolean {
  return pattern.endsWith('*') ? toolName.startsWith(pattern.slice(0, -1)) : pattern === toolName;
}

/** The first enabled plugin that renders `toolName`, in the host's plugin order. */
export function findToolRendererPlugin(plugins: Plugin[], toolName: string): Plugin | null {
  return plugins.find((plugin) => plugin.enabled
    && (plugin.toolRenderers ?? []).some((pattern) => toolPatternMatches(pattern, toolName))) ?? null;
}

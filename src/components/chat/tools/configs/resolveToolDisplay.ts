import type { ToolDisplayDensity } from '../../../../hooks/useToolDisplayPreferences';
import type { ToolDisplayConfig } from './toolConfigs';
import { getToolConfig } from './toolConfigs';

/**
 * Resolve the effective display config for a tool given a density preference.
 *
 * - `compact`  → forces `type: 'one-line'`, collapses results
 * - `standard` → uses the base config as-is (current default behaviour)
 * - `expanded` → forces `defaultOpen: true`, shows normally-hidden results
 */
export function resolveToolDisplay(
  toolName: string,
  density: ToolDisplayDensity,
): ToolDisplayConfig {
  const base = getToolConfig(toolName);

  if (density === 'standard') {
    return base;
  }

  // Deep-clone the config so we don't mutate the registry
  const config: ToolDisplayConfig = {
    input: { ...base.input },
    result: base.result ? { ...base.result } : undefined,
  };

  if (density === 'compact') {
    // Force everything to one-line display (unless it's a plan or hidden)
    if (config.input.type !== 'plan' && config.input.type !== 'hidden') {
      config.input = { ...config.input, type: 'one-line' };
    }
    // Collapse/hide results
    if (config.result) {
      config.result = { ...config.result, defaultOpen: false };
    }
  }

  if (density === 'expanded') {
    // Force collapsible sections to be open by default
    if (config.input.type === 'collapsible') {
      config.input = { ...config.input, defaultOpen: true };
    }
    // Show normally-hidden results
    if (config.result) {
      config.result = {
        ...config.result,
        defaultOpen: true,
        hidden: false,
        hideOnSuccess: false,
      };
    }
  }

  return config;
}

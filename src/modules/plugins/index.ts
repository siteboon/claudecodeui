export { PluginsProvider, useOptionalPlugins, usePlugins } from '@/modules/plugins/context/PluginsContext';
export { default as PluginIcon } from '@/modules/plugins/PluginIcon';
export { default as PluginSettingsTab } from '@/modules/plugins/PluginSettingsTab';
export { default as PluginTabContent } from '@/modules/plugins/PluginTabContent';
// PluginToolRenderer + findToolRendererPlugin: used by chat's ToolRenderer so plugins can draw the rows of the tools they list in `toolRenderers`.
export { default as PluginToolRenderer } from '@/modules/plugins/tool-renderers/PluginToolRenderer';
export { findToolRendererPlugin } from '@/modules/plugins/tool-renderers/matchToolRenderer';

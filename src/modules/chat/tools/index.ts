// Only the symbols other chat files import. A module has one barrel — its own
// index.ts — and this directory's used to re-export ToolRenderer while
// ToolRenderer imported its siblings back from here, which was a real cycle.
export { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
export { ToolErrorDisplay } from '@/modules/chat/tools/ToolErrorDisplay';
export { getToolConfig, shouldHideToolResult } from '@/modules/chat/tools/configs/toolConfigs';

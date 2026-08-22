// Only the symbols other chat files import.
//
// This is an intra-module barrel, not the chat module's public one — that is
// src/modules/chat/index.ts, and nothing outside chat imports through here. It
// exists because tools/ is deep and its callers are spread across transcript/
// and composer/. It used to re-export ToolRenderer while ToolRenderer imported
// its siblings back from here, which was a real cycle; it now exports leaves
// only, and the ContentRenderers/ and InteractiveRenderers/ barrels that made
// the cycle possible are gone.
export { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
export { SubagentPanel } from '@/modules/chat/tools/SubagentPanel';
export { ToolErrorDisplay } from '@/modules/chat/tools/ToolErrorDisplay';
export { getToolConfig, shouldHideToolResult } from '@/modules/chat/tools/configs/toolConfigs';

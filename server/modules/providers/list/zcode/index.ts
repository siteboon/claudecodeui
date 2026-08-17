/**
 * ZCode provider module barrel exports.
 *
 * Consumers: the provider registry imports `ZCodeProvider` (via the same
 * direct-file pattern as the claude/codex providers), and `server/index.ts`
 * imports `shutdownZCodeRuntime` through the providers module barrel for the
 * server shutdown flow. Internal facets and the protocol client stay private.
 */

export { ZCodeProvider, shutdownZCodeRuntime } from './zcode.provider.js';

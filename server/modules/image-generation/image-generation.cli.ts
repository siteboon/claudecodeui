#!/usr/bin/env node

// Stdio is a protocol channel: do not load the web/CLI environment bootstrap,
// which may print banners. MCP client configuration supplies the environment.
import { runImageGenerationMcp } from './image-generation.mcp.js';
import { ImageGenerationError } from './image-generation.error.js';

runImageGenerationMcp(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof ImageGenerationError ? error.message : 'Image MCP startup failed. Check project/data-directory configuration.');
  process.exitCode = 1;
});

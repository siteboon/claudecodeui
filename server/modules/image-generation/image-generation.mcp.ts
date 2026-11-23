import { parseArgs } from 'node:util';

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

import type { ImageGenerationJob } from '@/shared/index.js';
import { ImageGenerationError } from '@/modules/image-generation/image-generation.error.js';
import { OpenAICompatibleImageProvider } from '@/modules/image-generation/image-generation.provider.js';
import { ImageGenerationService } from '@/modules/image-generation/image-generation.service.js';

const requestIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const jobIdSchema = z.string().regex(/^[a-f0-9]{64}$/);

function jobResult(job: ImageGenerationJob) {
  return {
    structuredContent: { ...job },
    content: [{ type: 'text' as const, text: JSON.stringify(job) }],
    // A saved job is a successful query result even when generation failed.
    // Keep its typed state visible to clients instead of a generic tool error.
    isError: false,
  };
}

function toolFailure(error: unknown) {
  // Only our fixed diagnostic messages cross the MCP boundary. Never return
  // native filesystem exceptions, provider bodies, configuration or headers.
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({
      error: error instanceof ImageGenerationError ? error.code : 'IMAGE_TOOL_FAILED',
      message: error instanceof ImageGenerationError ? error.message : 'The image tool could not complete the operation.',
    }) }],
    isError: true,
  };
}

/** Builds the fixed-project tool surface used by the stdio entrypoint. */
function createImageGenerationMcpServer(service: ImageGenerationService): McpServer {
  const server = new McpServer({ name: 'cloudcli-image-generation', version: '1.0.0' });
  if (service.canGenerate) {
    server.registerTool('generate_image', {
      description: 'Submit one image job in this configured project. This writes files and may incur provider charges. Returns a saved job ID promptly; poll get_image_job with waitMs up to 20000 to retrieve the image. Use a unique requestId for each intentional generation and reuse it for recovery of that same request. Preserve the requested prompt. Never automatically replace an uncertain request with a new ID. Successful results include a project-relative asset.path; include it as a Markdown image in your reply.',
      inputSchema: z.object({
        requestId: requestIdSchema.describe('Stable opaque ID, reused only when recovering this exact generation.'),
        prompt: z.string().min(1).max(32_000),
        size: z.string().regex(/^(auto|[0-9]{2,4}x[0-9]{2,4})$/).optional(),
        quality: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).optional(),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async (input) => {
      try { return jobResult(await service.submit(input)); } catch (error) { return toolFailure(error); }
    });
  }
  server.registerTool('get_image_job', {
    description: 'Recover a saved image job by jobId or the original requestId. Reads only; never calls the image provider or regenerates missing images. Inspect status: only succeeded with an asset means an image is available. Include a successful asset.path as a Markdown image when showing the saved result.',
    inputSchema: z.object({ jobId: jobIdSchema.optional(), requestId: requestIdSchema.optional(), waitMs: z.number().int().min(0).max(20_000).default(0) })
      .strict().refine((value) => Number(value.jobId !== undefined) + Number(value.requestId !== undefined) === 1, 'Provide exactly one identifier.'),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    try { return jobResult(input.jobId ? await service.getJob(input.jobId, input.waitMs) : await service.getJobForRequest(input.requestId!, input.waitMs)); } catch (error) { return toolFailure(error); }
  });
  server.registerTool('list_generated_images', {
    description: 'List this project\'s saved image jobs without contacting the provider. Results are ordered/paginated by job ID; use get_image_job to reopen a result. Unreadable records are counted and skipped.',
    inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(10), cursor: jobIdSchema.optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    try {
      const page = await service.listJobs(input.limit, input.cursor);
      return { structuredContent: { ...page }, content: [{ type: 'text' as const, text: JSON.stringify(page) }] };
    } catch (error) { return toolFailure(error); }
  });
  return server;
}

/** Used only by the optional image MCP executable; never boots the web app or changes provider settings. */
export async function runImageGenerationMcp(argumentsList: string[], environment = process.env): Promise<void> {
  const { values } = parseArgs({ args: argumentsList, options: {
    project: { type: 'string' }, 'data-dir': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    process.stdout.write('cloudcli-image-mcp --project <absolute-project-directory> [--data-dir <private-state-directory>]\n');
    return;
  }
  if (!values.project) throw new ImageGenerationError('INVALID_CONFIG', 'Configure --project with an absolute project directory.');
  const apiKey = environment.CLOUDCLI_IMAGE_API_KEY;
  const model = environment.CLOUDCLI_IMAGE_MODEL;
  const authMode = environment.CLOUDCLI_IMAGE_AUTH_MODE ?? 'bearer';
  if (!['bearer', 'api-key'].includes(authMode)) throw new ImageGenerationError('INVALID_CONFIG', 'CLOUDCLI_IMAGE_AUTH_MODE must be bearer or api-key.');
  const provider = apiKey && model ? new OpenAICompatibleImageProvider({
    endpoint: environment.CLOUDCLI_IMAGE_ENDPOINT ?? 'https://api.openai.com/v1/images/generations',
    model, apiKey, authMode: authMode as 'bearer' | 'api-key',
    timeoutMs: environment.CLOUDCLI_IMAGE_TIMEOUT_MS ? Number(environment.CLOUDCLI_IMAGE_TIMEOUT_MS) : undefined,
  }) : undefined;
  const service = await ImageGenerationService.create({
    projectDirectory: values.project, dataDirectory: values['data-dir'] ?? environment.CLOUDCLI_IMAGE_DATA_DIR, provider,
  });
  serveStdio(() => createImageGenerationMcpServer(service), {
    onerror: () => console.error('Image MCP protocol error; no provider details were logged.'),
  });
}

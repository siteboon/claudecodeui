import { projectsDb } from '@/modules/database/index.js';
import { createImageGenerationRouter } from '@/modules/image-generation/image-generation.routes.js';
import { createProjectImageJobReader } from '@/modules/image-generation/image-generation.service.js';
import { resolveReadOnlyRootPath, validateWorkspacePath } from '@/shared/index.js';

/** Used by the server entrypoint behind its existing API-key and account authentication middleware. */
export const imageGenerationRoutes = createImageGenerationRouter(createProjectImageJobReader({
  getProjectPath: (projectId) => projectsDb.getProjectPathById(projectId),
  resolveReadablePath: async (projectPath) => {
    const workspace = await validateWorkspacePath(projectPath);
    return workspace.valid ? workspace.resolvedPath ?? null : resolveReadOnlyRootPath(projectPath);
  },
  dataDirectory: process.env.CLOUDCLI_IMAGE_DATA_DIR,
}));

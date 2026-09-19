// fileTreeRoutes: used by the server entrypoint to mount the complete authenticated File Tree API at `/api/file-tree`.
export { fileTreeRoutes } from '@/modules/file-tree/file-tree.module.js';

// fileDownloadRoutes: used by the server entrypoint to mount the capability-token native download endpoint at `/api/download`.
export { fileDownloadRoutes } from '@/modules/file-tree/file-tree.module.js';

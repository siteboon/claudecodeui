// worktreesRoutes: used by the server entrypoint to mount the complete Worktrees HTTP API at `/api/worktrees`.
export { worktreesRoutes, worktreeServices } from './worktrees.module.js';
// WorkbenchSessions reuses the merge/remove/open workflows.
export { runGitCommand } from './services/worktree-git.service.js';

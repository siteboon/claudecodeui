import spawn from 'cross-spawn';

import { userDb } from '@/modules/database/index.js';

import { createUserRouter } from './user.routes.js';
import { createUserService } from './user.service.js';

type GitCommandResult = { stdout: string };

function runGit(args: string[]): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { shell: false });
    let stdout = '';
    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout });
        return;
      }
      reject(new Error(`Git command failed with code ${code}`));
    });
  });
}

async function readSystemGitConfig() {
  const [nameResult, emailResult] = await Promise.all([
    runGit(['config', '--global', 'user.name']).catch(() => ({ stdout: '' })),
    runGit(['config', '--global', 'user.email']).catch(() => ({ stdout: '' })),
  ]);
  return {
    git_name: nameResult.stdout.trim() || null,
    git_email: emailResult.stdout.trim() || null,
  };
}

const userService = createUserService({
  users: {
    getGitConfig: (userId) => userDb.getGitConfig(userId),
    updateGitConfig: (userId, gitName, gitEmail) => userDb.updateGitConfig(
      userId,
      gitName ?? '',
      gitEmail ?? '',
    ),
    completeOnboarding: (userId) => userDb.completeOnboarding(userId),
    hasCompletedOnboarding: (userId) => userDb.hasCompletedOnboarding(userId),
  },
  readSystemGitConfig,
  applyGlobalGitConfig: async (gitName, gitEmail) => {
    await runGit(['config', '--global', 'user.name', gitName]);
    await runGit(['config', '--global', 'user.email', gitEmail]);
  },
  logInfo: (message) => console.log(message),
  logError: (message, error) => console.error(message, error),
});

/** User router assembled for the authenticated server mount. */
export const userRoutes = createUserRouter(userService);

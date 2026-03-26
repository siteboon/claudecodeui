import spawn from 'cross-spawn';
import type { SpawnOptionsWithoutStdio } from 'child_process';

type SpawnResult = {
  stdout: string;
  stderr: string;
};

export function spawnAsync(command: string, args: string[], options: SpawnOptionsWithoutStdio = {}): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    let stdout = '';
    let stderr = '';
    
    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    }
    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    }
    
    child.on('error', (error: Error) => { reject(error); });
    
    child.on('close', (code: number | null) => {
      if (code === 0) { 
        resolve({ stdout, stderr }); 
        return; 
      }
      
      const error = new Error(`Command failed: ${command} ${args.join(' ')}`) as Error & {
        code: number | null;
        stdout: string;
        stderr: string;
      };
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

/**
 * Read git configuration from system's global git config
 */
export async function getSystemGitConfig(): Promise<{ git_name: string | null; git_email: string | null }> {
  try {
    const [nameResult, emailResult] = await Promise.all([
      spawnAsync('git', ['config', '--global', 'user.name']).catch(() => ({ stdout: '', stderr: '' })),
      spawnAsync('git', ['config', '--global', 'user.email']).catch(() => ({ stdout: '', stderr: '' }))
    ]);

    return {
      git_name: nameResult.stdout.trim() || null,
      git_email: emailResult.stdout.trim() || null
    };
  } catch (error) {
    return { git_name: null, git_email: null };
  }
}

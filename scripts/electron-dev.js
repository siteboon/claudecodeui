import { spawn } from 'child_process';
import { createRequire } from 'module';
import net from 'net';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const npmBinary = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`No available port found in range ${startPort}-${startPort + 99}`);
}

async function waitForUrl(url, timeoutMs = 60000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function terminateProcess(childProcess) {
  if (!childProcess || childProcess.killed) {
    return;
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(childProcess.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }

  childProcess.kill('SIGTERM');
}

const backendPort = await findAvailablePort(Number.parseInt(process.env.PORT || '3001', 10));
const vitePort = await findAvailablePort(Number.parseInt(process.env.VITE_PORT || '5173', 10));
const rendererUrl = `http://127.0.0.1:${vitePort}`;
const sharedEnv = {
  ...process.env,
  HOST: '127.0.0.1',
  PORT: String(backendPort),
  VITE_PORT: String(vitePort),
  CLAUDE_CODE_UI_ELECTRON_DEV: 'true',
  CLAUDE_CODE_UI_VITE_URL: rendererUrl,
};

console.log(`[electron:dev] Backend port: ${backendPort}`);
console.log(`[electron:dev] Vite URL: ${rendererUrl}`);

const viteProcess = spawn(npmBinary, ['run', 'client', '--', '--port', String(vitePort)], {
  cwd: process.cwd(),
  stdio: ['pipe', 'inherit', 'inherit'],
  env: sharedEnv,
  shell: process.platform === 'win32',
});

let shuttingDown = false;
let electronProcess;

const shutdown = (exitCode = 0) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  terminateProcess(electronProcess);
  terminateProcess(viteProcess);
  process.exit(exitCode);
};

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

viteProcess.once('exit', (code) => {
  if (!shuttingDown) {
    console.error(`[electron:dev] Vite exited early with code ${code ?? 0}`);
    shutdown(code === 0 ? 1 : (code ?? 1));
  }
});

try {
  await waitForUrl(rendererUrl);
} catch (error) {
  console.error(`[electron:dev] ${error.message}`);
  shutdown(1);
}

electronProcess = spawn(electronBinary, ['electron/main.js'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'inherit', 'inherit'],
  env: sharedEnv,
});

electronProcess.once('exit', (code) => {
  shutdown(code ?? 0);
});

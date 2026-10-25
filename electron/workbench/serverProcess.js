import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const HOST = '127.0.0.1';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '0.0.0.0', () => server.close(() => resolve(true)));
  });
}

function checkHealth(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port, path: '/health', timeout: 800 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/** Kills a process and all of its descendants (PTYs, claude, codex). */
export function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

/** Runs the Workbench server as a child process bound to 127.0.0.1 on a free port. */
export class ServerProcess {
  constructor({ appRoot, isPackaged = false, remotePort = null, onSessionCount, onSessionStatus }) {
    this.appRoot = appRoot;
    this.remotePort = remotePort;
    this.isPackaged = isPackaged;
    this.onSessionCount = onSessionCount;
    this.onSessionStatus = onSessionStatus;
    this.child = null;
    this.port = null;
    this.logs = [];
  }

  get url() {
    return `http://${HOST}:${this.port}`;
  }

  resolveLaunch() {
    const builtEntry = path.join(this.appRoot, 'dist-server', 'server', 'index.js');
    // Only the packaged app runs the compiled server under Electron's Node (native modules are
    // rebuilt for that ABI at package time). In development the checkout's native modules are
    // built for the system Node, so the sources run through tsx there, even if dist-server exists.
    if (this.isPackaged && fs.existsSync(builtEntry)) {
      return { command: process.execPath, args: [builtEntry], env: { ELECTRON_RUN_AS_NODE: '1' } };
    }
    // Development: run the TypeScript sources through tsx on the system Node
    // (native modules are built for it, not for Electron's ABI).
    const tsx = path.join(this.appRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    return {
      command: process.env.WORKBENCH_NODE || 'node',
      args: [
        tsx,
        '--tsconfig', path.join(this.appRoot, 'server', 'tsconfig.json'),
        path.join(this.appRoot, 'server', 'index.ts'),
      ],
      env: {},
    };
  }

  /** Remote mode prefers a fixed port (stable phone bookmark); otherwise any free loopback port. */
  async choosePort() {
    if (this.remotePort && (await isPortFree(this.remotePort))) return this.remotePort;
    return getFreePort();
  }

  async start() {
    this.port = Number(process.env.WORKBENCH_SERVER_PORT) || await this.choosePort();
    const launch = this.resolveLaunch();
    this.child = spawn(launch.command, launch.args, {
      cwd: this.appRoot,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        ...launch.env,
        // Remote access is opt-in; the server then listens on all interfaces but its TCP guard
        // only admits loopback and Tailscale addresses.
        ...(this.remotePort ? { WORKBENCH_REMOTE: '1', HOST: '0.0.0.0' } : { HOST }),
        SERVER_PORT: String(this.port),
      },
    });

    const log = (chunk) => {
      // Drop minified bootstrap noise so error dialogs stay readable.
      const text = String(chunk).split(String.fromCharCode(10)).filter((line) => line.length < 400).join(String.fromCharCode(10));
      this.logs.push(text);
      if (this.logs.length > 300) this.logs.splice(0, this.logs.length - 300);
    };
    this.child.stdout.on('data', log);
    this.child.stderr.on('data', log);
    this.child.on('message', (message) => {
      if (message?.type === 'workbench:sessions') this.onSessionCount?.(message.count);
      if (message?.type === 'workbench:status') this.onSessionStatus?.(message);
    });
    let exited = false;
    this.child.once('exit', () => { exited = true; this.child = null; });

    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (exited) throw new Error(`Server exited during startup.\n${this.logs.slice(-20).join('')}`);
      if (await checkHealth(this.port)) return this.url;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`Server did not become healthy.\n${this.logs.slice(-20).join('')}`);
  }

  /** Asks the server to shut down (kills PTYs), then force-kills the whole tree. */
  async stop() {
    const child = this.child;
    if (!child) return;
    const pid = child.pid;
    try { child.send({ type: 'workbench:shutdown' }); } catch { /* channel closed */ }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    killProcessTree(pid);
    this.child = null;
  }

  /** Synchronous last resort used from the process 'exit' handler. */
  killNow() {
    if (this.child) killProcessTree(this.child.pid);
  }
}

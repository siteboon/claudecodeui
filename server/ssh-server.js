/**
 * SSH Server for Claude Code UI
 * Allows SSH clients (PuTTY, Terminal, etc.) to connect and use Claude Code CLI
 */

import { Server } from 'ssh2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import os from 'os';
import pty from 'node-pty';
import crypto from 'crypto';
import { userDb } from './database/db.js';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// SSH Host Key paths
const SSH_KEYS_DIR = path.join(__dirname, '../.ssh-keys');
const HOST_KEY_PATH = path.join(SSH_KEYS_DIR, 'host_key');

/**
 * Generate SSH host key if it doesn't exist
 */
function ensureHostKey() {
    if (!fs.existsSync(SSH_KEYS_DIR)) {
        fs.mkdirSync(SSH_KEYS_DIR, { recursive: true });
    }

    if (!fs.existsSync(HOST_KEY_PATH)) {
        console.log('[SSH] Generating new SSH host key...');
        const { privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 4096,
            privateKeyEncoding: {
                type: 'pkcs1',
                format: 'pem'
            }
        });
        fs.writeFileSync(HOST_KEY_PATH, privateKey, { mode: 0o600 });
        console.log('[SSH] SSH host key generated successfully');
    }

    return fs.readFileSync(HOST_KEY_PATH);
}

/**
 * Start SSH Server
 * @param {number} port - Port to listen on (default: 2222)
 * @param {object} options - Additional options
 */
export function startSSHServer(port = 2222, options = {}) {
    const hostKey = ensureHostKey();

    const sshServer = new Server({
        hostKeys: [hostKey],
        banner: 'Claude Code UI SSH Server\n'
    }, (client) => {
        console.log('[SSH] Client connected');

        let authenticatedUser = null;

        client.on('authentication', async (ctx) => {
            console.log(`[SSH] Authentication attempt: method=${ctx.method}, username=${ctx.username}`);

            if (ctx.method === 'password') {
                try {
                    // Verify against our database
                    const user = userDb.getUserByUsername(ctx.username);
                    if (user) {
                        const isValidPassword = await bcrypt.compare(ctx.password, user.password_hash);
                        if (isValidPassword) {
                            authenticatedUser = user;
                            console.log(`[SSH] User ${ctx.username} authenticated successfully`);
                            ctx.accept();
                            return;
                        }
                    }
                    console.log(`[SSH] Authentication failed for user ${ctx.username}`);
                    ctx.reject(['password']);
                } catch (error) {
                    console.error('[SSH] Authentication error:', error);
                    ctx.reject(['password']);
                }
            } else if (ctx.method === 'none') {
                // Reject 'none' method, require password
                ctx.reject(['password']);
            } else {
                // Reject other methods
                ctx.reject(['password']);
            }
        });

        client.on('ready', () => {
            console.log(`[SSH] Client authenticated: ${authenticatedUser?.username}`);

            client.on('session', (accept, reject) => {
                const session = accept();
                let ptyInfo = null;
                let shellProcess = null;

                session.on('pty', (accept, reject, info) => {
                    console.log(`[SSH] PTY requested: ${info.cols}x${info.rows}`);
                    ptyInfo = info;
                    accept();
                });

                session.on('window-change', (accept, reject, info) => {
                    console.log(`[SSH] Window resize: ${info.cols}x${info.rows}`);
                    if (shellProcess) {
                        shellProcess.resize(info.cols, info.rows);
                    }
                    if (accept) accept();
                });

                session.on('shell', (accept, reject) => {
                    console.log('[SSH] Shell requested');
                    const stream = accept();

                    // Determine shell and project path
                    const homeDir = os.homedir();
                    const defaultProject = homeDir; // Default to home directory

                    // Spawn Claude CLI in PTY
                    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
                    const shellCommand = `claude`;

                    const termCols = ptyInfo?.cols || 80;
                    const termRows = ptyInfo?.rows || 24;

                    try {
                        shellProcess = pty.spawn(shell, ['-c', shellCommand], {
                            name: 'xterm-256color',
                            cols: termCols,
                            rows: termRows,
                            cwd: defaultProject,
                            env: {
                                ...process.env,
                                TERM: 'xterm-256color',
                                COLORTERM: 'truecolor',
                                FORCE_COLOR: '3',
                                HOME: homeDir,
                                USER: authenticatedUser?.username || 'user'
                            }
                        });

                        console.log(`[SSH] Claude CLI started, PID: ${shellProcess.pid}`);

                        // Pipe PTY output to SSH stream
                        shellProcess.onData((data) => {
                            stream.write(data);
                        });

                        // Pipe SSH stream input to PTY
                        stream.on('data', (data) => {
                            shellProcess.write(data.toString());
                        });

                        // Handle PTY exit
                        shellProcess.onExit(({ exitCode, signal }) => {
                            console.log(`[SSH] Claude CLI exited: code=${exitCode}, signal=${signal}`);
                            stream.exit(exitCode || 0);
                            stream.end();
                        });

                        // Handle SSH stream close
                        stream.on('close', () => {
                            console.log('[SSH] Stream closed');
                            if (shellProcess) {
                                shellProcess.kill();
                            }
                        });

                        stream.on('error', (err) => {
                            console.error('[SSH] Stream error:', err);
                            if (shellProcess) {
                                shellProcess.kill();
                            }
                        });

                    } catch (error) {
                        console.error('[SSH] Error spawning shell:', error);
                        stream.stderr.write(`Error: ${error.message}\n`);
                        stream.exit(1);
                        stream.end();
                    }
                });

                // Handle exec requests (single command execution)
                session.on('exec', (accept, reject, info) => {
                    console.log(`[SSH] Exec requested: ${info.command}`);
                    const stream = accept();

                    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
                    const termCols = ptyInfo?.cols || 80;
                    const termRows = ptyInfo?.rows || 24;

                    try {
                        shellProcess = pty.spawn(shell, ['-c', info.command], {
                            name: 'xterm-256color',
                            cols: termCols,
                            rows: termRows,
                            cwd: os.homedir(),
                            env: {
                                ...process.env,
                                TERM: 'xterm-256color',
                                COLORTERM: 'truecolor'
                            }
                        });

                        shellProcess.onData((data) => {
                            stream.write(data);
                        });

                        shellProcess.onExit(({ exitCode }) => {
                            stream.exit(exitCode || 0);
                            stream.end();
                        });

                    } catch (error) {
                        stream.stderr.write(`Error: ${error.message}\n`);
                        stream.exit(1);
                        stream.end();
                    }
                });
            });
        });

        client.on('close', () => {
            console.log('[SSH] Client disconnected');
        });

        client.on('error', (err) => {
            console.error('[SSH] Client error:', err);
        });
    });

    sshServer.listen(port, '0.0.0.0', () => {
        console.log(`[SSH] SSH Server listening on port ${port}`);
        console.log(`[SSH] Connect with: ssh -p ${port} <username>@<host>`);
    });

    sshServer.on('error', (err) => {
        console.error('[SSH] Server error:', err);
    });

    return sshServer;
}

export default { startSSHServer };

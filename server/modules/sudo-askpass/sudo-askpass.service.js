/**
 * Sudo askpass bridge for chat-driven agents.
 *
 * Agents (Claude SDK, cursor/gemini/opencode) run shell commands with no tty, so
 * a plain `sudo` that needs a password just fails. This module makes that case
 * interactive:
 *
 *   1. registerSudoRun() hands the agent's child process an env that (a) prepends
 *      a `sudo` shim forcing `sudo -A`, and (b) points SUDO_ASKPASS at a helper.
 *   2. When sudo needs a password it runs the helper, which POSTs to the local
 *      /internal/askpass route (loopback + per-run token).
 *   3. requestSudoPassword() relays the prompt to the chat WebSocket and waits
 *      for the user's reply, then the helper prints the password back to sudo.
 *
 * The password is held only transiently in the pending promise and is never
 * logged or persisted.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createNormalizedMessage } from '../../shared/utils.js';

const SUDO_PROMPT_TIMEOUT_MS = parseInt(process.env.SUDO_PROMPT_TIMEOUT_MS, 10) || 120000;

let serverPort = parseInt(process.env.SERVER_PORT, 10) || 3001;
let cachedFiles = null;

/** token -> { ws, sessionId, provider, createdAt } */
const runs = new Map();
/** requestId -> { resolve, reject, timer } */
const pending = new Map();

/** Allows index.js to pin the actual listening port once it is known. */
export function setServerPort(port) {
  const parsed = parseInt(port, 10);
  if (parsed > 0) {
    serverPort = parsed;
  }
}

/** Finds a real `sudo` on PATH, skipping our own shim directory. */
function resolveRealSudo(shimDir) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter((d) => d && d !== shimDir);
  for (const dir of dirs) {
    const candidate = path.join(dir, 'sudo');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return '/usr/bin/sudo';
}

const ASKPASS_HELPER_SOURCE = `#!/usr/bin/env node
// Invoked by sudo (-A). Asks the local server for the password and prints it.
const http = require('http');
const token = process.env.AIGM_ASKPASS_TOKEN || '';
const port = process.env.AIGM_ASKPASS_PORT || '3001';
const prompt = process.argv[2] || '';
const body = JSON.stringify({ token, prompt });
const req = http.request(
  {
    host: '127.0.0.1',
    port,
    path: '/internal/askpass',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      if (res.statusCode === 200) {
        process.stdout.write(data);
        process.exit(0);
      }
      process.exit(1);
    });
  }
);
req.on('error', () => process.exit(1));
req.write(body);
req.end();
`;

/** Creates (once) a private dir holding the sudo shim and askpass helper. */
export function ensureAskpassFiles() {
  if (cachedFiles && fs.existsSync(cachedFiles.askpassPath) && fs.existsSync(cachedFiles.sudoShimPath)) {
    return cachedFiles;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-askpass-'));
  fs.chmodSync(dir, 0o700);

  const realSudo = resolveRealSudo(dir);
  const sudoShimPath = path.join(dir, 'sudo');
  fs.writeFileSync(sudoShimPath, `#!/bin/sh\nexec ${realSudo} -A "$@"\n`, { mode: 0o755 });

  const askpassPath = path.join(dir, 'askpass.cjs');
  fs.writeFileSync(askpassPath, ASKPASS_HELPER_SOURCE, { mode: 0o755 });

  cachedFiles = { dir, sudoShimPath, askpassPath, realSudo };
  return cachedFiles;
}

/**
 * Registers a run and returns the env additions to merge into the agent's child
 * process. The returned token ties askpass callbacks back to this run's socket.
 */
export function registerSudoRun(ws, sessionId, provider = 'claude') {
  const files = ensureAskpassFiles();
  const token = crypto.randomBytes(24).toString('hex');
  runs.set(token, { ws, sessionId: sessionId || '', provider, createdAt: Date.now() });

  const env = {
    PATH: `${files.dir}${path.delimiter}${process.env.PATH || ''}`,
    SUDO_ASKPASS: files.askpassPath,
    AIGM_ASKPASS_TOKEN: token,
    AIGM_ASKPASS_PORT: String(serverPort),
    AIGM_ASKPASS_SESSION: sessionId || '',
  };

  return { token, env };
}

export function unregisterSudoRun(token) {
  if (token) {
    runs.delete(token);
  }
}

export function validateAskpassToken(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }
  return runs.get(token) || null;
}

function sendToRun(entry, serialized) {
  try {
    entry.ws?.send?.(serialized);
  } catch {
    // socket gone; the prompt will simply time out
  }
}

/**
 * Relays a sudo prompt to the chat client and resolves with the password the
 * user types, or rejects on cancel/timeout/invalid token.
 */
export function requestSudoPassword({ token, prompt }) {
  const entry = validateAskpassToken(token);
  if (!entry) {
    return Promise.reject(new Error('invalid askpass token'));
  }

  const requestId = crypto.randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      sendToRun(
        entry,
        JSON.stringify(
          createNormalizedMessage({
            kind: 'sudo_password_cancelled',
            provider: entry.provider || 'claude',
            sessionId: entry.sessionId || null,
            requestId,
          })
        )
      );
      reject(new Error('sudo password prompt timed out'));
    }, SUDO_PROMPT_TIMEOUT_MS);

    pending.set(requestId, { resolve, reject, timer });

    sendToRun(
      entry,
      JSON.stringify(
        createNormalizedMessage({
          kind: 'sudo_password_request',
          provider: entry.provider || 'claude',
          sessionId: entry.sessionId || null,
          requestId,
          prompt: prompt || '',
        })
      )
    );
  });
}

/** Resolves a pending prompt. cancel:true or a non-string password rejects it. */
export function resolveSudoPassword(requestId, { password, cancel } = {}) {
  const entry = pending.get(requestId);
  if (!entry) {
    return;
  }
  pending.delete(requestId);
  clearTimeout(entry.timer);

  if (cancel || typeof password !== 'string') {
    entry.reject(new Error('sudo password cancelled'));
  } else {
    entry.resolve(password);
  }
}

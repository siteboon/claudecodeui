/**
 * ACP Transport — manages the kiro-cli acp child process and JSON-RPC 2.0 communication.
 *
 * Singleton: one long-lived process shared across all sessions.
 */

import { spawn, type ChildProcess } from 'child_process';
import type { AcpInitializeResult } from './types.js';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type NotificationHandler = (method: string, params: Record<string, unknown>) => void;

export class AcpTransport {
  private process: ChildProcess | null = null;
  private ready = false;
  private rpcId = 0;
  private pending = new Map<number, PendingRequest>();
  private lineBuffer = '';
  private onNotification: NotificationHandler = () => {};
  private initPromise: Promise<AcpInitializeResult> | null = null;

  constructor(private kiroPath = process.env.KIRO_PATH || 'kiro-cli') {}

  /** Register a handler for incoming JSON-RPC notifications. */
  setNotificationHandler(handler: NotificationHandler): void {
    this.onNotification = handler;
  }

  private initResult: AcpInitializeResult | null = null;

  /** Ensure the ACP process is running and initialized. */
  async connect(acpArgs: string[] = []): Promise<AcpInitializeResult> {
    // If process died, reset so we respawn
    if (this.initResult && (!this.ready || !this.process)) {
      this.initResult = null;
      this.initPromise = null;
    }

    if (this.ready && this.process && this.initResult) {
      return this.initResult;
    }

    if (this.initPromise) return this.initPromise;

    this.initPromise = this._spawn(acpArgs);
    return this.initPromise;
  }

  private async _spawn(acpArgs: string[]): Promise<AcpInitializeResult> {
    const args = ['acp', ...acpArgs];

    this.process = spawn(this.kiroPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this.lineBuffer = '';

    this.process.stdout!.on('data', (data: Buffer) => {
      this.lineBuffer += data.toString();
      const lines = this.lineBuffer.split('\n');
      this.lineBuffer = lines.pop()!;
      for (const line of lines) this.handleLine(line);
    });

    this.process.stderr!.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('DeprecationWarning')) {
        console.error('[kiro-sdk:stderr]', msg);
      }
    });

    this.process.on('close', () => {
      this.ready = false;
      this.process = null;
      this.initPromise = null;
      this.initResult = null;
      for (const [id, { reject, timeout }] of this.pending) {
        clearTimeout(timeout);
        reject(new Error('ACP process exited'));
      }
      this.pending.clear();
    });

    this.process.on('error', (err) => {
      console.error('[kiro-sdk] process error:', err.message);
      this.ready = false;
      this.process = null;
      this.initPromise = null;
      this.initResult = null;
    });

    this.ready = true;

    const result = await this.sendRpc('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      clientInfo: { name: 'kiro-sdk', version: '0.1.0' },
    }) as AcpInitializeResult;

    this.initResult = result;
    return result;
  }

  /** Send a JSON-RPC request and wait for the response. */
  sendRpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.ready) {
        return reject(new Error('ACP process not ready'));
      }
      const id = ++this.rpcId;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout for ${method}`));
      }, 120_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.process.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  /** Gracefully shut down the ACP process. */
  disconnect(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
      this.ready = false;
    }
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(line); } catch { return; }

    // Response to a pending request
    if (msg.id != null && this.pending.has(msg.id as number)) {
      const { resolve, reject, timeout } = this.pending.get(msg.id as number)!;
      clearTimeout(timeout);
      this.pending.delete(msg.id as number);
      if (msg.error) {
        const err = msg.error as Record<string, unknown>;
        reject(new Error((err.message as string) || JSON.stringify(err)));
      } else {
        resolve(msg.result);
      }
      return;
    }

    // Notification
    if (msg.method) {
      this.onNotification(msg.method as string, (msg.params || {}) as Record<string, unknown>);
    }
  }
}

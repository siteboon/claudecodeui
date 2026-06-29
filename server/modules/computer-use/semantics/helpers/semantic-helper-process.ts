import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

type JsonRecord = Record<string, unknown>;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.CLOUDCLI_SEMANTICS_HELPER_TIMEOUT_MS || '60000', 10);

function timeoutMs(): number {
  return Number.isFinite(DEFAULT_TIMEOUT_MS) && DEFAULT_TIMEOUT_MS > 0 ? DEFAULT_TIMEOUT_MS : 60000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SemanticHelperProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private reader: readline.Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  constructor(private readonly executablePath: string) {}

  async request(method: string, params: JsonRecord): Promise<unknown> {
    this.ensureStarted();
    const child = this.child;
    if (!child?.stdin.writable) {
      throw new Error('Semantic helper process is not running.');
    }

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Semantic helper request timed out: ${method}`));
      }, timeoutMs());
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    this.reader?.close();
    this.reader = null;
    this.rejectAll('Semantic helper stopped.');
    if (child) {
      try { child.kill('SIGTERM'); } catch { /* noop */ }
    }
  }

  private ensureStarted(): void {
    if (this.child) {
      return;
    }

    this.child = spawn(this.executablePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.reader = readline.createInterface({ input: this.child.stdout });
    this.reader.on('line', (line) => this.handleLine(line));

    this.child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) {
        console.error('[SemanticHelper]', text);
      }
    });

    this.child.once('error', (error) => {
      this.child = null;
      this.rejectAll(`Failed to start semantic helper: ${error.message}`);
    });

    this.child.once('exit', (code) => {
      this.child = null;
      this.rejectAll(`Semantic helper exited with code ${code ?? 'null'}.`);
    });
  }

  private handleLine(line: string): void {
    let message: JsonRecord;
    try {
      message = JSON.parse(line) as JsonRecord;
    } catch (error) {
      console.error('[SemanticHelper] Invalid JSON response:', errorMessage(error));
      return;
    }

    const id = typeof message.id === 'number' ? message.id : null;
    if (id === null) {
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (message.error) {
      pending.reject(new Error(typeof message.error === 'string' ? message.error : 'Semantic helper request failed.'));
      return;
    }
    pending.resolve(message.result);
  }

  private rejectAll(reason: string): void {
    for (const [id, request] of this.pending.entries()) {
      clearTimeout(request.timer);
      request.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}

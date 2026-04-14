/**
 * ACP Transport — manages the kiro-cli acp child process and JSON-RPC 2.0 communication.
 *
 * Singleton: one long-lived process shared across all sessions.
 */
import type { AcpInitializeResult } from './types.js';
type NotificationHandler = (method: string, params: Record<string, unknown>) => void;
export declare class AcpTransport {
    private kiroPath;
    private process;
    private ready;
    private rpcId;
    private pending;
    private lineBuffer;
    private onNotification;
    private initPromise;
    constructor(kiroPath?: string);
    /** Register a handler for incoming JSON-RPC notifications. */
    setNotificationHandler(handler: NotificationHandler): void;
    private initResult;
    /** Ensure the ACP process is running and initialized. */
    connect(acpArgs?: string[]): Promise<AcpInitializeResult>;
    private _spawn;
    /** Send a JSON-RPC request and wait for the response. */
    sendRpc(method: string, params?: Record<string, unknown>): Promise<unknown>;
    /** Gracefully shut down the ACP process. */
    disconnect(): void;
    private handleLine;
}
export {};

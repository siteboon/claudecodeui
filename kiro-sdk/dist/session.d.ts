/**
 * Session — routes ACP notifications to the correct async generator.
 */
import type { KiroMessage } from './types.js';
export declare class SessionRouter {
    private sessions;
    register(acpSessionId: string): void;
    unregister(acpSessionId: string): void;
    has(acpSessionId: string): boolean;
    /** Push a message into the session's buffer and wake the generator. */
    push(acpSessionId: string, message: KiroMessage): void;
    /** Mark session as done (TurnEnd received). */
    finish(acpSessionId: string, isError?: boolean): void;
    /** Async generator that yields messages for a session. */
    iterate(acpSessionId: string): AsyncGenerator<KiroMessage, void, undefined>;
}

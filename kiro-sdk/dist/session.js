/**
 * Session — routes ACP notifications to the correct async generator.
 */
export class SessionRouter {
    sessions = new Map();
    register(acpSessionId) {
        this.sessions.set(acpSessionId, {
            acpSessionId,
            buffer: [],
            wake: null,
            done: false,
            fullText: '',
        });
    }
    unregister(acpSessionId) {
        this.sessions.delete(acpSessionId);
    }
    has(acpSessionId) {
        return this.sessions.has(acpSessionId);
    }
    /** Push a message into the session's buffer and wake the generator. */
    push(acpSessionId, message) {
        const entry = this.sessions.get(acpSessionId);
        if (!entry)
            return;
        if (message.type === 'assistant') {
            entry.fullText += message.content;
        }
        entry.buffer.push(message);
        entry.wake?.();
    }
    /** Mark session as done (TurnEnd received). */
    finish(acpSessionId, isError = false) {
        const entry = this.sessions.get(acpSessionId);
        if (!entry)
            return;
        entry.buffer.push({
            type: 'result',
            session_id: acpSessionId,
            is_error: isError,
            text: entry.fullText,
        });
        entry.done = true;
        entry.wake?.();
    }
    /** Async generator that yields messages for a session. */
    async *iterate(acpSessionId) {
        const entry = this.sessions.get(acpSessionId);
        if (!entry)
            return;
        while (true) {
            // Drain buffer
            while (entry.buffer.length > 0) {
                const msg = entry.buffer.shift();
                yield msg;
                if (msg.type === 'result')
                    return;
            }
            if (entry.done)
                return;
            // Wait for next message
            await new Promise((resolve) => {
                entry.wake = resolve;
            });
            entry.wake = null;
        }
    }
}

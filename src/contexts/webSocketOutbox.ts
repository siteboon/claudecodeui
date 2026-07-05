const DEFAULT_MAX_PENDING_MESSAGES = 25;

export function createWebSocketOutbox(maxPendingMessages = DEFAULT_MAX_PENDING_MESSAGES) {
  const pending: string[] = [];

  return {
    enqueue(message: unknown): boolean {
      if (pending.length >= maxPendingMessages) {
        return false;
      }

      pending.push(JSON.stringify(message));
      return true;
    },
    flush(send: (payload: string) => void): void {
      while (pending.length > 0) {
        const payload = pending.shift();
        if (payload) {
          send(payload);
        }
      }
    },
    size(): number {
      return pending.length;
    },
  };
}

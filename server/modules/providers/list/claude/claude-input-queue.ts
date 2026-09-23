import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/** Used by the Claude runtime to feed successive turns into one live SDK query. */
export function createClaudeInputQueue(initial: SDKUserMessage[]) {
  const messages = [...initial];
  let closed = false;
  let wake: (() => void) | undefined;

  const release = () => {
    closed = true;
    messages.length = 0;
    wake?.();
  };

  const stream = (async function* () {
    try {
      while (!closed) {
        const message = messages.shift();
        if (message) {
          yield message;
        } else {
          await new Promise<void>((resolve) => { wake = resolve; });
          wake = undefined;
        }
      }
    } finally {
      release();
    }
  })();

  return {
    stream,
    release,
    get closed() { return closed; },
    push(input: SDKUserMessage[]) {
      if (closed) throw new Error('The Claude session is closing. Retry the message.');
      messages.push(...input);
      wake?.();
    },
  };
}

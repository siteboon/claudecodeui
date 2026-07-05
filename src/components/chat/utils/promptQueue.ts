export type QueuedPrompt = {
  id: string;
  content: string;
  createdAt: number;
  sessionId: string | null;
  projectId: string;
  provider: string;
};

export type QueuedPromptContext = {
  sessionId: string | null;
  projectId: string;
  provider: string;
};

export function isQueueablePrompt(
  content: string,
  options: { hasAttachments: boolean },
): boolean {
  const normalized = content.trim();

  if (!normalized || options.hasAttachments) {
    return false;
  }

  return !normalized.startsWith('/') && normalized.toLowerCase() !== 'help';
}

export function enqueuePrompt(
  queue: QueuedPrompt[],
  content: string,
  now = Date.now(),
  context: QueuedPromptContext = {
    sessionId: null,
    projectId: '',
    provider: '',
  },
): QueuedPrompt[] {
  if (!content.trim()) {
    return queue;
  }

  return [
    ...queue,
    {
      id: `${now}-${queue.length}`,
      content,
      createdAt: now,
      sessionId: context.sessionId,
      projectId: context.projectId,
      provider: context.provider,
    },
  ];
}

export function queuedPromptMatchesContext(prompt: QueuedPrompt, context: QueuedPromptContext): boolean {
  return prompt.sessionId === context.sessionId
    && prompt.projectId === context.projectId
    && prompt.provider === context.provider;
}

export function dequeuePrompt(queue: QueuedPrompt[]): { next: QueuedPrompt | null; rest: QueuedPrompt[] } {
  const [next, ...rest] = queue;
  return {
    next: next ?? null,
    rest,
  };
}

import { createContext, useContext } from 'react';

/**
 * The project that relative file references in model-authored markdown
 * resolve against.
 *
 * Markdown is rendered deep inside the transcript (messages, tool results,
 * streaming halves) and none of those call sites know the selected project.
 * ChatInterface provides it once so `![alt](imagenes/foto.png)` can be fetched
 * through the authenticated project files route instead of failing as a bare
 * `<img src>` against the web origin.
 */
export const MarkdownWorkspaceContext = createContext<{ projectId: string | null }>({ projectId: null });

/** DB `projectId` of the project the transcript belongs to, or null outside a project. */
export function useMarkdownWorkspaceProjectId(): string | null {
  return useContext(MarkdownWorkspaceContext).projectId;
}

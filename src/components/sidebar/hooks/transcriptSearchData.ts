/**
 * Pure data shapes and transforms for the transcript-search hook.
 * Extracted from useTranscriptSearch so the pure pieces can be unit-tested
 * without dragging in DOM / EventSource / vite-env-dependent modules.
 */

export type TranscriptMatchHighlight = {
  start: number;
  end: number;
};

export type TranscriptMatch = {
  role: string;
  snippet: string;
  highlights: TranscriptMatchHighlight[];
  timestamp: string | null;
};

export type TranscriptSessionResult = {
  projectName: string;
  projectDisplayName: string;
  sessionId: string;
  sessionSummary: string;
  match: TranscriptMatch;
};

export type ConversationProjectResult = {
  projectName: string;
  projectDisplayName: string;
  sessions: {
    sessionId: string;
    sessionSummary: string;
    matches: TranscriptMatch[];
  }[];
};

/**
 * Flatten server SSE projectResult payloads into one row per session,
 * carrying forward the first match only. Preserves input order.
 */
export function flattenProjectResults(
  projectResults: ConversationProjectResult[],
): TranscriptSessionResult[] {
  const out: TranscriptSessionResult[] = [];
  for (const project of projectResults) {
    for (const session of project.sessions) {
      const first = session.matches[0];
      if (!first) continue;
      out.push({
        projectName: project.projectName,
        projectDisplayName: project.projectDisplayName,
        sessionId: session.sessionId,
        sessionSummary: session.sessionSummary,
        match: first,
      });
    }
  }
  return out;
}

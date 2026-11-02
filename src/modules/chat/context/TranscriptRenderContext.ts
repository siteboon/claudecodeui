import { createContext, useContext } from 'react';

/**
 * Marks a transcript render that is being turned into a document rather than
 * shown on screen.
 *
 * Export renders the real transcript components rather than a parallel
 * formatter, so the exported file cannot drift from what the user saw. But a
 * static render has no one to click "expand" — so collapsed tool groups and
 * subagent panels would come out empty, and their activity caps would truncate
 * for a viewport that does not exist. This flag tells them to render whole.
 */
export const TranscriptRenderContext = createContext<{ isExporting: boolean }>({ isExporting: false });

/** True only while the transcript is being rendered into an exported document. */
export function useIsExportingTranscript(): boolean {
  return useContext(TranscriptRenderContext).isExporting;
}

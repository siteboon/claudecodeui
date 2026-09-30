import { useSyncExternalStore } from 'react';

/**
 * Two tiny stores outside React, written by the socket handler and read by the
 * controls:
 *  - the per-message voice note (the reply that was spoken, or one that had no
 *    spoken line), one per session, replaced by the next turn in that session;
 *  - the polite live-region announcement (a translation key in `voice`).
 */

export type VoiceNote =
  | { kind: 'spoken'; messageKey: string; line: string; voiceId: string }
  | { kind: 'no_summary'; messageKey: string };

/** Stable key of an assistant reply by its text (the row id changes when history refreshes). */
export function messageKeyOf(content: string | null | undefined): string {
  const input = String(content || '').trim();
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (((h << 5) + h) + input.charCodeAt(i)) | 0;
  return `m${(h >>> 0).toString(36)}_${input.length}`;
}

const notes = new Map<string, VoiceNote>();
let notesVersion = 0;
const noteListeners = new Set<() => void>();
const emitNotes = () => {
  notesVersion += 1;
  noteListeners.forEach((listener) => listener());
};

export function setVoiceNote(sessionId: string, note: VoiceNote): void {
  notes.set(sessionId, note);
  emitNotes();
}

export function clearVoiceNote(sessionId: string | null | undefined): void {
  if (sessionId && notes.delete(sessionId)) emitNotes();
}

export function voiceNoteFor(messageKey: string): VoiceNote | null {
  for (const note of notes.values()) if (note.messageKey === messageKey) return note;
  return null;
}

const subscribeNotes = (listener: () => void) => {
  noteListeners.add(listener);
  return () => {
    noteListeners.delete(listener);
  };
};

export function useVoiceNote(messageKey: string): VoiceNote | null {
  useSyncExternalStore(subscribeNotes, () => notesVersion, () => notesVersion);
  return voiceNoteFor(messageKey);
}

// --- announcements -----------------------------------------------------------

export type Announcement = { key: string; params?: Record<string, unknown>; id: number };

let announcement: Announcement | null = null;
let announcementSeq = 0;
const announceListeners = new Set<() => void>();

export function announceVoice(key: string, params?: Record<string, unknown>): void {
  announcementSeq += 1;
  announcement = { key, params, id: announcementSeq };
  announceListeners.forEach((listener) => listener());
}

export function clearVoiceAnnouncement(key?: string): void {
  if (!announcement || (key && announcement.key !== key)) return;
  announcement = null;
  announceListeners.forEach((listener) => listener());
}

const subscribeAnnouncements = (listener: () => void) => {
  announceListeners.add(listener);
  return () => {
    announceListeners.delete(listener);
  };
};

export const voiceAnnouncement = (): Announcement | null => announcement;

export function useVoiceAnnouncement(): Announcement | null {
  return useSyncExternalStore(subscribeAnnouncements, () => announcement, () => announcement);
}

/** Test seam. */
export function resetVoiceUiStore(): void {
  notes.clear();
  announcement = null;
  emitNotes();
  announceListeners.forEach((listener) => listener());
}

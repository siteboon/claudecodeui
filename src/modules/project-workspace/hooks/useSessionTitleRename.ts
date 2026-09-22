import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

type UseSessionTitleRenameArgs = {
  /** The open session's id, or null when the header is not naming a session. */
  sessionId: string | null;
  /** The title the header shows; seeds the draft when editing starts. */
  currentTitle: string;
  /** Persists the title; resolves false when the backend refuses it. */
  onRenameSession: (sessionId: string, summary: string) => Promise<boolean>;
};

type SessionTitleDraft = {
  /** The session the draft was opened for, so it is never saved onto another. */
  sessionId: string;
  value: string;
  /** True while the save awaits the backend, so Enter cannot send it twice. */
  isSaving: boolean;
};

type SessionTitleRename = {
  isEditing: boolean;
  draft: string;
  isSaving: boolean;
  inputRef: RefObject<HTMLInputElement>;
  startEditing: () => void;
  updateDraft: (value: string) => void;
  cancelEditing: () => void;
  handleInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
};

/**
 * The inline rename behind the workspace header's session title: double-click
 * opens an input over the title, Enter saves, Escape or clicking away cancels.
 *
 * Mirrors the sidebar's rename: the draft is trimmed, an empty or unchanged
 * draft just closes the editor, and a refused or failed save is reported with
 * the same messages the sidebar uses.
 */
export function useSessionTitleRename({
  sessionId,
  currentTitle,
  onRenameSession,
}: UseSessionTitleRenameArgs): SessionTitleRename {
  const { t } = useTranslation();
  // The title being typed while the header is in edit mode; null means the
  // static title is shown. Held apart from the session itself so Escape can
  // drop the edit without touching state anything else reads.
  const [draft, setDraft] = useState<SessionTitleDraft | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A draft opened for a session the header no longer shows is ignored rather
  // than reset: switching sessions mid-edit must not save that text onto the
  // new one, and the next double-click starts a fresh draft anyway.
  const activeDraft = draft && draft.sessionId === sessionId ? draft : null;
  const isEditing = activeDraft !== null;

  // Put the caret in the input with the whole title selected, so typing
  // replaces it and a double-click straight into editing feels like one motion.
  useEffect(() => {
    if (!isEditing) {
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  const startEditing = useCallback(() => {
    if (!sessionId) {
      return;
    }
    setDraft({ sessionId, value: currentTitle, isSaving: false });
  }, [currentTitle, sessionId]);

  const updateDraft = useCallback((value: string) => {
    setDraft((previous) => (previous ? { ...previous, value } : previous));
  }, []);

  const cancelEditing = useCallback(() => {
    setDraft(null);
  }, []);

  const saveDraft = useCallback(async () => {
    if (!activeDraft || activeDraft.isSaving) {
      return;
    }

    const targetSessionId = activeDraft.sessionId;
    const trimmed = activeDraft.value.trim();
    if (!trimmed || trimmed === currentTitle) {
      setDraft(null);
      return;
    }

    setDraft({ ...activeDraft, isSaving: true });
    try {
      const renamed = await onRenameSession(targetSessionId, trimmed);
      if (!renamed) {
        alert(t('sidebar:messages.renameSessionFailed'));
      }
    } catch (error) {
      console.error('[Workspace] Error renaming session:', error);
      alert(t('sidebar:messages.renameSessionError'));
    } finally {
      // Only close this session's editor; a draft opened for another session
      // while the save was in flight belongs to that session.
      setDraft((previous) => (previous?.sessionId === targetSessionId ? null : previous));
    }
  }, [activeDraft, currentTitle, onRenameSession, t]);

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    // Keep the keystrokes from reaching the workspace's global shortcuts.
    event.stopPropagation();
    if (event.key === 'Enter') {
      // An Enter that only confirms an IME candidate (ja/ko/zh) is not a save.
      if (event.nativeEvent.isComposing) {
        return;
      }
      event.preventDefault();
      void saveDraft();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
    }
  }, [cancelEditing, saveDraft]);

  return {
    isEditing,
    draft: activeDraft?.value ?? '',
    isSaving: activeDraft?.isSaving ?? false,
    inputRef,
    startEditing,
    updateDraft,
    cancelEditing,
    handleInputKeyDown,
  };
}

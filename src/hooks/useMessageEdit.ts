import { useState, useCallback } from 'react';

interface EditState {
  messageIndex: number;
  originalContent: string;
  editedContent: string;
}

/**
 * Hook for managing message edit & resend state.
 * When a user clicks "Edit" on a message, this tracks which message
 * is being edited, the original and edited content.
 * The consumer (ChatInterface) is responsible for actually resending
 * via WebSocket and rewinding the conversation.
 */
export function useMessageEdit() {
  const [editState, setEditState] = useState<EditState | null>(null);

  const startEdit = useCallback((messageIndex: number, content: string) => {
    setEditState({
      messageIndex,
      originalContent: content,
      editedContent: content,
    });
  }, []);

  const updateEditContent = useCallback((content: string) => {
    setEditState((prev) => prev ? { ...prev, editedContent: content } : null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditState(null);
  }, []);

  const confirmEdit = useCallback(() => {
    const result = editState;
    setEditState(null);
    return result;
  }, [editState]);

  return {
    editState,
    isEditing: editState !== null,
    startEdit,
    updateEditContent,
    cancelEdit,
    confirmEdit,
  };
}

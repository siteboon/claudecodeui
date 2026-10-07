import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { CodeEditorFile } from '@/shared/types';
import { isBinaryFile } from '@/modules/code-editor/utils/binaryFile';
import { getPreviewKind } from '@/modules/code-editor/utils/previewableFile';

type UseCodeEditorDocumentParams = {
  file: CodeEditorFile;
  projectPath?: string;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

// CodeMirror reports its document with LF line endings whatever the file used,
// so a CRLF file would look edited from the first keystroke (and stay "edited"
// after an undo) unless both sides of the comparison are normalised.
const normalizeLineEndings = (text: string) => text.replace(/\r\n?/g, '\n');

const differsFromSaved = (text: string, saved: string) => (
  text !== saved && normalizeLineEndings(text) !== normalizeLineEndings(saved)
);

export const useCodeEditorDocument = ({ file, projectPath }: UseCodeEditorDocumentParams) => {
  const [content, setContentState] = useState('');
  // The text as last loaded from disk or written back by a save. The buffer is
  // compared against it to tell whether closing, switching files or reloading
  // would discard edits; nothing else in the app knows that baseline.
  const [savedContent, setSavedContentState] = useState('');
  // True when a reload was asked for and refused because the buffer had unsaved
  // changes. The editor turns it into a visible notice with a way out, so a
  // refused reload never looks like a reload that happened.
  const [unsavedChangesBlockedReload, setUnsavedChangesBlockedReload] = useState(false);
  // Counts explicit reload requests. The load effect keys on it so asking for
  // the same file again re-reads it instead of leaving a stale buffer on screen.
  const [reloadCount, setReloadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isBinary, setIsBinary] = useState(false);
  // Some binaries (images, PDFs, audio, video) can be rendered natively, so the
  // editor shows an inline preview instead of the generic binary placeholder.
  const previewKind = getPreviewKind(file.name);
  // `fileProjectId` is the DB primary key passed down from the editor sidebar;
  // the fallback to `projectPath` preserves older callers that didn't yet
  // propagate the identifier.
  const fileProjectId = file.projectId ?? projectPath;
  const filePath = file.path;
  const fileName = file.name;
  const fileDiffNewString = file.diffInfo?.new_string;
  const fileDiffOldString = file.diffInfo?.old_string;

  // Mirrors of the buffer and the saved baseline. The load effect has to read
  // them without depending on them, or it would re-read the file on every keystroke.
  const contentRef = useRef('');
  const savedContentRef = useRef('');
  // Which document the current buffer belongs to. A reload only has to protect
  // unsaved changes when the same document is being read again; opening a
  // different file has always replaced the buffer.
  const loadedDocumentKeyRef = useRef<string | null>(null);
  // A diff payload is its own document: the chat opening an edit on a file that
  // is already open must show that edit, not reuse the plain buffer.
  const diffKey = file.diffInfo ? JSON.stringify([fileDiffOldString, fileDiffNewString]) : '';
  const documentKey = `${fileProjectId ?? ''}::${filePath}::${diffKey}`;
  // Counts the loads this editor has performed. `api.readFile` cannot be
  // aborted, so a read or save still in flight when a newer load starts must not
  // land on the new buffer, baseline or save state.
  const loadGenerationRef = useRef(0);

  const setSavedContent = useCallback((text: string) => {
    savedContentRef.current = text;
    setSavedContentState(text);
  }, []);

  const setContent = useCallback((nextContent: string) => {
    contentRef.current = nextContent;
    setContentState(nextContent);
    // Typing is an answer to the notice: the person saw it and chose to keep
    // their changes, so it stops asking.
    setUnsavedChangesBlockedReload(false);
  }, []);

  // Used for text that comes from disk (or stands in for it), which leaves the
  // buffer clean: nothing to protect from the next reload.
  const setLoadedContent = useCallback((nextContent: string) => {
    contentRef.current = nextContent;
    setContentState(nextContent);
    setSavedContent(nextContent);
    setUnsavedChangesBlockedReload(false);
  }, [setSavedContent]);

  useEffect(() => {
    // Re-opening a file is a request to see what is on disk now, so this effect
    // keys on the `file` object — the editor sidebar builds a new one per open —
    // and on `reloadCount`, instead of on the path alone. Clicking the same
    // reference again used to change none of the dependencies, and the pane kept
    // showing the version from the first open even after the file had changed.
    const isSameDocument = loadedDocumentKeyRef.current === documentKey;
    const hasUnsavedChanges = differsFromSaved(contentRef.current, savedContentRef.current);

    // Re-reading here would silently throw away someone's edits. Refuse, and say
    // so; `reloadDiscardingChanges` is the deliberate way through.
    if (isSameDocument && hasUnsavedChanges) {
      setUnsavedChangesBlockedReload(true);
      return;
    }

    setUnsavedChangesBlockedReload(false);
    if (!isSameDocument) {
      // Until the new document arrives the buffer still holds the previous one,
      // whose edits were already given up by opening another file. Treat it as
      // clean so opening the new one again meanwhile is not refused.
      setSavedContent(contentRef.current);
    }
    loadedDocumentKeyRef.current = documentKey;
    const loadGeneration = ++loadGenerationRef.current;
    const isStaleLoad = () => loadGenerationRef.current !== loadGeneration;

    const loadFileContent = async () => {
      try {
        setLoading(true);
        setIsBinary(false);
        // Any save still in flight or failed belongs to the previous load.
        setSaving(false);
        setSaveError(null);

        // Natively previewable media (image/pdf/audio/video) is rendered by
        // CodeEditorMediaPreview, so there is nothing to read as text here.
        // Clear any buffer left over from a previously opened text file so a
        // stray save can't write stale content over the binary file.
        if (getPreviewKind(file.name)) {
          setLoadedContent('');
          setLoading(false);
          return;
        }

        // Check if file is binary by extension
        if (isBinaryFile(file.name)) {
          setLoadedContent('');
          setIsBinary(true);
          setLoading(false);
          return;
        }

        // Diff payload may already include full old/new snapshots, so avoid disk read.
        if (file.diffInfo && fileDiffNewString !== undefined && fileDiffOldString !== undefined) {
          setLoadedContent(fileDiffNewString);
          setLoading(false);
          return;
        }

        if (!fileProjectId) {
          throw new Error('Missing project identifier');
        }

        const response = await api.readFile(fileProjectId, filePath);
        // Read through readApiJson so the API's own explanation reaches the
        // pane — a directory, a path outside the project root, a missing file.
        // The bare status showed all of those as an opaque "403 Forbidden".
        const data = await readApiJson<{ content: string }>(response);
        if (isStaleLoad()) {
          return;
        }
        setLoadedContent(data.content);
      } catch (error) {
        if (isStaleLoad()) {
          return;
        }
        const message = getErrorMessage(error);
        console.error('Error loading file:', error);
        // The placeholder replaces the buffer, so it becomes the baseline too:
        // a failed read leaves nothing of the person's to protect, and the
        // editor must not report the message it just wrote as unsaved work.
        setLoadedContent(`// Error loading file: ${message}\n// File: ${fileName}\n// Path: ${filePath}`);
      } finally {
        if (!isStaleLoad()) {
          setLoading(false);
        }
      }
    };

    loadFileContent();
  }, [documentKey, file, fileDiffNewString, fileDiffOldString, fileName, filePath, fileProjectId, reloadCount, setLoadedContent, setSavedContent]);

  // Asks for the file to be read again. Unsaved changes still win: the request
  // comes back as the notice rather than as a silent overwrite.
  const reload = useCallback(() => {
    setReloadCount((previous) => previous + 1);
  }, []);

  // The way out of that notice, taken by hand: the unsaved buffer is dropped on
  // purpose, so the guard above has nothing left to protect.
  const reloadDiscardingChanges = useCallback(() => {
    contentRef.current = savedContentRef.current;
    setReloadCount((previous) => previous + 1);
  }, []);

  const handleSave = useCallback(async () => {
    // Preview-only and binary files have no editable text buffer; never write
    // them back (e.g. via Cmd/Ctrl+S) or we'd corrupt the file on disk.
    if (previewKind || isBinaryFile(fileName)) {
      return;
    }

    const saveGeneration = loadGenerationRef.current;
    const isStaleSave = () => loadGenerationRef.current !== saveGeneration;

    setSaving(true);
    setSaveError(null);

    try {
      if (!fileProjectId) {
        throw new Error('Missing project identifier');
      }

      const response = await api.saveFile(fileProjectId, filePath, content);

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Save failed: ${response.status}`);
        }

        const textError = await response.text();
        console.error('Non-JSON error response:', textError);
        throw new Error(`Save failed: ${response.status} ${response.statusText}`);
      }

      await response.json();

      // Another load started while this write was in flight: it owns the
      // buffer, the baseline, the notice and the save state now.
      if (isStaleSave()) {
        return;
      }

      // Baseline is the text that was actually sent: anything typed while the
      // request was in flight is still unsaved. It also makes the next reload harmless.
      setSavedContent(content);
      setUnsavedChangesBlockedReload(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      const message = getErrorMessage(error);
      console.error('Error saving file:', error);
      if (!isStaleSave()) {
        setSaveError(message);
      }
    } finally {
      if (!isStaleSave()) {
        setSaving(false);
      }
    }
  }, [content, filePath, fileProjectId, previewKind, fileName, setSavedContent]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = file.name;

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    URL.revokeObjectURL(url);
  }, [content, file.name]);

  // The baseline only changes on load and save, so it is not re-normalised on
  // every keystroke.
  const normalizedSavedContent = useMemo(() => normalizeLineEndings(savedContent), [savedContent]);

  // Preview and binary files have no editable buffer, and while a file loads
  // the buffer still belongs to the previous one. Memoised so renders that do
  // not change the buffer (a save's spinner and tick) skip the comparison.
  const hasUnsavedChanges = useMemo(
    () => (
      !loading
      && !previewKind
      && !isBinary
      && content !== savedContent
      && normalizeLineEndings(content) !== normalizedSavedContent
    ),
    [content, isBinary, loading, normalizedSavedContent, previewKind, savedContent],
  );

  return {
    content,
    setContent,
    unsavedChangesBlockedReload,
    reload,
    reloadDiscardingChanges,
    loading,
    saving,
    saveSuccess,
    saveError,
    isBinary,
    previewKind,
    fileProjectId,
    hasUnsavedChanges,
    handleSave,
    handleDownload,
  };
};

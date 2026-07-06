import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../utils/api';
import type { CodeEditorFile } from '../types/types';
import { isBinaryFile } from '../utils/binaryFile';
import { getPreviewKind } from '../utils/previewableFile';

type UseCodeEditorDocumentParams = {
  file: CodeEditorFile;
  projectPath?: string;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const useCodeEditorDocument = ({ file, projectPath }: UseCodeEditorDocumentParams) => {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isBinary, setIsBinary] = useState(false);
  const [savedContent, setSavedContent] = useState('');

  const previewKind = getPreviewKind(file.name);
  const fileProjectId = file.projectId ?? projectPath;
  const fileDiffNewString = file.diffInfo?.new_string;
  const fileDiffOldString = file.diffInfo?.old_string;

  useEffect(() => {
    const loadFileContent = async () => {
      try {
        setLoading(true);
        setSaveError(null);
        setIsBinary(false);

        if (previewKind) {
          setContent('');
          setSavedContent('');
          return;
        }

        if (isBinaryFile(file.name)) {
          setIsBinary(true);
          setContent('');
          setSavedContent('');
          return;
        }

        if (fileDiffNewString !== undefined && fileDiffOldString !== undefined) {
          setContent(fileDiffNewString);
          setSavedContent(fileDiffNewString);
          return;
        }

        if (!fileProjectId) {
          throw new Error('Missing project identifier');
        }

        const response = await api.readFile(fileProjectId, file.path);
        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const nextContent = String(data.content ?? '');
        setContent(nextContent);
        setSavedContent(nextContent);
      } catch (error) {
        const message = getErrorMessage(error);
        console.error('Error loading file:', error);
        const errorContent = `// Error loading file: ${message}\n// File: ${file.name}\n// Path: ${file.path}`;
        setContent(errorContent);
        setSavedContent(errorContent);
      } finally {
        setLoading(false);
      }
    };

    void loadFileContent();
  }, [file.name, file.path, fileDiffNewString, fileDiffOldString, fileProjectId, previewKind]);

  const handleSave = useCallback(async () => {
    if (file.diffInfo?.artifactPreview || previewKind || isBinaryFile(file.name)) {
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      if (!fileProjectId) {
        throw new Error('Missing project identifier');
      }

      const response = await api.saveFile(fileProjectId, file.path, content);
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
      setSavedContent(content);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      const message = getErrorMessage(error);
      console.error('Error saving file:', error);
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  }, [content, file.diffInfo?.artifactPreview, file.name, file.path, fileProjectId, previewKind]);

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

  return {
    content,
    setContent,
    loading,
    saving,
    saveSuccess,
    saveError,
    isBinary,
    previewKind,
    fileProjectId,
    isDirty: !file.diffInfo?.artifactPreview && !previewKind && !isBinary && content !== savedContent,
    handleSave,
    handleDownload,
  };
};

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../utils/api';
import { PRD_TEMPLATE } from '../constants';
import type { PrdFile } from '../types';
import { createDefaultPrdName, sanitizeFileName, stripPrdExtension } from '../utils/fileName';

type UsePrdDocumentArgs = {
  file?: PrdFile | null;
  isNewFile: boolean;
  initialContent: string;
  projectPath?: string;
};

type UsePrdDocumentResult = {
  content: string;
  setContent: (nextContent: string) => void;
  fileName: string;
  setFileName: (nextFileName: string) => void;
  loading: boolean;
  loadError: string | null;
};

export function usePrdDocument({
  file,
  isNewFile,
  initialContent,
  projectPath,
}: UsePrdDocumentArgs): UsePrdDocumentResult {
  const [content, setContent] = useState<string>(initialContent || '');
  const [fileName, setFileNameState] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(!isNewFile);
  const [loadError, setLoadError] = useState<string | null>(null);

  const setFileName = useCallback((nextFileName: string) => {
    setFileNameState(sanitizeFileName(nextFileName));
  }, []);

  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      const defaultName = file?.name
        ? stripPrdExtension(file.name)
        : createDefaultPrdName(new Date());

      if (isMounted) {
        setFileNameState(defaultName);
      }

      // Loading precedence:
      // 1) new file -> initial content or template
      // 2) provided content -> use it directly
      // 3) legacy file path -> fetch from API
      if (isNewFile) {
        if (!isMounted) {
          return;
        }

        setContent(initialContent || PRD_TEMPLATE);
        setLoadError(null);
        setLoading(false);
        return;
      }

      if (file?.content) {
        if (!isMounted) {
          return;
        }

        setContent(file.content);
        setLoadError(null);
        setLoading(false);
        return;
      }

      if (!file?.projectId || !file?.path) {
        if (!isMounted) {
          return;
        }

        setContent(initialContent || PRD_TEMPLATE);
        setLoadError(null);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

        // readFile uses the DB projectId to resolve the project's path server-side.
        const response = await api.readFile(file.projectId, file.path);
        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as { content?: string };
        if (!isMounted) {
          return;
        }

        setContent(data.content || PRD_TEMPLATE);
        setLoadError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (!isMounted) {
          return;
        }

        setContent(initialContent || PRD_TEMPLATE);
        setLoadError(`Unable to load file content: ${message}`);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void initialize();

    return () => {
      isMounted = false;
    };
  }, [file, initialContent, isNewFile, projectPath]);

  return {
    content,
    setContent,
    fileName,
    setFileName,
    loading,
    loadError,
  };
}

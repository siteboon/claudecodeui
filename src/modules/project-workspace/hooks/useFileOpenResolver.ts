import { useCallback, useRef } from 'react';

import { api } from '@/shared/api';
import type { Project } from '@/shared/types';

type FileNode = {
  type: 'file' | 'directory';
  name: string;
  path: string;
  children?: FileNode[];
};

type FlatFile = {
  name: string;
  path: string;
};

// `diffInfo` is intentionally `any` so this resolver can wrap editor handlers
// that expect a concrete diff payload type as well as generic callers.
type OnFileOpen = (filePath: string, diffInfo?: any, line?: number | null) => void;

const normalize = (value: string): string => value.replace(/\\/g, '/');

// Backslashes are already normalized above, so a Windows path arrives as
// `C:/…`; counting it as absolute lets a Windows server resolve it as-is and a
// POSIX one answer an honest 404 instead of opening some other file.
const isAbsoluteRef = (value: string): boolean => /^(\/|[A-Za-z]:\/)/.test(value);

const flatten = (nodes: FileNode[], out: FlatFile[]): void => {
  for (const node of nodes) {
    if (node.type === 'file') {
      out.push({ name: node.name, path: node.path });
    } else if (node.children && node.children.length > 0) {
      flatten(node.children, out);
    }
  }
};

// References inside chat messages are often bare basenames (`foo.ts`) or partial
// paths (`utils/foo.ts`) rather than full paths, so match by path suffix and
// fall back to filename equality.
const findBestMatch = (files: FlatFile[], ref: string): string | null => {
  const target = normalize(ref).replace(/^\.\//, '').replace(/^\/+/, '');
  if (!target) {
    return null;
  }

  const suffixMatch = files.find((file) => {
    const filePath = normalize(file.path);
    return filePath === target || filePath.endsWith(`/${target}`);
  });
  if (suffixMatch) {
    return suffixMatch.path;
  }

  const base = target.split('/').pop() || target;
  return files.find((file) => file.name === base)?.path ?? null;
};

/**
 * Wraps an `onFileOpen` handler so a possibly bare/partial file reference is
 * resolved against the project's file tree (cached per project) before the file
 * is opened in the in-app editor.
 */
export function useFileOpenResolver(
  selectedProject: Project | null | undefined,
  onFileOpen: OnFileOpen,
): OnFileOpen {
  const projectId = selectedProject?.projectId;
  const cacheRef = useRef<{ projectId?: string; files: Promise<FlatFile[]> | null }>({
    projectId: undefined,
    files: null,
  });

  const loadFiles = useCallback((): Promise<FlatFile[]> => {
    if (!projectId) {
      return Promise.resolve([]);
    }
    if (cacheRef.current.projectId === projectId && cacheRef.current.files) {
      return cacheRef.current.files;
    }

    const filesPromise = (async () => {
      try {
        const response = await api.getFiles(projectId);
        if (!response.ok) {
          return [];
        }
        const data = await response.json();
        const tree: FileNode[] = Array.isArray(data) ? data : [];
        const flat: FlatFile[] = [];
        flatten(tree, flat);
        return flat;
      } catch {
        return [];
      }
    })();

    cacheRef.current = { projectId, files: filesPromise };
    return filesPromise;
  }, [projectId]);

  return useCallback(
    (filePath: string, diffInfo?: any, line?: number | null) => {
      const ref = normalize(filePath).trim();
      // An absolute path already names one exact file: matching it against the
      // tree can only send it somewhere else. `/home/user/.config/NOTES.md`
      // used to fall through to the filename match and silently open the
      // project's own `NOTES.md`. An absolute path inside the project already
      // resolved to itself via the suffix match, so this shortcut does not
      // change that case; for one outside, the API answers "Path must be under
      // project root" and the editor now shows it.
      if (isAbsoluteRef(ref)) {
        onFileOpen(filePath, diffInfo, line);
        return;
      }
      void loadFiles().then((files) => {
        const match = findBestMatch(files, ref);
        onFileOpen(match ?? filePath, diffInfo, line);
      });
    },
    [loadFiles, onFileOpen],
  );
}

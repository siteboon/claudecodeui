import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageOff } from 'lucide-react';

import { api } from '@/shared/api';
import { useMarkdownWorkspaceProjectId } from '@/modules/chat/context/MarkdownWorkspaceContext';
import { ImageLightbox } from '@/modules/chat/transcript/ChatMessageImages';

type MarkdownImageProps = {
  node?: unknown;
  src?: string;
  alt?: string;
  title?: string;
};

// Sources the browser can load on its own. Anything else is a workspace file
// reference and has to go through the authenticated project files route.
const isBrowserLoadableSrc = (src: string): boolean => /^(https?:|data:|blob:)/i.test(src);

// Turn the markdown src into the path the file-tree route expects. Relative
// paths are resolved against the project root server-side; absolute paths are
// accepted as long as they stay inside it.
const toWorkspacePath = (src: string): string => {
  let workspacePath = src.trim();
  if (workspacePath.startsWith('file://')) {
    workspacePath = workspacePath.slice('file://'.length);
  }
  if (workspacePath.startsWith('./')) {
    workspacePath = workspacePath.slice(2);
  }
  try {
    workspacePath = decodeURI(workspacePath);
  } catch {
    // Keep the raw value when it is not valid percent-encoding.
  }
  return workspacePath;
};

type LoadedImage = { key: string; url: string | null; failed: boolean };

/**
 * Resolves a markdown image src to something an <img> can display. Web, data
 * and blob URLs pass through untouched; workspace paths are fetched as blobs
 * (a bare <img src> cannot carry the auth header) and exposed as object URLs.
 */
function useMarkdownImageSrc(src: string, projectId: string | null): { src: string | null; failed: boolean } {
  const passthrough = isBrowserLoadableSrc(src);
  // Keyed by what was requested so a src change reads as "loading" until the
  // new fetch settles, without resetting state synchronously in the effect.
  const key = `${projectId ?? ''}:${src}`;
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);

  useEffect(() => {
    if (passthrough || !projectId) {
      return;
    }

    let objectUrl: string | null = null;
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await api.readFileBlob(projectId, toWorkspacePath(src), { signal: controller.signal });
        if (!response.ok) {
          setLoaded({ key, url: null, failed: true });
          return;
        }
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ key, url: objectUrl, failed: false });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        setLoaded({ key, url: null, failed: true });
      }
    };

    void load();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [key, passthrough, projectId, src]);

  if (passthrough) {
    return { src, failed: false };
  }
  if (!projectId) {
    return { src: null, failed: true };
  }
  const current = loaded && loaded.key === key ? loaded : null;
  return { src: current?.url ?? null, failed: current?.failed ?? false };
}

/**
 * `img` renderer for chat markdown. Shows images the model references by
 * workspace path (screenshots it took, files it generated) inline, with the
 * same click-to-expand lightbox as user attachments. Used by the shared
 * Markdown component overrides.
 */
export function MarkdownImage({ node: _node, src, alt, title }: MarkdownImageProps) {
  const { t } = useTranslation();
  const projectId = useMarkdownWorkspaceProjectId();
  const source = src ?? '';
  const { src: resolved, failed } = useMarkdownImageSrc(source, projectId);
  const [expanded, setExpanded] = useState(false);

  if (!source) {
    return null;
  }

  const label = alt || title || source;

  if (failed) {
    return (
      <span
        className="my-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-muted px-2 py-1 text-xs text-muted-foreground"
        title={source}
      >
        <ImageOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
    );
  }

  if (!resolved) {
    return <span className="my-2 block h-40 max-w-md animate-pulse rounded-xl border border-border/50 bg-muted" />;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={t('chat:misc.expandImage', { name: label })}
        className="my-2 block max-w-full overflow-hidden rounded-xl border border-border/50 bg-muted/30 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
      >
        <img
          src={resolved}
          alt={alt ?? ''}
          title={title}
          loading="lazy"
          className="block max-h-96 max-w-full cursor-zoom-in object-contain"
        />
      </button>
      {expanded && <ImageLightbox src={resolved} alt={label} onClose={() => setExpanded(false)} />}
    </>
  );
}

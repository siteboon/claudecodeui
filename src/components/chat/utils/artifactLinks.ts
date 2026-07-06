const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif']);
const HTML_EXTENSIONS = new Set(['html', 'htm']);

export type ArtifactLinkKind = 'image' | 'html';

const isExternalHref = (value: string): boolean =>
  /^(https?:|mailto:|tel:|data:|#)/i.test(value);

export const stripArtifactLineSuffix = (value: string): string =>
  value.trim().replace(/:\d+(?::\d+)?$/, '');

export function getArtifactLinkKind(value?: string): ArtifactLinkKind | null {
  if (!value) return null;

  const cleaned = stripArtifactLineSuffix(value);
  if (!cleaned || isExternalHref(cleaned)) return null;

  const extension = cleaned.split('?')[0]?.split('#')[0]?.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (HTML_EXTENSIONS.has(extension)) return 'html';
  return null;
}

export const isArtifactLink = (value?: string): boolean =>
  getArtifactLinkKind(value) !== null;

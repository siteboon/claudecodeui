// Helpers to serve filesystem images through the existing
// /api/projects/:projectId/files/content endpoint.

const IMAGE_EXT_REGEX = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;

export function isImagePath(p: string): boolean {
  return IMAGE_EXT_REGEX.test(p.trim());
}

export function buildFileUrl(absolutePath: string, projectId: string | number): string {
  const token = localStorage.getItem('auth-token') || '';
  const params = new URLSearchParams({ path: absolutePath });
  if (token) params.set('token', token);
  return `/api/projects/${projectId}/files/content?${params.toString()}`;
}

// Marker block emitted by claude-sdk.js when uploading images:
//   "[Images provided at the following paths:]\n1. /abs/path/a.png\n2. /abs/path/b.png"
const PROVIDED_IMAGES_BLOCK = /\n*\[Images provided at the following paths:\]\n((?:\d+\.\s*\S+\n?)+)/;

export type ParsedUserContent = {
  text: string;            // content with the [Images provided] block stripped
  imagePaths: string[];    // absolute filesystem paths extracted from the block
};

export function parseUserContentForImages(content: string): ParsedUserContent {
  const match = content.match(PROVIDED_IMAGES_BLOCK);
  if (!match) return { text: content, imagePaths: [] };
  const block = match[1] || '';
  const paths = block
    .split(/\n/)
    .map((line) => line.replace(/^\s*\d+\.\s*/, '').trim())
    .filter(Boolean);
  const text = content.replace(PROVIDED_IMAGES_BLOCK, '').trim();
  return { text, imagePaths: paths };
}

// Detect raw absolute image paths in markdown text and rewrite them as ![name](apiUrl).
// Skips paths already inside markdown image/link syntax or fenced code.
export function transformImagePathsToMarkdown(text: string, projectId: string | number | undefined): string {
  if (!projectId) return text;

  // Split out fenced code blocks; do not touch their contents.
  const segments = text.split(/(```[\s\S]*?```|`[^`]*`)/g);

  return segments
    .map((seg, idx) => {
      // odd indices are code segments — leave alone
      if (idx % 2 === 1) return seg;

      // Match absolute paths or ./relative paths ending in an image extension.
      // Avoid matching paths already inside markdown image syntax ![...](...)
      // or link syntax [...](...) by requiring path NOT immediately preceded by `(`.
      return seg.replace(
        /(^|[^(\w])((?:\/|\.{0,2}\/)[^\s)<>'"]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico))/gi,
        (_full, prefix: string, p: string) => {
          const name = p.split('/').pop() || 'image';
          const url = buildFileUrl(p, projectId);
          return `${prefix}![${name}](${url})`;
        },
      );
    })
    .join('');
}

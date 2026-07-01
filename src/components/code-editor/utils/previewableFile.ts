// Some binary files can't be edited as text, but the browser can still render
// them natively (images, PDFs, audio, video). For those we show an inline
// preview instead of the generic "binary file" placeholder. Anything not listed
// here (zip, exe, avi, mkv, fonts, ...) falls through to the binary message.

export type PreviewKind = 'image' | 'pdf' | 'video' | 'audio';

// Single source of truth: every extension the browser can preview, mapped to the
// MIME type we apply when the server response has a missing/generic Content-Type.
// The preview kind is derived from the MIME type so the two never drift apart.
// Formats browsers generally can't play (avi, mkv, flv, wmv) are intentionally
// absent and keep the binary fallback.
const EXTENSION_MIME: Record<string, string> = {
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  avif: 'image/avif',
  apng: 'image/apng',
  // PDF
  pdf: 'application/pdf',
  // Video
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  opus: 'audio/opus',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  weba: 'audio/webm',
};

const extensionOf = (filename: string): string => filename.split('.').pop()?.toLowerCase() ?? '';

const kindForMime = (mime: string): PreviewKind | null => {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
};

export const getPreviewKind = (filename: string): PreviewKind | null => {
  const mime = EXTENSION_MIME[extensionOf(filename)];
  return mime ? kindForMime(mime) : null;
};

// MIME type to fall back to when the server returns no/generic Content-Type.
// Returns undefined for non-previewable extensions.
export const getPreviewMimeType = (filename: string): string | undefined =>
  EXTENSION_MIME[extensionOf(filename)];

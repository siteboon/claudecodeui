// Some binary files can't be edited as text, but the browser can still render
// them natively (images, PDFs, audio, video). For those we show an inline
// preview instead of the generic "binary file" placeholder. Anything not listed
// here (zip, exe, avi, mkv, fonts, ...) falls through to the binary message.

export type PreviewKind = 'image' | 'pdf' | 'video' | 'audio';

// Formats browsers can decode in <img>.
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif', 'apng',
]);

const PDF_EXTENSIONS = new Set(['pdf']);

// Container/codec combos broadly playable in <video>. Intentionally excludes
// formats browsers generally can't play (avi, mkv, flv, wmv).
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v']);

// Formats broadly playable in <audio>.
const AUDIO_EXTENSIONS = new Set([
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'opus', 'oga', 'ogg', 'weba',
]);

export const getPreviewKind = (filename: string): PreviewKind | null => {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (PDF_EXTENSIONS.has(ext)) return 'pdf';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return null;
};

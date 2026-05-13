const IMAGE_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp',
];

const PDF_EXTENSIONS = ['pdf'];

// Truly unviewable binary formats (no in-browser preview possible)
const BINARY_EXTENSIONS = [
  // Archives
  'zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz',
  // Executables
  'exe', 'dll', 'so', 'dylib', 'app', 'dmg', 'msi',
  // Media (audio/video — could be previewable, but not in scope yet)
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'm4a', 'ogg',
  // Documents (non-PDF)
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  // Fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // Database
  'db', 'sqlite', 'sqlite3',
  // Other binary
  'bin', 'dat', 'iso', 'img', 'class', 'jar', 'war', 'pyc', 'pyo',
];

const getExt = (filename: string): string =>
  (filename.split('.').pop() ?? '').toLowerCase();

export const isImageFile = (filename: string): boolean =>
  IMAGE_EXTENSIONS.includes(getExt(filename));

export const isPdfFile = (filename: string): boolean =>
  PDF_EXTENSIONS.includes(getExt(filename));

export const isBinaryFile = (filename: string): boolean =>
  BINARY_EXTENSIONS.includes(getExt(filename));

export type FileCategory = 'text' | 'image' | 'pdf' | 'binary';

export const getFileCategory = (filename: string): FileCategory => {
  if (isImageFile(filename)) return 'image';
  if (isPdfFile(filename)) return 'pdf';
  if (isBinaryFile(filename)) return 'binary';
  return 'text';
};

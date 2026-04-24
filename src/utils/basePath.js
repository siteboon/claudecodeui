const rawBaseUrl = import.meta.env.BASE_URL || '/';

export const BASE_PATH = rawBaseUrl === '/' ? '' : rawBaseUrl.replace(/\/$/, '');

export function withBasePath(path = '/') {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return BASE_PATH ? `${BASE_PATH}${normalizedPath}` : normalizedPath;
}


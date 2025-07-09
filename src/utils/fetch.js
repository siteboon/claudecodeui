// Wrapper for fetch that always includes credentials
export async function fetchWithCredentials(url, options = {}) {
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...options.headers,
    }
  });
}
export const getLocalStorageItem = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const setLocalStorageItem = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences remain in memory when browser storage is unavailable.
  }
};

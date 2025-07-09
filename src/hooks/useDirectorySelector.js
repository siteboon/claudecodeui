import { useState, useCallback, useEffect } from 'react';

// Storage keys
const STORAGE_KEYS = {
  RECENT_PATHS: 'claude-ui-recent-paths',
  FAVORITES: 'claude-ui-favorite-paths',
  LAST_PATH: 'claude-ui-last-path',
  SETTINGS: 'claude-ui-directory-settings'
};

// Storage utilities
const storage = {
  get: (key) => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Silently fail if storage is not available
    }
  }
};

// Platform detection
const getPlatformInfo = () => {
  const userAgent = navigator.userAgent;
  const platform = navigator.platform;
  
  return {
    isMobile: /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent),
    isDesktop: !(/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)),
    isMac: platform.includes('Mac'),
    isWindows: platform.includes('Win'),
    isLinux: platform.includes('Linux'),
    hasNativeFilePicker: 'showDirectoryPicker' in window,
    hasFileSystemAccess: 'showDirectoryPicker' in window && 'FileSystemHandle' in window
  };
};

// Directory validation
const validateDirectory = async (path) => {
  try {
    const response = await fetch(`/api/projects/validate?path=${encodeURIComponent(path)}`);
    return await response.json();
  } catch (error) {
    return {
      valid: false,
      issues: [`Failed to validate: ${error.message}`],
      suggestions: []
    };
  }
};

// Browse directory
const browseDirectory = async (path) => {
  try {
    const response = await fetch(`/api/projects/browse?path=${encodeURIComponent(path)}`);
    const data = await response.json();
    
    if (response.ok) {
      return { success: true, data };
    } else {
      return { success: false, error: data.error || 'Failed to browse directory' };
    }
  } catch (error) {
    return { success: false, error: error.message || 'Failed to browse directory' };
  }
};

// Main hook
export const useDirectorySelector = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState('/');
  const [selectedPath, setSelectedPath] = useState(null);
  const [recentPaths, setRecentPaths] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [settings, setSettings] = useState({
    showHiddenFiles: false,
    sortBy: 'name', // 'name', 'modified', 'size'
    sortOrder: 'asc', // 'asc', 'desc'
    viewMode: 'list' // 'list', 'grid'
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const platformInfo = getPlatformInfo();
  
  // Load persisted data
  useEffect(() => {
    const loadedRecent = storage.get(STORAGE_KEYS.RECENT_PATHS) || [];
    const loadedFavorites = storage.get(STORAGE_KEYS.FAVORITES) || [];
    const lastPath = storage.get(STORAGE_KEYS.LAST_PATH) || '/';
    const loadedSettings = storage.get(STORAGE_KEYS.SETTINGS) || settings;
    
    setRecentPaths(loadedRecent);
    setFavorites(loadedFavorites);
    setCurrentPath(lastPath);
    setSettings(loadedSettings);
  }, []);
  
  // Save settings
  useEffect(() => {
    storage.set(STORAGE_KEYS.SETTINGS, settings);
  }, [settings]);
  
  // Open directory selector
  const openSelector = useCallback(() => {
    setIsOpen(true);
    setError(null);
  }, []);
  
  // Close directory selector
  const closeSelector = useCallback(() => {
    setIsOpen(false);
    setSelectedPath(null);
    setError(null);
  }, []);
  
  // Navigate to directory
  const navigateToDirectory = useCallback(async (path) => {
    setIsLoading(true);
    setError(null);
    
    const result = await browseDirectory(path);
    
    if (result.success) {
      setCurrentPath(result.data.path || path);
      storage.set(STORAGE_KEYS.LAST_PATH, result.data.path || path);
    } else {
      setError(result.error);
    }
    
    setIsLoading(false);
    return result;
  }, []);
  
  // Add to recent paths
  const addToRecentPaths = useCallback((path) => {
    setRecentPaths(prev => {
      const item = {
        path,
        name: path.split('/').pop() || path,
        type: 'directory',
        accessedAt: new Date().toISOString()
      };
      
      const updated = [
        item,
        ...prev.filter(recent => recent.path !== path)
      ].slice(0, 10); // Keep only last 10
      
      storage.set(STORAGE_KEYS.RECENT_PATHS, updated);
      return updated;
    });
  }, []);
  
  // Add to favorites
  const addToFavorites = useCallback((path, name) => {
    setFavorites(prev => {
      const item = {
        path,
        name: name || path.split('/').pop() || path,
        type: 'directory',
        addedAt: new Date().toISOString()
      };
      
      const updated = [...prev, item];
      storage.set(STORAGE_KEYS.FAVORITES, updated);
      return updated;
    });
  }, []);
  
  // Remove from favorites
  const removeFromFavorites = useCallback((path) => {
    setFavorites(prev => {
      const updated = prev.filter(fav => fav.path !== path);
      storage.set(STORAGE_KEYS.FAVORITES, updated);
      return updated;
    });
  }, []);
  
  // Toggle favorite
  const toggleFavorite = useCallback((path, name) => {
    const isFavorite = favorites.some(fav => fav.path === path);
    if (isFavorite) {
      removeFromFavorites(path);
    } else {
      addToFavorites(path, name);
    }
  }, [favorites, addToFavorites, removeFromFavorites]);
  
  // Select directory
  const selectDirectory = useCallback((path) => {
    setSelectedPath(path);
    addToRecentPaths(path);
  }, [addToRecentPaths]);
  
  // Validate and select directory
  const validateAndSelectDirectory = useCallback(async (path) => {
    setIsLoading(true);
    const validation = await validateDirectory(path);
    setIsLoading(false);
    
    if (validation.valid) {
      selectDirectory(path);
      return { success: true, validation };
    } else {
      setError(validation.issues[0] || 'Invalid directory');
      return { success: false, validation };
    }
  }, [selectDirectory]);
  
  // Open with native file picker
  const openNativeFilePicker = useCallback(async () => {
    if (!platformInfo.hasNativeFilePicker) {
      setError('Native file picker not supported in this browser');
      return { success: false };
    }
    
    try {
      const dirHandle = await window.showDirectoryPicker();
      
      // Note: Browser security limits prevent getting the full path
      // We can only get the directory name
      const path = dirHandle.name;
      const result = await validateAndSelectDirectory(path);
      
      if (result.success) {
        return { success: true, path, handle: dirHandle };
      } else {
        return { success: false, error: result.validation.issues[0] };
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        return { success: false, cancelled: true };
      } else {
        setError(error.message);
        return { success: false, error: error.message };
      }
    }
  }, [platformInfo.hasNativeFilePicker, validateAndSelectDirectory]);
  
  // Clear recent paths
  const clearRecentPaths = useCallback(() => {
    setRecentPaths([]);
    storage.set(STORAGE_KEYS.RECENT_PATHS, []);
  }, []);
  
  // Clear favorites
  const clearFavorites = useCallback(() => {
    setFavorites([]);
    storage.set(STORAGE_KEYS.FAVORITES, []);
  }, []);
  
  // Update settings
  const updateSettings = useCallback((newSettings) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  }, []);
  
  // Get sorted and filtered items
  const getSortedItems = useCallback((items) => {
    let filtered = items;
    
    // Filter hidden files if setting is disabled
    if (!settings.showHiddenFiles) {
      filtered = filtered.filter(item => !item.name.startsWith('.'));
    }
    
    // Sort items
    filtered.sort((a, b) => {
      let comparison = 0;
      
      // Always show directories first
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      
      switch (settings.sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'modified':
          comparison = new Date(a.modified || 0) - new Date(b.modified || 0);
          break;
        case 'size':
          comparison = (a.size || 0) - (b.size || 0);
          break;
        default:
          comparison = a.name.localeCompare(b.name);
      }
      
      return settings.sortOrder === 'desc' ? -comparison : comparison;
    });
    
    return filtered;
  }, [settings]);
  
  // Check if path is favorite
  const isFavorite = useCallback((path) => {
    return favorites.some(fav => fav.path === path);
  }, [favorites]);
  
  return {
    // State
    isOpen,
    currentPath,
    selectedPath,
    recentPaths,
    favorites,
    settings,
    isLoading,
    error,
    platformInfo,
    
    // Actions
    openSelector,
    closeSelector,
    navigateToDirectory,
    selectDirectory,
    validateAndSelectDirectory,
    openNativeFilePicker,
    toggleFavorite,
    addToFavorites,
    removeFromFavorites,
    clearRecentPaths,
    clearFavorites,
    updateSettings,
    
    // Utilities
    getSortedItems,
    isFavorite,
    
    // Reset error
    clearError: () => setError(null)
  };
};

export default useDirectorySelector;
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { 
  Folder, 
  FolderOpen, 
  FolderCheck,
  Home, 
  ChevronRight, 
  Star, 
  StarOff,
  History,
  CheckCircle,
  AlertCircle,
  Loader2,
  X,
  Search,
  HardDrive,
  Monitor,
  Smartphone,
  ArrowUp,
  RefreshCw
} from 'lucide-react';
import { cn } from '../lib/utils';

// Storage keys for persistence
const STORAGE_KEYS = {
  RECENT_PATHS: 'claude-ui-recent-paths',
  FAVORITES: 'claude-ui-favorite-paths',
  LAST_PATH: 'claude-ui-last-path'
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
    hasNativeFilePicker: 'showDirectoryPicker' in window
  };
};

// Default paths based on platform
const getDefaultPaths = () => {
  const { isMac, isWindows } = getPlatformInfo();
  
  if (isMac) {
    return [
      { path: '/Users', name: 'Users', icon: Home },
      { path: '/Users/' + (window.navigator.userAgent.includes('Chrome') ? 'username' : 'your-username'), name: 'Home', icon: Home },
      { path: '/Users/' + (window.navigator.userAgent.includes('Chrome') ? 'username' : 'your-username') + '/Documents', name: 'Documents', icon: Folder },
      { path: '/Users/' + (window.navigator.userAgent.includes('Chrome') ? 'username' : 'your-username') + '/Documents/GitHub', name: 'GitHub', icon: Folder },
      { path: '/Users/' + (window.navigator.userAgent.includes('Chrome') ? 'username' : 'your-username') + '/Desktop', name: 'Desktop', icon: Folder },
      { path: '/Applications', name: 'Applications', icon: Folder }
    ];
  } else if (isWindows) {
    return [
      { path: 'C:\\', name: 'C: Drive', icon: HardDrive },
      { path: 'C:\\Users', name: 'Users', icon: Home },
      { path: 'C:\\Users\\username', name: 'Home', icon: Home },
      { path: 'C:\\Users\\username\\Documents', name: 'Documents', icon: Folder },
      { path: 'C:\\Users\\username\\Documents\\GitHub', name: 'GitHub', icon: Folder },
      { path: 'C:\\Users\\username\\Desktop', name: 'Desktop', icon: Folder }
    ];
  } else {
    return [
      { path: '/', name: 'Root', icon: HardDrive },
      { path: '/home', name: 'Home', icon: Home },
      { path: '/home/username', name: 'User Home', icon: Home },
      { path: '/home/username/Documents', name: 'Documents', icon: Folder },
      { path: '/home/username/Projects', name: 'Projects', icon: Folder }
    ];
  }
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

// Breadcrumb component
const Breadcrumb = ({ path, onNavigate, className }) => {
  const parts = path.split('/').filter(Boolean);
  const { isWindows } = getPlatformInfo();
  
  // Handle Windows paths
  if (isWindows && path.includes('\\')) {
    const windowsParts = path.split('\\').filter(Boolean);
    return (
      <div className={cn("flex items-center gap-1 text-sm", className)}>
        <button
          onClick={() => onNavigate('C:\\')}
          className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-accent transition-colors"
        >
          <HardDrive className="w-3 h-3" />
          <span>C:</span>
        </button>
        {windowsParts.slice(1).map((part, index) => (
          <React.Fragment key={index}>
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
            <button
              onClick={() => onNavigate(windowsParts.slice(0, index + 2).join('\\') + '\\')}
              className="px-2 py-1 rounded-md hover:bg-accent transition-colors truncate max-w-[120px]"
            >
              {part}
            </button>
          </React.Fragment>
        ))}
      </div>
    );
  }
  
  // Handle Unix paths
  return (
    <div className={cn("flex items-center gap-1 text-sm", className)}>
      <button
        onClick={() => onNavigate('/')}
        className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-accent transition-colors"
      >
        <Home className="w-3 h-3" />
        <span>/</span>
      </button>
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
          <button
            onClick={() => onNavigate('/' + parts.slice(0, index + 1).join('/'))}
            className="px-2 py-1 rounded-md hover:bg-accent transition-colors truncate max-w-[120px]"
          >
            {part}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};

// Directory item component
const DirectoryItem = ({ item, onSelect, onToggleFavorite, isFavorite, isSelected, isFocused, itemIndex }) => {
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState(null);
  
  const handleSelect = useCallback(async () => {
    if (item.type === 'directory') {
      setIsValidating(true);
      try {
        const response = await fetch(`/api/projects/validate?path=${encodeURIComponent(item.path)}`);
        const validation = await response.json();
        setValidationStatus(validation);
        
        if (validation.valid) {
          onSelect(item);
        }
      } catch (error) {
        console.error('Validation error:', error);
        setValidationStatus({ valid: false, issues: ['Failed to validate directory'] });
      } finally {
        setIsValidating(false);
      }
    }
  }, [item, onSelect]);
  
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all duration-200",
        "hover:bg-accent/50 hover:border-accent active:scale-[0.98] active:bg-accent/70",
        "md:p-3 sm:p-4 sm:gap-4", // Better mobile spacing
        "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
        isSelected && "bg-accent border-accent-foreground/20",
        isFocused && "ring-2 ring-primary ring-offset-2 bg-accent/30",
        validationStatus?.valid && "border-green-500/30 bg-green-50/30 dark:bg-green-900/10",
        validationStatus?.valid === false && "border-red-500/30 bg-red-50/30 dark:bg-red-900/10"
      )}
      onClick={handleSelect}
      onTouchStart={() => {}} // Improve touch responsiveness
      role="option"
      aria-selected={isSelected}
      aria-describedby={`item-description-${itemIndex}`}
      tabIndex={isFocused ? 0 : -1}
    >
      {/* Icon */}
      <div className="flex-shrink-0">
        {isValidating ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        ) : validationStatus?.valid ? (
          <FolderCheck className="w-5 h-5 text-green-600" />
        ) : validationStatus?.valid === false ? (
          <Folder className="w-5 h-5 text-red-500" />
        ) : (
          <Folder className="w-5 h-5 text-muted-foreground" />
        )}
      </div>
      
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-foreground truncate">{item.name}</h3>
          {validationStatus?.type && (
            <Badge variant="secondary" className="text-xs">
              {validationStatus.type}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">{item.path}</p>
        
        {/* Validation feedback */}
        {validationStatus && (
          <div className="mt-2 text-xs">
            {validationStatus.valid ? (
              <div className="flex items-center gap-1 text-green-600">
                <CheckCircle className="w-3 h-3" />
                <span>Valid project directory</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-red-600">
                <AlertCircle className="w-3 h-3" />
                <span>{validationStatus.issues[0] || 'Invalid directory'}</span>
              </div>
            )}
            {validationStatus.suggestions && validationStatus.suggestions.length > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                {validationStatus.suggestions.join(', ')}
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(item);
          }}
          className="p-1 rounded-md hover:bg-accent transition-colors"
        >
          {isFavorite ? (
            <Star className="w-4 h-4 text-yellow-500 fill-current" />
          ) : (
            <StarOff className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
      </div>
      
      {/* Screen reader description */}
      <div id={`item-description-${itemIndex}`} className="sr-only">
        {item.type === 'directory' ? 'Directory' : 'File'}: {item.name} at {item.path}.
        {validationStatus?.valid && ' Valid project directory.'}
        {validationStatus?.valid === false && ` ${validationStatus.issues[0]}`}
        {isFavorite ? ' In favorites.' : ' Not in favorites.'}
      </div>
    </div>
  );
};

// Main DirectorySelector component
const DirectorySelector = ({ isOpen, onClose, onSelect }) => {
  const [currentPath, setCurrentPath] = useState('/');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPath, setSelectedPath] = useState(null);
  const [recentPaths, setRecentPaths] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [view, setView] = useState('browser'); // 'browser', 'recent', 'favorites'
  const [isDragOver, setIsDragOver] = useState(false);
  const [focusedItemIndex, setFocusedItemIndex] = useState(-1);
  
  const platformInfo = getPlatformInfo();
  const defaultPaths = getDefaultPaths();
  
  // Load persisted data
  useEffect(() => {
    const loadedRecent = storage.get(STORAGE_KEYS.RECENT_PATHS) || [];
    const loadedFavorites = storage.get(STORAGE_KEYS.FAVORITES) || [];
    const lastPath = storage.get(STORAGE_KEYS.LAST_PATH) || '/';
    
    setRecentPaths(loadedRecent);
    setFavorites(loadedFavorites);
    setCurrentPath(lastPath);
  }, []);
  
  // Browse directory
  const browseDirectory = useCallback(async (path) => {
    if (!path) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/projects/browse?path=${encodeURIComponent(path)}`);
      const data = await response.json();
      
      if (response.ok) {
        setItems(data.items || []);
        setCurrentPath(data.path || path);
        storage.set(STORAGE_KEYS.LAST_PATH, data.path || path);
      } else {
        setError(data.error || 'Failed to browse directory');
      }
    } catch (err) {
      setError(err.message || 'Failed to browse directory');
    } finally {
      setLoading(false);
    }
  }, []);
  
  // Initial load
  useEffect(() => {
    if (isOpen) {
      browseDirectory(currentPath);
    }
  }, [isOpen, browseDirectory, currentPath]);
  
  // Navigate to directory
  const navigateToDirectory = useCallback((path) => {
    setView('browser');
    browseDirectory(path);
  }, [browseDirectory]);
  
  // Toggle favorite
  const toggleFavorite = useCallback((item) => {
    setFavorites(prev => {
      const isFavorite = prev.some(fav => fav.path === item.path);
      const updated = isFavorite
        ? prev.filter(fav => fav.path !== item.path)
        : [...prev, { ...item, addedAt: new Date().toISOString() }];
      
      storage.set(STORAGE_KEYS.FAVORITES, updated);
      return updated;
    });
  }, []);
  
  // Select directory
  const selectDirectory = useCallback((item) => {
    setSelectedPath(item.path);
    
    // Add to recent paths
    setRecentPaths(prev => {
      const updated = [
        { ...item, accessedAt: new Date().toISOString() },
        ...prev.filter(recent => recent.path !== item.path)
      ].slice(0, 10); // Keep only last 10
      
      storage.set(STORAGE_KEYS.RECENT_PATHS, updated);
      return updated;
    });
  }, []);
  
  // Handle native file picker
  const handleNativeFilePicker = useCallback(async () => {
    if (!platformInfo.hasNativeFilePicker) return;
    
    try {
      const dirHandle = await window.showDirectoryPicker();
      const item = {
        name: dirHandle.name,
        path: dirHandle.name, // Note: This is limited in browser
        type: 'directory'
      };
      
      selectDirectory(item);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Native file picker error:', error);
      }
    }
  }, [platformInfo.hasNativeFilePicker, selectDirectory]);
  
  // Confirm selection
  const confirmSelection = useCallback(() => {
    if (selectedPath) {
      onSelect(selectedPath);
      onClose();
    }
  }, [selectedPath, onSelect, onClose]);
  
  // Handle drag and drop for desktop
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (platformInfo.isDesktop) {
      setIsDragOver(true);
    }
  }, [platformInfo.isDesktop]);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (!platformInfo.isDesktop) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const file = files[0];
      
      // Try to get directory path from webkitRelativePath or path
      let dirPath = '';
      if (file.webkitRelativePath) {
        // If it's from a directory upload
        dirPath = file.webkitRelativePath.split('/')[0];
      } else if (file.path) {
        // Electron-style file path
        dirPath = file.path.substring(0, file.path.lastIndexOf('/'));
      }
      
      if (dirPath) {
        const item = {
          name: dirPath.split('/').pop() || dirPath,
          path: dirPath,
          type: 'directory'
        };
        selectDirectory(item);
      }
    }
  }, [platformInfo.isDesktop, selectDirectory]);

  // Keyboard navigation handler
  const handleKeyDown = useCallback((e) => {
    const currentItems = view === 'browser' ? filteredItems.filter(item => item.type === 'directory') :
                        view === 'recent' ? recentPaths :
                        favorites;

    switch (e.key) {
      case 'Escape':
        onClose();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setFocusedItemIndex(prev => Math.min(prev + 1, currentItems.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedItemIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedItemIndex >= 0 && focusedItemIndex < currentItems.length) {
          selectDirectory(currentItems[focusedItemIndex]);
        } else if (selectedPath) {
          confirmSelection();
        }
        break;
      case 'Tab':
        if (view === 'browser' && e.shiftKey) {
          e.preventDefault();
          setView('favorites');
        } else if (view === 'browser' && !e.shiftKey) {
          e.preventDefault();
          setView('recent');
        } else if (view === 'recent' && e.shiftKey) {
          e.preventDefault();
          setView('browser');
        } else if (view === 'recent' && !e.shiftKey) {
          e.preventDefault();
          setView('favorites');
        } else if (view === 'favorites' && e.shiftKey) {
          e.preventDefault();
          setView('recent');
        } else if (view === 'favorites' && !e.shiftKey) {
          e.preventDefault();
          setView('browser');
        }
        break;
      case 'Home':
        e.preventDefault();
        setFocusedItemIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusedItemIndex(currentItems.length - 1);
        break;
    }
  }, [view, filteredItems, recentPaths, favorites, focusedItemIndex, selectedPath, onClose, selectDirectory, confirmSelection]);

  // Reset focused item when view changes
  useEffect(() => {
    setFocusedItemIndex(-1);
  }, [view]);

  // Filter items
  const filteredItems = items.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.path.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  if (!isOpen) return null;
  
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="directory-selector-title"
      aria-describedby="directory-selector-description"
    >
      <div 
        className={cn(
          "w-full max-w-4xl max-h-[90vh] mx-4 bg-card rounded-lg border shadow-xl md:max-h-[85vh] md:mx-8 sm:max-h-[95vh] sm:mx-2 transition-all duration-200",
          isDragOver && platformInfo.isDesktop && "border-primary border-2 bg-primary/5"
        )}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {platformInfo.isMobile ? (
                <Smartphone className="w-5 h-5 text-primary" />
              ) : (
                <Monitor className="w-5 h-5 text-primary" />
              )}
              <h2 id="directory-selector-title" className="text-lg font-semibold md:text-lg sm:text-base">Select Project Directory</h2>
            </div>
            <Badge variant="outline" className="text-xs hidden md:inline-flex">
              {platformInfo.isMac ? 'macOS' : platformInfo.isWindows ? 'Windows' : 'Linux'}
            </Badge>
          </div>
          
          <div className="flex items-center gap-2">
            {platformInfo.hasNativeFilePicker && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleNativeFilePicker}
                className="hidden md:flex"
              >
                <FolderOpen className="w-4 h-4 mr-2" />
                Native Picker
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="w-8 h-8 p-0"
              aria-label="Close directory selector"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        {/* Hidden description for screen readers */}
        <div id="directory-selector-description" className="sr-only">
          Use arrow keys to navigate through directories, Enter to select, Escape to close, and Tab to switch between views.
        </div>

        {/* Navigation */}
        <div className="p-4 border-b space-y-3">
          {/* View tabs */}
          <div className="flex gap-2" role="tablist" aria-label="Directory view options">
            <Button
              variant={view === 'browser' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setView('browser')}
              role="tab"
              aria-selected={view === 'browser'}
              aria-controls="directory-content"
              id="browser-tab"
            >
              <Folder className="w-4 h-4 mr-2" />
              Browse
            </Button>
            <Button
              variant={view === 'recent' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setView('recent')}
              role="tab"
              aria-selected={view === 'recent'}
              aria-controls="directory-content"
              id="recent-tab"
            >
              <History className="w-4 h-4 mr-2" />
              Recent ({recentPaths.length})
            </Button>
            <Button
              variant={view === 'favorites' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setView('favorites')}
              role="tab"
              aria-selected={view === 'favorites'}
              aria-controls="directory-content"
              id="favorites-tab"
            >
              <Star className="w-4 h-4 mr-2" />
              Favorites ({favorites.length})
            </Button>
          </div>
          
          {/* Breadcrumb and controls */}
          {view === 'browser' && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => browseDirectory(currentPath)}
                disabled={loading}
              >
                <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              </Button>
              <div className="flex-1 min-w-0">
                <Breadcrumb
                  path={currentPath}
                  onNavigate={navigateToDirectory}
                  className="overflow-hidden"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
                  navigateToDirectory(parent);
                }}
                disabled={currentPath === '/'}
              >
                <ArrowUp className="w-4 h-4" />
              </Button>
            </div>
          )}
          
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search directories..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              aria-label="Search directories"
              role="searchbox"
            />
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 min-h-0">
          <ScrollArea className="h-96 md:h-96 sm:h-80">
            <div 
              className="p-4 space-y-3 md:space-y-3 sm:space-y-2" 
              id="directory-content"
              role="tabpanel"
              aria-labelledby={`${view}-tab`}
            >
              {view === 'browser' && (
                <>
                  {/* Quick access */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4" role="list" aria-label="Quick access directories">
                    {defaultPaths.map((item) => (
                      <button
                        key={item.path}
                        onClick={() => navigateToDirectory(item.path)}
                        className="flex items-center gap-2 p-2 rounded-md hover:bg-accent transition-colors text-left"
                      >
                        <item.icon className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">{item.name}</span>
                      </button>
                    ))}
                  </div>
                  
                  {/* Directory listing */}
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
                    </div>
                  ) : error ? (
                    <div className="flex items-center justify-center py-8 text-red-500">
                      <AlertCircle className="w-5 h-5 mr-2" />
                      <span className="text-sm">{error}</span>
                    </div>
                  ) : filteredItems.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground">
                      <Folder className="w-5 h-5 mr-2" />
                      <span className="text-sm">No directories found</span>
                    </div>
                  ) : (
                    <div role="listbox" aria-label="Available directories">
                      {filteredItems
                        .filter(item => item.type === 'directory')
                        .map((item, index) => (
                        <DirectoryItem
                          key={item.path}
                          item={item}
                          onSelect={selectDirectory}
                          onToggleFavorite={toggleFavorite}
                          isFavorite={favorites.some(fav => fav.path === item.path)}
                          isSelected={selectedPath === item.path}
                          isFocused={focusedItemIndex === index}
                          itemIndex={index}
                        />
                        ))}
                    </div>
                  )}
                </>
              )}
              
              {view === 'recent' && (
                <>
                  {recentPaths.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground">
                      <History className="w-5 h-5 mr-2" />
                      <span className="text-sm">No recent directories</span>
                    </div>
                  ) : (
                    <div role="listbox" aria-label="Recent directories">
                      {recentPaths.map((item, index) => (
                        <DirectoryItem
                          key={item.path}
                          item={item}
                          onSelect={selectDirectory}
                          onToggleFavorite={toggleFavorite}
                          isFavorite={favorites.some(fav => fav.path === item.path)}
                          isSelected={selectedPath === item.path}
                          isFocused={focusedItemIndex === index}
                          itemIndex={index}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
              
              {view === 'favorites' && (
                <>
                  {favorites.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground">
                      <Star className="w-5 h-5 mr-2" />
                      <span className="text-sm">No favorite directories</span>
                    </div>
                  ) : (
                    <div role="listbox" aria-label="Favorite directories">
                      {favorites.map((item, index) => (
                        <DirectoryItem
                          key={item.path}
                          item={item}
                          onSelect={selectDirectory}
                          onToggleFavorite={toggleFavorite}
                          isFavorite={true}
                          isSelected={selectedPath === item.path}
                          isFocused={focusedItemIndex === index}
                          itemIndex={index}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </div>
        
        {/* Footer */}
        <div className="p-4 border-t">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {selectedPath ? (
                <>
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <span className="truncate">Selected: {selectedPath}</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>Select a directory to continue</span>
                </>
              )}
            </div>
            
            <div className="flex gap-2 md:gap-2 sm:gap-3">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 md:flex-none active:scale-[0.98] transition-transform"
              >
                Cancel
              </Button>
              <Button
                onClick={confirmSelection}
                disabled={!selectedPath}
                className="flex-1 md:flex-none active:scale-[0.98] transition-transform"
              >
                Open Project
              </Button>
            </div>
          </div>
        </div>

        {/* Drag and Drop Overlay */}
        {isDragOver && platformInfo.isDesktop && (
          <div className="absolute inset-0 bg-primary/10 backdrop-blur-sm rounded-lg border-2 border-dashed border-primary flex items-center justify-center z-10">
            <div className="text-center">
              <FolderOpen className="w-12 h-12 text-primary mx-auto mb-2" />
              <p className="text-lg font-semibold text-primary">Drop directory here</p>
              <p className="text-sm text-muted-foreground">Release to select this project directory</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DirectorySelector;
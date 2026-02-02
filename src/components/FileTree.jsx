import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Checkbox } from './ui/checkbox';
import { Folder, FolderOpen, File, FileText, FileCode, List, TableProperties, Eye, Search, X, Upload, Loader2, Trash2, Download, CheckSquare } from 'lucide-react';

import CodeEditor from './CodeEditor';
import ImageViewer from './ImageViewer';
import { api } from '../utils/api';

function FileTree({ selectedProject }) {
  const { t } = useTranslation();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [viewMode, setViewMode] = useState('detailed'); // 'simple', 'detailed', 'compact'
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredFiles, setFilteredFiles] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const fileInputRef = useRef(null);
  const uploadTargetDir = useRef('');

  useEffect(() => {
    if (selectedProject) {
      fetchFiles();
    }
  }, [selectedProject]);

  // Load view mode preference from localStorage
  useEffect(() => {
    const savedViewMode = localStorage.getItem('file-tree-view-mode');
    if (savedViewMode && ['simple', 'detailed', 'compact'].includes(savedViewMode)) {
      setViewMode(savedViewMode);
    }
  }, []);

  // Filter files based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredFiles(files);
    } else {
      const filtered = filterFiles(files, searchQuery.toLowerCase());
      setFilteredFiles(filtered);

      // Auto-expand directories that contain matches
      const expandMatches = (items) => {
        items.forEach(item => {
          if (item.type === 'directory' && item.children && item.children.length > 0) {
            setExpandedDirs(prev => new Set(prev.add(item.path)));
            expandMatches(item.children);
          }
        });
      };
      expandMatches(filtered);
    }
  }, [files, searchQuery]);

  // Recursively filter files and directories based on search query
  const filterFiles = (items, query) => {
    return items.reduce((filtered, item) => {
      const matchesName = item.name.toLowerCase().includes(query);
      let filteredChildren = [];

      if (item.type === 'directory' && item.children) {
        filteredChildren = filterFiles(item.children, query);
      }

      // Include item if:
      // 1. It matches the search query, or
      // 2. It's a directory with matching children
      if (matchesName || filteredChildren.length > 0) {
        filtered.push({
          ...item,
          children: filteredChildren
        });
      }

      return filtered;
    }, []);
  };

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const response = await api.getFiles(selectedProject.name);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ File fetch failed:', response.status, errorText);
        setFiles([]);
        return;
      }
      
      const data = await response.json();
      setFiles(data);
    } catch (error) {
      console.error('❌ Error fetching files:', error);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleDirectory = (path) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedDirs(newExpanded);
  };

  // Change view mode and save preference
  const changeViewMode = (mode) => {
    setViewMode(mode);
    localStorage.setItem('file-tree-view-mode', mode);
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Format date as relative time
  const formatRelativeTime = (date) => {
    if (!date) return '-';
    const now = new Date();
    const past = new Date(date);
    const diffInSeconds = Math.floor((now - past) / 1000);

    if (diffInSeconds < 60) return t('fileTree.justNow');
    if (diffInSeconds < 3600) return t('fileTree.minAgo', { count: Math.floor(diffInSeconds / 60) });
    if (diffInSeconds < 86400) return t('fileTree.hoursAgo', { count: Math.floor(diffInSeconds / 3600) });
    if (diffInSeconds < 2592000) return t('fileTree.daysAgo', { count: Math.floor(diffInSeconds / 86400) });
    return past.toLocaleDateString();
  };

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKeyDown = (e) => { if (e.key === 'Escape') setContextMenu(null); };
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const handleContextMenu = useCallback((e, item) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, folderPath: item.path, itemType: item.type });
  }, []);

  const handleUploadClick = useCallback(() => {
    if (!contextMenu) return;
    uploadTargetDir.current = contextMenu.folderPath;
    setContextMenu(null);
    fileInputRef.current?.click();
  }, [contextMenu]);

  const handleFileChange = useCallback(async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    // Client-side size validation (100MB)
    const maxSize = 100 * 1024 * 1024;
    for (const file of files) {
      if (file.size > maxSize) {
        setUploadError(t('fileTree.fileTooLarge', { name: file.name }));
        event.target.value = '';
        return;
      }
    }

    setUploading(true);
    setUploadError(null);

    try {
      const response = await api.uploadFiles(
        selectedProject.name,
        files,
        uploadTargetDir.current
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }

      // Refresh file tree and expand the target folder
      await fetchFiles();
      setExpandedDirs(prev => {
        const next = new Set(prev);
        // Expand the target dir and all parent dirs
        const parts = uploadTargetDir.current.split('/').filter(Boolean);
        let current = '';
        for (const part of parts) {
          current = current ? current + '/' + part : part;
          next.add(current);
        }
        return next;
      });
    } catch (error) {
      setUploadError(t('fileTree.uploadFailed', { error: error.message }));
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }, [selectedProject, t]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      const response = await api.deleteFile(selectedProject.name, deleteConfirm);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Delete failed');
      }
      await fetchFiles();
    } catch (error) {
      setUploadError(t('fileTree.deleteFailed', { error: error.message }));
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, selectedProject, t]);

  // Toggle selection mode
  const toggleSelectionMode = useCallback(() => {
    setSelectionMode(prev => {
      if (prev) {
        setSelectedFiles(new Set());
      }
      return !prev;
    });
  }, []);

  // Toggle file selection
  const toggleFileSelection = useCallback((path, e) => {
    e?.stopPropagation();
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Get all file paths from the tree (flattened)
  const getAllFilePaths = useCallback((items) => {
    const paths = [];
    const traverse = (list) => {
      for (const item of list) {
        paths.push(item.path);
        if (item.type === 'directory' && item.children) {
          traverse(item.children);
        }
      }
    };
    traverse(items);
    return paths;
  }, []);

  // Select all visible files
  const selectAll = useCallback(() => {
    const allPaths = getAllFilePaths(filteredFiles);
    setSelectedFiles(new Set(allPaths));
  }, [filteredFiles, getAllFilePaths]);

  // Deselect all files
  const deselectAll = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  // Handle batch delete
  const handleBatchDelete = useCallback(async () => {
    if (selectedFiles.size === 0) return;
    setBatchDeleting(true);
    try {
      const response = await api.batchDeleteFiles(selectedProject.name, Array.from(selectedFiles));
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Batch delete failed');
      }
      await fetchFiles();
      setSelectedFiles(new Set());
      setBatchDeleteConfirm(false);
    } catch (error) {
      setUploadError(t('fileTree.batchDeleteFailed', { error: error.message }));
    } finally {
      setBatchDeleting(false);
    }
  }, [selectedFiles, selectedProject, t]);

  // Handle batch download
  const handleBatchDownload = useCallback(async () => {
    if (selectedFiles.size === 0) return;
    setBatchDownloading(true);
    try {
      const response = await api.batchDownloadFiles(selectedProject.name, Array.from(selectedFiles));
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Batch download failed');
      }

      // Download the zip file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedProject.name}-files.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      setUploadError(t('fileTree.batchDownloadFailed', { error: error.message }));
    } finally {
      setBatchDownloading(false);
    }
  }, [selectedFiles, selectedProject, t]);

  const renderDeleteButton = (item) => (
    deleteConfirm === item.path ? (
      <div className="flex items-center gap-1 ml-auto flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        <span className="text-xs text-muted-foreground">{t('fileTree.confirmDelete')}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={(e) => { e.stopPropagation(); handleDeleteConfirm(); }}
          disabled={deleting}
        >
          {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }}
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    ) : (
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 ml-auto flex-shrink-0 text-muted-foreground hover:text-destructive"
        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(item.path); }}
        title={t('fileTree.delete')}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    )
  );

  const renderFileTree = (items, level = 0) => {
    return items.map((item) => (
      <div key={item.path} className="select-none">
        <div
          className={`group flex items-center hover:bg-accent cursor-pointer ${selectedFiles.has(item.path) ? 'bg-accent/50' : ''}`}
          style={{ paddingLeft: `${level * 16 + 12}px`, paddingRight: '8px' }}
          onClick={() => {
            if (selectionMode) {
              toggleFileSelection(item.path);
            } else if (item.type === 'directory') {
              toggleDirectory(item.path);
            } else if (isImageFile(item.name)) {
              setSelectedImage({
                name: item.name,
                path: item.path,
                projectPath: selectedProject.path,
                projectName: selectedProject.name
              });
            } else {
              setSelectedFile({
                name: item.name,
                path: item.path,
                projectPath: selectedProject.path,
                projectName: selectedProject.name
              });
            }
          }}
          onContextMenu={(e) => handleContextMenu(e, item)}
        >
          {selectionMode && (
            <Checkbox
              checked={selectedFiles.has(item.path)}
              onCheckedChange={() => toggleFileSelection(item.path)}
              onClick={(e) => e.stopPropagation()}
              className="mr-2 flex-shrink-0"
            />
          )}
          <div className="flex items-center gap-2 min-w-0 flex-1 p-2">
            {item.type === 'directory' ? (
              expandedDirs.has(item.path) ? (
                <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
              ) : (
                <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )
            ) : (
              getFileIcon(item.name)
            )}
            <span className="text-sm truncate text-foreground">
              {item.name}
            </span>
          </div>
          {!selectionMode && renderDeleteButton(item)}
        </div>

        {item.type === 'directory' &&
         expandedDirs.has(item.path) &&
         item.children &&
         item.children.length > 0 && (
          <div>
            {renderFileTree(item.children, level + 1)}
          </div>
        )}
      </div>
    ));
  };

  const isImageFile = (filename) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'];
    return imageExtensions.includes(ext);
  };

  const getFileIcon = (filename) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    
    const codeExtensions = ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'php', 'rb', 'go', 'rs'];
    const docExtensions = ['md', 'txt', 'doc', 'pdf'];
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'];
    
    if (codeExtensions.includes(ext)) {
      return <FileCode className="w-4 h-4 text-green-500 flex-shrink-0" />;
    } else if (docExtensions.includes(ext)) {
      return <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />;
    } else if (imageExtensions.includes(ext)) {
      return <File className="w-4 h-4 text-purple-500 flex-shrink-0" />;
    } else {
      return <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />;
    }
  };

  // Render detailed view with table-like layout
  const renderDetailedView = (items, level = 0) => {
    return items.map((item) => (
      <div key={item.path} className="select-none">
        <div
          className={`group flex items-center p-2 hover:bg-accent cursor-pointer ${selectedFiles.has(item.path) ? 'bg-accent/50' : ''}`}
          style={{ paddingLeft: `${level * 16 + 12}px` }}
          onClick={() => {
            if (selectionMode) {
              toggleFileSelection(item.path);
            } else if (item.type === 'directory') {
              toggleDirectory(item.path);
            } else if (isImageFile(item.name)) {
              setSelectedImage({
                name: item.name,
                path: item.path,
                projectPath: selectedProject.path,
                projectName: selectedProject.name
              });
            } else {
              setSelectedFile({
                name: item.name,
                path: item.path,
                projectPath: selectedProject.path,
                projectName: selectedProject.name
              });
            }
          }}
          onContextMenu={(e) => handleContextMenu(e, item)}
        >
          {selectionMode && (
            <Checkbox
              checked={selectedFiles.has(item.path)}
              onCheckedChange={() => toggleFileSelection(item.path)}
              onClick={(e) => e.stopPropagation()}
              className="mr-2 flex-shrink-0"
            />
          )}
          <div className={`grid ${selectionMode ? 'grid-cols-11' : 'grid-cols-12'} gap-2 items-center flex-1 min-w-0`}>
            <div className={`${selectionMode ? 'col-span-4' : 'col-span-5'} flex items-center gap-2 min-w-0`}>
              {item.type === 'directory' ? (
                expandedDirs.has(item.path) ? (
                  <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
                ) : (
                  <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )
              ) : (
                getFileIcon(item.name)
              )}
              <span className="text-sm truncate text-foreground">
                {item.name}
              </span>
            </div>
            <div className="col-span-2 text-sm text-muted-foreground">
              {item.type === 'file' ? formatFileSize(item.size) : '-'}
            </div>
            <div className="col-span-3 text-sm text-muted-foreground">
              {formatRelativeTime(item.modified)}
            </div>
            <div className="col-span-2 text-sm text-muted-foreground font-mono">
              {item.permissionsRwx || '-'}
            </div>
          </div>
          {!selectionMode && renderDeleteButton(item)}
        </div>

        {item.type === 'directory' &&
         expandedDirs.has(item.path) &&
         item.children &&
         renderDetailedView(item.children, level + 1)}
      </div>
    ));
  };

  // Render compact view with inline details
  const renderCompactView = (items, level = 0) => {
    return items.map((item) => (
      <div key={item.path} className="select-none">
        <div
          className={`group flex items-center justify-between p-2 hover:bg-accent cursor-pointer ${selectedFiles.has(item.path) ? 'bg-accent/50' : ''}`}
          style={{ paddingLeft: `${level * 16 + 12}px` }}
          onClick={() => {
            if (selectionMode) {
              toggleFileSelection(item.path);
            } else if (item.type === 'directory') {
              toggleDirectory(item.path);
            } else if (isImageFile(item.name)) {
              setSelectedImage({
                name: item.name,
                path: item.path,
                projectPath: selectedProject.path,
                projectName: selectedProject.name
              });
            } else {
              setSelectedFile({
                name: item.name,
                path: item.path,
                projectPath: selectedProject.path,
                projectName: selectedProject.name
              });
            }
          }}
          onContextMenu={(e) => handleContextMenu(e, item)}
        >
          <div className="flex items-center gap-2 min-w-0">
            {selectionMode && (
              <Checkbox
                checked={selectedFiles.has(item.path)}
                onCheckedChange={() => toggleFileSelection(item.path)}
                onClick={(e) => e.stopPropagation()}
                className="mr-2 flex-shrink-0"
              />
            )}
            {item.type === 'directory' ? (
              expandedDirs.has(item.path) ? (
                <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
              ) : (
                <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )
            ) : (
              getFileIcon(item.name)
            )}
            <span className="text-sm truncate text-foreground">
              {item.name}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {item.type === 'file' && (
              <>
                <span>{formatFileSize(item.size)}</span>
                <span className="font-mono">{item.permissionsRwx}</span>
              </>
            )}
            {!selectionMode && renderDeleteButton(item)}
          </div>
        </div>

        {item.type === 'directory' &&
         expandedDirs.has(item.path) &&
         item.children &&
         renderCompactView(item.children, level + 1)}
      </div>
    ));
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400">
          {t('fileTree.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header with Search and View Mode Toggle */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">{t('fileTree.files')}</h3>
          <div className="flex gap-1">
            <Button
              variant={selectionMode ? 'default' : 'ghost'}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={toggleSelectionMode}
              title={t('fileTree.selectionMode')}
            >
              <CheckSquare className="w-4 h-4" />
            </Button>
            <div className="w-px bg-border mx-1" />
            <Button
              variant={viewMode === 'simple' ? 'default' : 'ghost'}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => changeViewMode('simple')}
              title={t('fileTree.simpleView')}
            >
              <List className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === 'compact' ? 'default' : 'ghost'}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => changeViewMode('compact')}
              title={t('fileTree.compactView')}
            >
              <Eye className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === 'detailed' ? 'default' : 'ghost'}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => changeViewMode('detailed')}
              title={t('fileTree.detailedView')}
            >
              <TableProperties className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder={t('fileTree.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-8 h-8 text-sm"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0 hover:bg-accent"
              onClick={() => setSearchQuery('')}
              title={t('fileTree.clearSearch')}
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Selection Mode Toolbar */}
      {selectionMode && (
        <div className="px-4 py-2 border-b border-border flex items-center justify-between bg-accent/30">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t('fileTree.selectedCount', { count: selectedFiles.size })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={selectAll}
            >
              {t('common.selectAll')}
            </Button>
            {selectedFiles.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={deselectAll}
              >
                {t('common.deselectAll')}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleBatchDownload}
              disabled={selectedFiles.size === 0 || batchDownloading}
              title={t('fileTree.batchDownload')}
            >
              {batchDownloading ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Download className="w-3 h-3 mr-1" />
              )}
              {t('buttons.download')}
            </Button>
            {batchDeleteConfirm ? (
              <div className="flex items-center gap-1">
                <span className="text-xs text-destructive">{t('fileTree.confirmBatchDelete', { count: selectedFiles.size })}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={handleBatchDelete}
                  disabled={batchDeleting}
                >
                  {batchDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : t('buttons.confirm')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setBatchDeleteConfirm(false)}
                >
                  {t('buttons.cancel')}
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setBatchDeleteConfirm(true)}
                disabled={selectedFiles.size === 0}
                title={t('fileTree.batchDelete')}
              >
                <Trash2 className="w-3 h-3 mr-1" />
                {t('buttons.delete')}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Upload feedback */}
      {uploading && (
        <div className="px-4 py-2 border-b border-border flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('fileTree.uploading')}
        </div>
      )}
      {uploadError && (
        <div className="px-4 py-2 border-b border-border flex items-center justify-between text-sm text-destructive bg-destructive/10">
          <span>{uploadError}</span>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setUploadError(null)}>
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}

      {/* Column Headers for Detailed View */}
      {viewMode === 'detailed' && filteredFiles.length > 0 && (
        <div className="px-4 pt-2 pb-1 border-b border-border">
          <div className="grid grid-cols-12 gap-2 px-2 text-xs font-medium text-muted-foreground">
            <div className="col-span-5">{t('fileTree.name')}</div>
            <div className="col-span-2">{t('fileTree.size')}</div>
            <div className="col-span-3">{t('fileTree.modified')}</div>
            <div className="col-span-2">{t('fileTree.permissions')}</div>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1 p-4">
        {files.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-3">
              <Folder className="w-6 h-6 text-muted-foreground" />
            </div>
            <h4 className="font-medium text-foreground mb-1">{t('fileTree.noFilesFound')}</h4>
            <p className="text-sm text-muted-foreground">
              {t('fileTree.checkProjectPath')}
            </p>
          </div>
        ) : filteredFiles.length === 0 && searchQuery ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-3">
              <Search className="w-6 h-6 text-muted-foreground" />
            </div>
            <h4 className="font-medium text-foreground mb-1">{t('fileTree.noMatchesFound')}</h4>
            <p className="text-sm text-muted-foreground">
              {t('fileTree.tryDifferentSearch')}
            </p>
          </div>
        ) : (
          <div className={viewMode === 'detailed' ? '' : 'space-y-1'}>
            {viewMode === 'simple' && renderFileTree(filteredFiles)}
            {viewMode === 'compact' && renderCompactView(filteredFiles)}
            {viewMode === 'detailed' && renderDetailedView(filteredFiles)}
          </div>
        )}
      </ScrollArea>
      
      {/* Code Editor Modal */}
      {selectedFile && (
        <CodeEditor
          file={selectedFile}
          onClose={() => setSelectedFile(null)}
          projectPath={selectedFile.projectPath}
        />
      )}
      
      {/* Image Viewer Modal */}
      {selectedImage && (
        <ImageViewer
          file={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] bg-popover border border-border rounded-md shadow-md py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.itemType === 'directory' && (
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent cursor-pointer"
              onClick={handleUploadClick}
            >
              <Upload className="w-4 h-4" />
              {t('fileTree.uploadFiles')}
            </button>
          )}
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-accent cursor-pointer"
            onClick={() => {
              setDeleteConfirm(contextMenu.folderPath);
              setContextMenu(null);
            }}
          >
            <Trash2 className="w-4 h-4" />
            {t('fileTree.delete')}
          </button>
        </div>
      )}

      {/* Hidden file input for uploads */}
      <input
        type="file"
        multiple
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}

export default FileTree;
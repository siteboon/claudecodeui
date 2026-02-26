import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Folder, FolderOpen, File as FileIcon, FileText, FileCode, List, TableProperties, Eye, Search, X,
  ChevronRight, ChevronDown, RefreshCw, FolderPlus, Trash2, Pencil, Upload, Download, Copy,
  AlertTriangle, Check, XCircle,
  FileJson, FileType, FileSpreadsheet, FileArchive,
  Hash, Braces, Terminal, Database, Globe, Palette, Music2, Video, Archive,
  Lock, Shield, Settings, Image, BookOpen, Cpu, Box, Gem, Coffee,
  Flame, Hexagon, FileCode2, Code2, Cog, FileWarning, Binary, SquareFunction,
  Scroll, FlaskConical, NotebookPen, FileCheck, Workflow, Blocks
} from 'lucide-react';
import { cn } from '../lib/utils';
import ImageViewer from './ImageViewer';
import FileContextMenu from './FileContextMenu';
import { api } from '../utils/api';

// ─── File Icon Registry ──────────────────────────────────────────────
// Maps file extensions (and special filenames) to { icon, colorClass } pairs.
// Uses lucide-react icons mapped semantically to file types.

const ICON_SIZE = 'w-4 h-4 flex-shrink-0';

const FILE_ICON_MAP = {
  // ── JavaScript / TypeScript ──
  js:   { icon: FileCode,   color: 'text-yellow-500' },
  jsx:  { icon: FileCode,   color: 'text-yellow-500' },
  mjs:  { icon: FileCode,   color: 'text-yellow-500' },
  cjs:  { icon: FileCode,   color: 'text-yellow-500' },
  ts:   { icon: FileCode2,  color: 'text-blue-500' },
  tsx:  { icon: FileCode2,  color: 'text-blue-500' },
  mts:  { icon: FileCode2,  color: 'text-blue-500' },

  // ── Python ──
  py:   { icon: Code2,      color: 'text-emerald-500' },
  pyw:  { icon: Code2,      color: 'text-emerald-500' },
  pyi:  { icon: Code2,      color: 'text-emerald-400' },
  ipynb:{ icon: NotebookPen, color: 'text-orange-500' },

  // ── Rust ──
  rs:   { icon: Cog,        color: 'text-orange-600' },
  toml: { icon: Settings,   color: 'text-gray-500' },

  // ── Go ──
  go:   { icon: Hexagon,    color: 'text-cyan-500' },

  // ── Ruby ──
  rb:   { icon: Gem,        color: 'text-red-500' },
  erb:  { icon: Gem,        color: 'text-red-400' },

  // ── PHP ──
  php:  { icon: Blocks,     color: 'text-violet-500' },

  // ── Java / Kotlin ──
  java: { icon: Coffee,     color: 'text-red-600' },
  jar:  { icon: Coffee,     color: 'text-red-500' },
  kt:   { icon: Hexagon,    color: 'text-violet-500' },
  kts:  { icon: Hexagon,    color: 'text-violet-400' },

  // ── C / C++ ──
  c:    { icon: Cpu,        color: 'text-blue-600' },
  h:    { icon: Cpu,        color: 'text-blue-400' },
  cpp:  { icon: Cpu,        color: 'text-blue-700' },
  hpp:  { icon: Cpu,        color: 'text-blue-500' },
  cc:   { icon: Cpu,        color: 'text-blue-700' },

  // ── C# ──
  cs:   { icon: Hexagon,    color: 'text-purple-600' },

  // ── Swift ──
  swift:{ icon: Flame,      color: 'text-orange-500' },

  // ── Lua ──
  lua:  { icon: SquareFunction, color: 'text-blue-500' },

  // ── R ──
  r:    { icon: FlaskConical, color: 'text-blue-600' },

  // ── Web ──
  html: { icon: Globe,      color: 'text-orange-600' },
  htm:  { icon: Globe,      color: 'text-orange-600' },
  css:  { icon: Hash,       color: 'text-blue-500' },
  scss: { icon: Hash,       color: 'text-pink-500' },
  sass: { icon: Hash,       color: 'text-pink-400' },
  less: { icon: Hash,       color: 'text-indigo-500' },
  vue:  { icon: FileCode2,  color: 'text-emerald-500' },
  svelte:{ icon: FileCode2, color: 'text-orange-500' },

  // ── Data / Config ──
  json: { icon: Braces,     color: 'text-yellow-600' },
  jsonc:{ icon: Braces,     color: 'text-yellow-500' },
  json5:{ icon: Braces,     color: 'text-yellow-500' },
  yaml: { icon: Settings,   color: 'text-purple-400' },
  yml:  { icon: Settings,   color: 'text-purple-400' },
  xml:  { icon: FileCode,   color: 'text-orange-500' },
  csv:  { icon: FileSpreadsheet, color: 'text-green-600' },
  tsv:  { icon: FileSpreadsheet, color: 'text-green-500' },
  sql:  { icon: Database,   color: 'text-blue-500' },
  graphql:{ icon: Workflow,  color: 'text-pink-500' },
  gql:  { icon: Workflow,   color: 'text-pink-500' },
  proto:{ icon: Box,        color: 'text-green-500' },
  env:  { icon: Shield,     color: 'text-yellow-600' },

  // ── Documents ──
  md:   { icon: BookOpen,   color: 'text-blue-500' },
  mdx:  { icon: BookOpen,   color: 'text-blue-400' },
  txt:  { icon: FileText,   color: 'text-gray-500' },
  doc:  { icon: FileText,   color: 'text-blue-600' },
  docx: { icon: FileText,   color: 'text-blue-600' },
  pdf:  { icon: FileCheck,  color: 'text-red-600' },
  rtf:  { icon: FileText,   color: 'text-gray-500' },
  tex:  { icon: Scroll,     color: 'text-teal-600' },
  rst:  { icon: FileText,   color: 'text-gray-400' },

  // ── Shell / Scripts ──
  sh:   { icon: Terminal,   color: 'text-green-500' },
  bash: { icon: Terminal,   color: 'text-green-500' },
  zsh:  { icon: Terminal,   color: 'text-green-400' },
  fish: { icon: Terminal,   color: 'text-green-400' },
  ps1:  { icon: Terminal,   color: 'text-blue-400' },
  bat:  { icon: Terminal,   color: 'text-gray-500' },
  cmd:  { icon: Terminal,   color: 'text-gray-500' },

  // ── Images ──
  png:  { icon: Image,      color: 'text-purple-500' },
  jpg:  { icon: Image,      color: 'text-purple-500' },
  jpeg: { icon: Image,      color: 'text-purple-500' },
  gif:  { icon: Image,      color: 'text-purple-400' },
  webp: { icon: Image,      color: 'text-purple-400' },
  ico:  { icon: Image,      color: 'text-purple-400' },
  bmp:  { icon: Image,      color: 'text-purple-400' },
  tiff: { icon: Image,      color: 'text-purple-400' },
  svg:  { icon: Palette,    color: 'text-amber-500' },

  // ── Audio ──
  mp3:  { icon: Music2,     color: 'text-pink-500' },
  wav:  { icon: Music2,     color: 'text-pink-500' },
  ogg:  { icon: Music2,     color: 'text-pink-400' },
  flac: { icon: Music2,     color: 'text-pink-400' },
  aac:  { icon: Music2,     color: 'text-pink-400' },
  m4a:  { icon: Music2,     color: 'text-pink-400' },

  // ── Video ──
  mp4:  { icon: Video,      color: 'text-rose-500' },
  mov:  { icon: Video,      color: 'text-rose-500' },
  avi:  { icon: Video,      color: 'text-rose-500' },
  webm: { icon: Video,      color: 'text-rose-400' },
  mkv:  { icon: Video,      color: 'text-rose-400' },

  // ── Fonts ──
  ttf:  { icon: FileType,   color: 'text-red-500' },
  otf:  { icon: FileType,   color: 'text-red-500' },
  woff: { icon: FileType,   color: 'text-red-400' },
  woff2:{ icon: FileType,   color: 'text-red-400' },
  eot:  { icon: FileType,   color: 'text-red-400' },

  // ── Archives ──
  zip:  { icon: Archive,    color: 'text-amber-600' },
  tar:  { icon: Archive,    color: 'text-amber-600' },
  gz:   { icon: Archive,    color: 'text-amber-600' },
  bz2:  { icon: Archive,    color: 'text-amber-600' },
  rar:  { icon: Archive,    color: 'text-amber-500' },
  '7z': { icon: Archive,    color: 'text-amber-500' },

  // ── Lock files ──
  lock: { icon: Lock,       color: 'text-gray-500' },

  // ── Binary / Executable ──
  exe:  { icon: Binary,     color: 'text-gray-500' },
  bin:  { icon: Binary,     color: 'text-gray-500' },
  dll:  { icon: Binary,     color: 'text-gray-400' },
  so:   { icon: Binary,     color: 'text-gray-400' },
  dylib:{ icon: Binary,     color: 'text-gray-400' },
  wasm: { icon: Binary,     color: 'text-purple-500' },

  // ── Misc config ──
  ini:  { icon: Settings,   color: 'text-gray-500' },
  cfg:  { icon: Settings,   color: 'text-gray-500' },
  conf: { icon: Settings,   color: 'text-gray-500' },
  log:  { icon: Scroll,     color: 'text-gray-400' },
  map:  { icon: FileIcon,       color: 'text-gray-400' },
};

// Special full-filename matches (highest priority)
const FILENAME_ICON_MAP = {
  'Dockerfile':       { icon: Box,       color: 'text-blue-500' },
  'docker-compose.yml': { icon: Box,     color: 'text-blue-500' },
  'docker-compose.yaml': { icon: Box,    color: 'text-blue-500' },
  '.dockerignore':    { icon: Box,       color: 'text-gray-500' },
  '.gitignore':       { icon: Settings,  color: 'text-gray-500' },
  '.gitmodules':      { icon: Settings,  color: 'text-gray-500' },
  '.gitattributes':   { icon: Settings,  color: 'text-gray-500' },
  '.editorconfig':    { icon: Settings,  color: 'text-gray-500' },
  '.prettierrc':      { icon: Settings,  color: 'text-pink-400' },
  '.prettierignore':  { icon: Settings,  color: 'text-gray-500' },
  '.eslintrc':        { icon: Settings,  color: 'text-violet-500' },
  '.eslintrc.js':     { icon: Settings,  color: 'text-violet-500' },
  '.eslintrc.json':   { icon: Settings,  color: 'text-violet-500' },
  '.eslintrc.cjs':    { icon: Settings,  color: 'text-violet-500' },
  'eslint.config.js': { icon: Settings,  color: 'text-violet-500' },
  'eslint.config.mjs':{ icon: Settings,  color: 'text-violet-500' },
  '.env':             { icon: Shield,    color: 'text-yellow-600' },
  '.env.local':       { icon: Shield,    color: 'text-yellow-600' },
  '.env.development': { icon: Shield,    color: 'text-yellow-500' },
  '.env.production':  { icon: Shield,    color: 'text-yellow-600' },
  '.env.example':     { icon: Shield,    color: 'text-yellow-400' },
  'package.json':     { icon: Braces,    color: 'text-green-500' },
  'package-lock.json':{ icon: Lock,      color: 'text-gray-500' },
  'yarn.lock':        { icon: Lock,      color: 'text-blue-400' },
  'pnpm-lock.yaml':   { icon: Lock,      color: 'text-orange-400' },
  'bun.lockb':        { icon: Lock,      color: 'text-gray-400' },
  'Cargo.toml':       { icon: Cog,       color: 'text-orange-600' },
  'Cargo.lock':       { icon: Lock,      color: 'text-orange-400' },
  'Gemfile':          { icon: Gem,       color: 'text-red-500' },
  'Gemfile.lock':     { icon: Lock,      color: 'text-red-400' },
  'Makefile':         { icon: Terminal,   color: 'text-gray-500' },
  'CMakeLists.txt':   { icon: Cog,       color: 'text-blue-500' },
  'tsconfig.json':    { icon: Braces,    color: 'text-blue-500' },
  'jsconfig.json':    { icon: Braces,    color: 'text-yellow-500' },
  'vite.config.ts':   { icon: Flame,     color: 'text-purple-500' },
  'vite.config.js':   { icon: Flame,     color: 'text-purple-500' },
  'webpack.config.js':{ icon: Cog,       color: 'text-blue-500' },
  'tailwind.config.js':{ icon: Hash,     color: 'text-cyan-500' },
  'tailwind.config.ts':{ icon: Hash,     color: 'text-cyan-500' },
  'postcss.config.js':{ icon: Cog,       color: 'text-red-400' },
  'babel.config.js':  { icon: Settings,  color: 'text-yellow-500' },
  '.babelrc':         { icon: Settings,  color: 'text-yellow-500' },
  'README.md':        { icon: BookOpen,  color: 'text-blue-500' },
  'LICENSE':          { icon: FileCheck,  color: 'text-gray-500' },
  'LICENSE.md':       { icon: FileCheck,  color: 'text-gray-500' },
  'CHANGELOG.md':     { icon: Scroll,    color: 'text-blue-400' },
  'requirements.txt': { icon: FileText,  color: 'text-emerald-400' },
  'go.mod':           { icon: Hexagon,   color: 'text-cyan-500' },
  'go.sum':           { icon: Lock,      color: 'text-cyan-400' },
};

function getFileIconData(filename) {
  // 1. Exact filename match
  if (FILENAME_ICON_MAP[filename]) {
    return FILENAME_ICON_MAP[filename];
  }

  // 2. Check for .env prefix pattern
  if (filename.startsWith('.env')) {
    return { icon: Shield, color: 'text-yellow-600' };
  }

  // 3. Extension-based lookup
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext && FILE_ICON_MAP[ext]) {
    return FILE_ICON_MAP[ext];
  }

  // 4. Fallback
  return { icon: FileIcon, color: 'text-muted-foreground' };
}


// ─── Component ───────────────────────────────────────────────────────

// Invalid filename characters
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

function FileTree({ selectedProject, onFileOpen }) {
  const { t } = useTranslation();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [selectedImage, setSelectedImage] = useState(null);
  const [viewMode, setViewMode] = useState('detailed');
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredFiles, setFilteredFiles] = useState([]);

  // File operations state
  const [selectedItem, setSelectedItem] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newItemParent, setNewItemParent] = useState('');
  const [newItemType, setNewItemType] = useState('file');
  const [newItemName, setNewItemName] = useState('');
  const [renamingItem, setRenamingItem] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteDialog, setDeleteDialog] = useState({ isOpen: false, item: null });
  const [operationLoading, setOperationLoading] = useState(false);
  const [toast, setToast] = useState(null);

  // Drag and drop state
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropTarget, setDropTarget] = useState(null);
  const [uploadProgress, setUploadProgress] = useState({});
  const fileInputRef = useRef(null);
  const treeRef = useRef(null);
  const renameInputRef = useRef(null);
  const newItemInputRef = useRef(null);

  useEffect(() => {
    if (selectedProject) {
      fetchFiles();
    }
  }, [selectedProject]);

  useEffect(() => {
    const savedViewMode = localStorage.getItem('file-tree-view-mode');
    if (savedViewMode && ['simple', 'detailed', 'compact'].includes(savedViewMode)) {
      setViewMode(savedViewMode);
    }
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredFiles(files);
    } else {
      const filtered = filterFiles(files, searchQuery.toLowerCase());
      setFilteredFiles(filtered);

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

  // Focus rename input when shown
  useEffect(() => {
    if (renamingItem && renameInputRef.current) {
      renameInputRef.current.focus();
      // Select filename without extension
      const extIndex = renameValue.lastIndexOf('.');
      if (extIndex > 0) {
        renameInputRef.current.setSelectionRange(0, extIndex);
      } else {
        renameInputRef.current.select();
      }
    }
  }, [renamingItem, renameValue]);

  // Focus new item input when shown
  useEffect(() => {
    if (isCreating && newItemInputRef.current) {
      newItemInputRef.current.focus();
      newItemInputRef.current.select();
    }
  }, [isCreating]);

  // Auto-hide toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
  };

  const filterFiles = (items, query) => {
    return items.reduce((filtered, item) => {
      const matchesName = item.name.toLowerCase().includes(query);
      let filteredChildren = [];

      if (item.type === 'directory' && item.children) {
        filteredChildren = filterFiles(item.children, query);
      }

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

  const collapseAll = () => {
    setExpandedDirs(new Set());
  };

  const changeViewMode = (mode) => {
    setViewMode(mode);
    localStorage.setItem('file-tree-view-mode', mode);
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

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

  const isImageFile = (filename) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'];
    return imageExtensions.includes(ext);
  };

  const getFileIcon = (filename) => {
    const { icon: Icon, color } = getFileIconData(filename);
    return <Icon className={cn(ICON_SIZE, color)} />;
  };

  // ── File Operations ─────────────────────────────────────────────────

  const validateFilename = (name) => {
    if (!name || !name.trim()) {
      return t('fileTree.validation.emptyName', 'Filename cannot be empty');
    }
    if (INVALID_FILENAME_CHARS.test(name)) {
      return t('fileTree.validation.invalidChars', 'Filename contains invalid characters');
    }
    if (RESERVED_NAMES.test(name)) {
      return t('fileTree.validation.reserved', 'Filename is a reserved name');
    }
    if (/^\.+$/.test(name)) {
      return t('fileTree.validation.dotsOnly', 'Filename cannot be only dots');
    }
    return null;
  };

  // Create file or directory
  const handleStartCreate = (parentPath, type) => {
    setNewItemParent(parentPath || '');
    setNewItemType(type);
    setNewItemName(type === 'file' ? 'untitled.txt' : 'new-folder');
    setIsCreating(true);
    setRenamingItem(null);
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    setNewItemParent('');
    setNewItemName('');
  };

  const handleConfirmCreate = async () => {
    const error = validateFilename(newItemName);
    if (error) {
      showToast(error, 'error');
      return;
    }

    setOperationLoading(true);
    try {
      const response = await api.post(
        `/projects/${encodeURIComponent(selectedProject.name)}/files/create`,
        {
          path: newItemParent,
          type: newItemType,
          name: newItemName
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create');
      }

      showToast(
        newItemType === 'file'
          ? t('fileTree.toast.fileCreated', 'File created successfully')
          : t('fileTree.toast.folderCreated', 'Folder created successfully'),
        'success'
      );

      // Expand parent directory
      if (newItemParent) {
        setExpandedDirs(prev => new Set(prev.add(newItemParent)));
      }

      await fetchFiles();
      handleCancelCreate();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setOperationLoading(false);
    }
  };

  // Rename file or directory
  const handleStartRename = (item) => {
    setRenamingItem(item);
    setRenameValue(item.name);
    setIsCreating(false);
  };

  const handleCancelRename = () => {
    setRenamingItem(null);
    setRenameValue('');
  };

  const handleConfirmRename = async () => {
    if (!renamingItem) return;

    const error = validateFilename(renameValue);
    if (error) {
      showToast(error, 'error');
      return;
    }

    if (renameValue === renamingItem.name) {
      handleCancelRename();
      return;
    }

    setOperationLoading(true);
    try {
      const response = await api.put(
        `/projects/${encodeURIComponent(selectedProject.name)}/files/rename`,
        {
          oldPath: renamingItem.path,
          newName: renameValue
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to rename');
      }

      showToast(t('fileTree.toast.renamed', 'Renamed successfully'), 'success');
      await fetchFiles();
      handleCancelRename();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setOperationLoading(false);
    }
  };

  // Delete file or directory
  const handleStartDelete = (item) => {
    setDeleteDialog({ isOpen: true, item });
  };

  const handleCancelDelete = () => {
    setDeleteDialog({ isOpen: false, item: null });
  };

  const handleConfirmDelete = async () => {
    const { item } = deleteDialog;
    if (!item) return;

    setOperationLoading(true);
    try {
      const response = await api.delete(
        `/projects/${encodeURIComponent(selectedProject.name)}/files`,
        {
          body: JSON.stringify({
            path: item.path,
            type: item.type
          })
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete');
      }

      showToast(
        item.type === 'directory'
          ? t('fileTree.toast.folderDeleted', 'Folder deleted')
          : t('fileTree.toast.fileDeleted', 'File deleted'),
        'success'
      );
      await fetchFiles();
      handleCancelDelete();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setOperationLoading(false);
    }
  };

  // Copy path to clipboard
  const handleCopyPath = (item) => {
    navigator.clipboard.writeText(item.path);
    showToast(t('fileTree.toast.pathCopied', 'Path copied to clipboard'), 'success');
  };

  // Download file
  const handleDownload = (item) => {
    const link = document.createElement('a');
    link.href = `/api/projects/${encodeURIComponent(selectedProject.name)}/files/content?path=${encodeURIComponent(item.path)}`;
    link.download = item.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── Drag and Drop ─────────────────────────────────────────────────

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set isDragOver to false if we're leaving the entire tree
    if (treeRef.current && !treeRef.current.contains(e.relatedTarget)) {
      setIsDragOver(false);
      setDropTarget(null);
    }
  }, []);

  // Helper function to read all files from a directory entry recursively
  const readAllDirectoryEntries = useCallback(async (directoryEntry, basePath = '') => {
    console.log('[DEBUG] readAllDirectoryEntries called with basePath:', basePath, 'directory:', directoryEntry.name);
    const files = [];

    const reader = directoryEntry.createReader();
    let entries = [];

    // Read all entries from the directory (may need multiple reads)
    let batch;
    do {
      batch = await new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      entries = entries.concat(batch);
    } while (batch.length > 0);

    console.log('[DEBUG] Found entries:', entries.map(e => ({ name: e.name, isFile: e.isFile, isDirectory: e.isDirectory })));

    // Files to ignore (system files)
    const ignoredFiles = ['.DS_Store', 'Thumbs.db', 'desktop.ini'];

    for (const entry of entries) {
      const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
      console.log('[DEBUG] Processing entry:', entry.name, '-> entryPath:', entryPath);

      // Skip ignored system files
      if (ignoredFiles.includes(entry.name)) {
        console.log('[DEBUG] Skipping ignored file:', entry.name);
        continue;
      }

      if (entry.isFile) {
        const file = await new Promise((resolve, reject) => {
          entry.file(resolve, reject);
        });
        // Create a new File object with the correct path
        const fileWithPath = new File([file], entryPath, {
          type: file.type,
          lastModified: file.lastModified
        });
        console.log('[DEBUG] Created fileWithPath:', fileWithPath.name);
        files.push(fileWithPath);
      } else if (entry.isDirectory) {
        const subFiles = await readAllDirectoryEntries(entry, entryPath);
        files.push(...subFiles);
      }
    }

    return files;
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const targetPath = dropTarget || '';
    setOperationLoading(true);

    try {
      const files = [];

      // Use DataTransferItemList for folder support
      const items = e.dataTransfer.items;
      if (items) {
        for (const item of items) {
          if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;

            console.log('[DEBUG] Drop entry:', entry?.name, 'isDirectory:', entry?.isDirectory, 'isFile:', entry?.isFile);

            if (entry) {
              if (entry.isFile) {
                const file = await new Promise((resolve, reject) => {
                  entry.file(resolve, reject);
                });
                console.log('[DEBUG] Single file:', file.name);
                files.push(file);
              } else if (entry.isDirectory) {
                // Pass the directory name as basePath so files include the folder path
                console.log('[DEBUG] Reading directory with basePath:', entry.name);
                const dirFiles = await readAllDirectoryEntries(entry, entry.name);
                console.log('[DEBUG] Directory files:', dirFiles.map(f => f.name));
                files.push(...dirFiles);
              }
            } else {
              // Fallback for browsers that don't support webkitGetAsEntry
              const file = item.getAsFile();
              if (file) files.push(file);
            }
          }
        }
      } else {
        // Fallback to files property
        files.push(...Array.from(e.dataTransfer.files));
      }

      if (files.length === 0) {
        setOperationLoading(false);
        return;
      }

      // Debug: log file names before upload
      console.log('[DEBUG] Files to upload:', files.map(f => ({ name: f.name, size: f.size })));

      const formData = new FormData();
      formData.append('targetPath', targetPath);

      // Store relative paths separately since FormData strips path info from File.name
      const relativePaths = [];
      files.forEach((file, index) => {
        // Create a new file with just the filename (without path) for FormData
        // but store the relative path separately
        const cleanFile = new File([file], file.name.split('/').pop(), {
          type: file.type,
          lastModified: file.lastModified
        });
        formData.append('files', cleanFile);
        relativePaths.push(file.name); // Keep the full relative path
      });

      // Send relative paths as a JSON array
      formData.append('relativePaths', JSON.stringify(relativePaths));

      const response = await api.post(
        `/projects/${encodeURIComponent(selectedProject.name)}/files/upload`,
        formData
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }

      showToast(
        t('fileTree.toast.uploaded', { count: files.length, defaultValue: `Uploaded ${files.length} file(s)` }),
        'success'
      );
      await fetchFiles();
    } catch (err) {
      console.error('Upload error:', err);
      showToast(err.message, 'error');
    } finally {
      setOperationLoading(false);
      setDropTarget(null);
    }
  }, [dropTarget, selectedProject, t, readAllDirectoryEntries]);

  // ── Click handler shared across all view modes ──
  const handleItemClick = (item) => {
    setSelectedItem(item);

    if (item.type === 'directory') {
      toggleDirectory(item.path);
    } else if (isImageFile(item.name)) {
      setSelectedImage({
        name: item.name,
        path: item.path,
        projectPath: selectedProject.path,
        projectName: selectedProject.name
      });
    } else if (onFileOpen) {
      onFileOpen(item.path);
    }
  };

  // Handle keyboard events
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'F2' && selectedItem && !renamingItem) {
      e.preventDefault();
      handleStartRename(selectedItem);
    } else if (e.key === 'Delete' && selectedItem && !deleteDialog.isOpen) {
      e.preventDefault();
      handleStartDelete(selectedItem);
    } else if (e.key === 'Escape') {
      if (renamingItem) handleCancelRename();
      if (isCreating) handleCancelCreate();
      if (deleteDialog.isOpen) handleCancelDelete();
    }
  }, [selectedItem, renamingItem, deleteDialog.isOpen, isCreating]);

  // ── Indent guide + folder/file icon rendering ──
  const renderIndentGuides = (level) => {
    if (level === 0) return null;
    return (
      <span className="flex items-center flex-shrink-0" aria-hidden="true">
        {Array.from({ length: level }).map((_, i) => (
          <span
            key={i}
            className="inline-block w-4 h-full border-l border-border/50"
          />
        ))}
      </span>
    );
  };

  const renderItemIcons = (item) => {
    const isDir = item.type === 'directory';
    const isOpen = expandedDirs.has(item.path);

    if (isDir) {
      return (
        <span className="flex items-center gap-0.5 flex-shrink-0">
          <ChevronRight
            className={cn(
              'w-3.5 h-3.5 text-muted-foreground/70 transition-transform duration-150',
              isOpen && 'rotate-90'
            )}
          />
          {isOpen ? (
            <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}
        </span>
      );
    }

    return (
      <span className="flex items-center flex-shrink-0 ml-[18px]">
        {getFileIcon(item.name)}
      </span>
    );
  };

  // ─── Simple (Tree) View ────────────────────────────────────────────
  const renderFileTree = (items, level = 0) => {
    return items.map((item) => {
      const isDir = item.type === 'directory';
      const isOpen = isDir && expandedDirs.has(item.path);
      const isRenaming = renamingItem?.path === item.path;

      return (
        <div key={item.path} className="select-none">
          <FileContextMenu
            item={item}
            onRename={handleStartRename}
            onDelete={handleStartDelete}
            onNewFile={(parentPath) => handleStartCreate(parentPath, 'file')}
            onNewFolder={(parentPath) => handleStartCreate(parentPath, 'directory')}
            onRefresh={fetchFiles}
            onCopyPath={handleCopyPath}
            onDownload={handleDownload}
            isLoading={operationLoading}
          >
            <div
              className={cn(
                'group flex items-center gap-1.5 py-[3px] pr-2 cursor-pointer rounded-sm',
                'hover:bg-accent/60 transition-colors duration-100',
                isDir && isOpen && 'border-l-2 border-primary/30',
                isDir && !isOpen && 'border-l-2 border-transparent',
                !isDir && 'border-l-2 border-transparent',
                selectedItem?.path === item.path && 'bg-accent/40',
              )}
              style={{ paddingLeft: `${level * 16 + 4}px` }}
              onClick={() => handleItemClick(item)}
            >
              {renderItemIcons(item)}
              {isRenaming ? (
                <Input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') handleConfirmRename();
                    if (e.key === 'Escape') handleCancelRename();
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      if (renamingItem?.path === item.path) handleConfirmRename();
                    }, 100);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="h-5 text-sm flex-1"
                  disabled={operationLoading}
                />
              ) : (
                <span className={cn(
                  'text-[13px] leading-tight truncate',
                  isDir ? 'font-medium text-foreground' : 'text-foreground/90'
                )}>
                  {item.name}
                </span>
              )}
            </div>
          </FileContextMenu>

          {isDir && isOpen && item.children && item.children.length > 0 && (
            <div className="relative">
              <span
                className="absolute top-0 bottom-0 border-l border-border/40"
                style={{ left: `${level * 16 + 14}px` }}
                aria-hidden="true"
              />
              {renderFileTree(item.children, level + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  // ─── Detailed View ────────────────────────────────────────────────
  const renderDetailedView = (items, level = 0) => {
    return items.map((item) => {
      const isDir = item.type === 'directory';
      const isOpen = isDir && expandedDirs.has(item.path);
      const isRenaming = renamingItem?.path === item.path;

      return (
        <div key={item.path} className="select-none">
          <FileContextMenu
            item={item}
            onRename={handleStartRename}
            onDelete={handleStartDelete}
            onNewFile={(parentPath) => handleStartCreate(parentPath, 'file')}
            onNewFolder={(parentPath) => handleStartCreate(parentPath, 'directory')}
            onRefresh={fetchFiles}
            onCopyPath={handleCopyPath}
            onDownload={handleDownload}
            isLoading={operationLoading}
          >
            <div
              className={cn(
                'group grid grid-cols-12 gap-2 py-[3px] pr-2 hover:bg-accent/60 cursor-pointer items-center rounded-sm transition-colors duration-100',
                isDir && isOpen && 'border-l-2 border-primary/30',
                isDir && !isOpen && 'border-l-2 border-transparent',
                !isDir && 'border-l-2 border-transparent',
                selectedItem?.path === item.path && 'bg-accent/40',
              )}
              style={{ paddingLeft: `${level * 16 + 4}px` }}
              onClick={() => handleItemClick(item)}
            >
              <div className="col-span-5 flex items-center gap-1.5 min-w-0">
                {renderItemIcons(item)}
                {isRenaming ? (
                  <Input
                    ref={renameInputRef}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') handleConfirmRename();
                      if (e.key === 'Escape') handleCancelRename();
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        if (renamingItem?.path === item.path) handleConfirmRename();
                      }, 100);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-5 text-sm flex-1"
                    disabled={operationLoading}
                  />
                ) : (
                  <span className={cn(
                    'text-[13px] leading-tight truncate',
                    isDir ? 'font-medium text-foreground' : 'text-foreground/90'
                  )}>
                    {item.name}
                  </span>
                )}
              </div>
              <div className="col-span-2 text-sm text-muted-foreground tabular-nums">
                {item.type === 'file' ? formatFileSize(item.size) : ''}
              </div>
              <div className="col-span-3 text-sm text-muted-foreground">
                {formatRelativeTime(item.modified)}
              </div>
              <div className="col-span-2 text-sm text-muted-foreground font-mono">
                {item.permissionsRwx || ''}
              </div>
            </div>
          </FileContextMenu>

          {isDir && isOpen && item.children && (
            <div className="relative">
              <span
                className="absolute top-0 bottom-0 border-l border-border/40"
                style={{ left: `${level * 16 + 14}px` }}
                aria-hidden="true"
              />
              {renderDetailedView(item.children, level + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  // ─── Compact View ──────────────────────────────────────────────────
  const renderCompactView = (items, level = 0) => {
    return items.map((item) => {
      const isDir = item.type === 'directory';
      const isOpen = isDir && expandedDirs.has(item.path);
      const isRenaming = renamingItem?.path === item.path;

      return (
        <div key={item.path} className="select-none">
          <FileContextMenu
            item={item}
            onRename={handleStartRename}
            onDelete={handleStartDelete}
            onNewFile={(parentPath) => handleStartCreate(parentPath, 'file')}
            onNewFolder={(parentPath) => handleStartCreate(parentPath, 'directory')}
            onRefresh={fetchFiles}
            onCopyPath={handleCopyPath}
            onDownload={handleDownload}
            isLoading={operationLoading}
          >
            <div
              className={cn(
                'group flex items-center justify-between py-[3px] pr-2 hover:bg-accent/60 cursor-pointer rounded-sm transition-colors duration-100',
                isDir && isOpen && 'border-l-2 border-primary/30',
                isDir && !isOpen && 'border-l-2 border-transparent',
                !isDir && 'border-l-2 border-transparent',
                selectedItem?.path === item.path && 'bg-accent/40',
              )}
              style={{ paddingLeft: `${level * 16 + 4}px` }}
              onClick={() => handleItemClick(item)}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {renderItemIcons(item)}
                {isRenaming ? (
                  <Input
                    ref={renameInputRef}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') handleConfirmRename();
                      if (e.key === 'Escape') handleCancelRename();
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        if (renamingItem?.path === item.path) handleConfirmRename();
                      }, 100);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-5 text-sm flex-1"
                    disabled={operationLoading}
                  />
                ) : (
                  <span className={cn(
                    'text-[13px] leading-tight truncate',
                    isDir ? 'font-medium text-foreground' : 'text-foreground/90'
                  )}>
                    {item.name}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground flex-shrink-0 ml-2">
                {item.type === 'file' && (
                  <>
                    <span className="tabular-nums">{formatFileSize(item.size)}</span>
                    <span className="font-mono">{item.permissionsRwx}</span>
                  </>
                )}
              </div>
            </div>
          </FileContextMenu>

          {isDir && isOpen && item.children && (
            <div className="relative">
              <span
                className="absolute top-0 bottom-0 border-l border-border/40"
                style={{ left: `${level * 16 + 14}px` }}
                aria-hidden="true"
              />
              {renderCompactView(item.children, level + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  // ─── Loading state ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-muted-foreground text-sm">
          {t('fileTree.loading')}
        </div>
      </div>
    );
  }

  // ─── Main render ───────────────────────────────────────────────────
  return (
    <div
      ref={treeRef}
      className="h-full flex flex-col bg-background relative"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">
            {t('fileTree.files')}
          </h3>
          <div className="flex gap-0.5">
            {/* File Operations Toolbar */}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => handleStartCreate('', 'file')}
              title={t('fileTree.newFile', 'New File (Cmd+N)')}
              disabled={operationLoading}
            >
              <FileText className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => handleStartCreate('', 'directory')}
              title={t('fileTree.newFolder', 'New Folder (Cmd+Shift+N)')}
              disabled={operationLoading}
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={fetchFiles}
              title={t('fileTree.refresh', 'Refresh')}
              disabled={operationLoading}
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={collapseAll}
              title={t('fileTree.collapseAll', 'Collapse All')}
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </Button>
            {/* View mode buttons */}
            <div className="w-px h-4 bg-border mx-0.5" />
            <Button
              variant={viewMode === 'simple' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => changeViewMode('simple')}
              title={t('fileTree.simpleView')}
            >
              <List className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant={viewMode === 'compact' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => changeViewMode('compact')}
              title={t('fileTree.compactView')}
            >
              <Eye className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant={viewMode === 'detailed' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => changeViewMode('detailed')}
              title={t('fileTree.detailedView')}
            >
              <TableProperties className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
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
              className="absolute right-0.5 top-1/2 transform -translate-y-1/2 h-5 w-5 p-0 hover:bg-accent"
              onClick={() => setSearchQuery('')}
              title={t('fileTree.clearSearch')}
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Column Headers for Detailed View */}
      {viewMode === 'detailed' && filteredFiles.length > 0 && (
        <div className="px-3 pt-1.5 pb-1 border-b border-border">
          <div className="grid grid-cols-12 gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            <div className="col-span-5">{t('fileTree.name')}</div>
            <div className="col-span-2">{t('fileTree.size')}</div>
            <div className="col-span-3">{t('fileTree.modified')}</div>
            <div className="col-span-2">{t('fileTree.permissions')}</div>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1 px-2 py-1">
        {/* New item input */}
        {isCreating && (
          <div
            className="flex items-center gap-1.5 py-[3px] pr-2 mb-1"
            style={{ paddingLeft: '4px' }}
          >
            {newItemType === 'directory' ? (
              <Folder className={cn(ICON_SIZE, 'text-blue-500')} />
            ) : (
              <span className="ml-[18px]">{getFileIcon(newItemName)}</span>
            )}
            <Input
              ref={newItemInputRef}
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') handleConfirmCreate();
                if (e.key === 'Escape') handleCancelCreate();
              }}
              onBlur={() => {
                // Small delay to allow button clicks
                setTimeout(() => {
                  if (isCreating) handleConfirmCreate();
                }, 100);
              }}
              className="h-6 text-sm flex-1"
              disabled={operationLoading}
            />
          </div>
        )}

        <FileContextMenu
          onNewFile={(parentPath) => handleStartCreate(parentPath, 'file')}
          onNewFolder={(parentPath) => handleStartCreate(parentPath, 'directory')}
          onRename={handleStartRename}
          onDelete={handleStartDelete}
          onRefresh={fetchFiles}
          onCopyPath={handleCopyPath}
          onDownload={handleDownload}
          isLoading={operationLoading}
        >
          <div className="min-h-full">
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
              <div>
                {viewMode === 'simple' && renderFileTree(filteredFiles)}
                {viewMode === 'compact' && renderCompactView(filteredFiles)}
                {viewMode === 'detailed' && renderDetailedView(filteredFiles)}
              </div>
            )}
          </div>
        </FileContextMenu>
      </ScrollArea>

      {/* Drag and Drop Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-primary/5 border-2 border-dashed border-primary/50 flex items-center justify-center z-10 rounded-lg">
          <div className="text-center">
            <Upload className="w-10 h-10 text-primary mx-auto mb-2" />
            <p className="text-sm font-medium text-primary">
              {t('fileTree.dropToUpload', 'Drop files to upload')}
            </p>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteDialog.isOpen && deleteDialog.item && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-popover border border-border rounded-lg shadow-lg max-w-md w-full mx-4 p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground mb-1">
                  {t('fileTree.delete.title', 'Delete Confirmation')}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {deleteDialog.item.type === 'directory'
                    ? t('fileTree.delete.folderWarning', {
                        name: deleteDialog.item.name,
                        defaultValue: `Are you sure you want to delete "${deleteDialog.item.name}" and all its contents?`
                      })
                    : t('fileTree.delete.fileWarning', {
                        name: deleteDialog.item.name,
                        defaultValue: `Are you sure you want to delete "${deleteDialog.item.name}"?`
                      })
                  }
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button
                variant="ghost"
                onClick={handleCancelDelete}
                disabled={operationLoading}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={operationLoading}
              >
                {operationLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-2" />
                )}
                {t('fileTree.delete.confirm', 'Delete')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={cn(
          'absolute bottom-4 left-4 right-4 p-3 rounded-lg shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom-2',
          toast.type === 'error' ? 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200' :
          'bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-200'
        )}>
          {toast.type === 'error' ? (
            <XCircle className="w-4 h-4 flex-shrink-0" />
          ) : (
            <Check className="w-4 h-4 flex-shrink-0" />
          )}
          <span className="text-sm flex-1">{toast.message}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setToast(null)}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}

      {/* Image Viewer Modal */}
      {selectedImage && (
        <ImageViewer
          file={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}

      {/* Hidden file input for upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) {
            // Handle file selection
            const formData = new FormData();
            files.forEach(file => formData.append('files', file));
            // Upload logic would go here
          }
          e.target.value = '';
        }}
      />
    </div>
  );
}

export default FileTree;

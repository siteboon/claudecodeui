import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Folder, FolderOpen, File, FileText, FileCode, List, TableProperties, Eye, Search, X,
  ChevronRight,
  FileJson, FileType, FileSpreadsheet, FileArchive,
  Hash, Braces, Terminal, Database, Globe, Palette, Music2, Video, Archive,
  Lock, Shield, Settings, Image, BookOpen, Cpu, Box, Gem, Coffee,
  Flame, Hexagon, FileCode2, Code2, Cog, FileWarning, Binary, SquareFunction,
  Scroll, FlaskConical, NotebookPen, FileCheck, Workflow, Blocks
} from 'lucide-react';
import { cn } from '../lib/utils';
import CodeEditor from './CodeEditor';
import ImageViewer from './ImageViewer';
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
  map:  { icon: File,       color: 'text-gray-400' },
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
  return { icon: File, color: 'text-muted-foreground' };
}


// ─── Component ───────────────────────────────────────────────────────

function FileTree({ selectedProject }) {
  const { t } = useTranslation();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [viewMode, setViewMode] = useState('detailed');
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredFiles, setFilteredFiles] = useState([]);

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

  // ── Click handler shared across all view modes ──
  const handleItemClick = (item) => {
    if (item.type === 'directory') {
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
  };

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

      return (
        <div key={item.path} className="select-none">
          <div
            className={cn(
              'group flex items-center gap-1.5 py-[3px] pr-2 cursor-pointer rounded-sm',
              'hover:bg-accent/60 transition-colors duration-100',
              isDir && isOpen && 'border-l-2 border-primary/30',
              isDir && !isOpen && 'border-l-2 border-transparent',
              !isDir && 'border-l-2 border-transparent',
            )}
            style={{ paddingLeft: `${level * 16 + 4}px` }}
            onClick={() => handleItemClick(item)}
          >
            {renderItemIcons(item)}
            <span className={cn(
              'text-[13px] leading-tight truncate',
              isDir ? 'font-medium text-foreground' : 'text-foreground/90'
            )}>
              {item.name}
            </span>
          </div>

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

      return (
        <div key={item.path} className="select-none">
          <div
            className={cn(
              'group grid grid-cols-12 gap-2 py-[3px] pr-2 hover:bg-accent/60 cursor-pointer items-center rounded-sm transition-colors duration-100',
              isDir && isOpen && 'border-l-2 border-primary/30',
              isDir && !isOpen && 'border-l-2 border-transparent',
              !isDir && 'border-l-2 border-transparent',
            )}
            style={{ paddingLeft: `${level * 16 + 4}px` }}
            onClick={() => handleItemClick(item)}
          >
            <div className="col-span-5 flex items-center gap-1.5 min-w-0">
              {renderItemIcons(item)}
              <span className={cn(
                'text-[13px] leading-tight truncate',
                isDir ? 'font-medium text-foreground' : 'text-foreground/90'
              )}>
                {item.name}
              </span>
            </div>
            <div className="col-span-2 text-xs text-muted-foreground tabular-nums">
              {item.type === 'file' ? formatFileSize(item.size) : ''}
            </div>
            <div className="col-span-3 text-xs text-muted-foreground">
              {formatRelativeTime(item.modified)}
            </div>
            <div className="col-span-2 text-xs text-muted-foreground font-mono">
              {item.permissionsRwx || ''}
            </div>
          </div>

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

      return (
        <div key={item.path} className="select-none">
          <div
            className={cn(
              'group flex items-center justify-between py-[3px] pr-2 hover:bg-accent/60 cursor-pointer rounded-sm transition-colors duration-100',
              isDir && isOpen && 'border-l-2 border-primary/30',
              isDir && !isOpen && 'border-l-2 border-transparent',
              !isDir && 'border-l-2 border-transparent',
            )}
            style={{ paddingLeft: `${level * 16 + 4}px` }}
            onClick={() => handleItemClick(item)}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {renderItemIcons(item)}
              <span className={cn(
                'text-[13px] leading-tight truncate',
                isDir ? 'font-medium text-foreground' : 'text-foreground/90'
              )}>
                {item.name}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0 ml-2">
              {item.type === 'file' && (
                <>
                  <span className="tabular-nums">{formatFileSize(item.size)}</span>
                  <span className="font-mono">{item.permissionsRwx}</span>
                </>
              )}
            </div>
          </div>

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
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('fileTree.files')}
          </h3>
          <div className="flex gap-0.5">
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
            className="pl-7 pr-7 h-7 text-xs"
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
    </div>
  );
}

export default FileTree;

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  FolderPlus,
  Pencil,
  Trash2,
  Copy,
  Download,
  RefreshCw,
  ChevronRight,
  MoreHorizontal
} from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * FileContextMenu Component
 * Right-click context menu for file/directory operations
 */
const FileContextMenu = ({
  children,
  item,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onRefresh,
  onCopyPath,
  onDownload,
  isLoading = false,
  className = ''
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef(null);
  const triggerRef = useRef(null);

  const isDirectory = item?.type === 'directory';
  const isFile = item?.type === 'file';
  const isBackground = !item; // Clicked on empty space

  // Handle right-click
  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    // Adjust position if menu would go off screen
    const menuWidth = 200;
    const menuHeight = 300;

    let adjustedX = x;
    let adjustedY = y;

    if (x + menuWidth > window.innerWidth) {
      adjustedX = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight) {
      adjustedY = window.innerHeight - menuHeight - 10;
    }

    setPosition({ x: adjustedX, y: adjustedY });
    setIsOpen(true);
  }, []);

  // Close menu
  const closeMenu = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        closeMenu();
      }
    };

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        closeMenu();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, closeMenu]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      const menuItems = menuRef.current?.querySelectorAll('[role="menuitem"]');
      if (!menuItems || menuItems.length === 0) return;

      const currentIndex = Array.from(menuItems).findIndex(
        (item) => item === document.activeElement
      );

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          const nextIndex = currentIndex < menuItems.length - 1 ? currentIndex + 1 : 0;
          menuItems[nextIndex]?.focus();
          break;
        case 'ArrowUp':
          e.preventDefault();
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : menuItems.length - 1;
          menuItems[prevIndex]?.focus();
          break;
        case 'Enter':
        case ' ':
          if (document.activeElement?.hasAttribute('role', 'menuitem')) {
            e.preventDefault();
            document.activeElement.click();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Handle action click
  const handleAction = (action, ...args) => {
    closeMenu();
    action?.(...args);
  };

  // Menu item component
  const MenuItem = ({ icon: Icon, label, onClick, danger = false, disabled = false, shortcut }) => (
    <button
      role="menuitem"
      tabIndex={disabled ? -1 : 0}
      disabled={disabled || isLoading}
      onClick={() => handleAction(onClick)}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 text-sm text-left rounded-md transition-colors',
        'focus:outline-none focus:bg-accent',
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : danger
          ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950'
          : 'hover:bg-accent',
        isLoading && 'pointer-events-none'
      )}
    >
      {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
      <span className="flex-1">{label}</span>
      {shortcut && (
        <span className="text-xs text-muted-foreground font-mono">{shortcut}</span>
      )}
    </button>
  );

  // Menu divider
  const MenuDivider = () => (
    <div className="h-px bg-border my-1 mx-2" />
  );

  // Build menu items based on context
  const renderMenuItems = () => {
    if (isFile) {
      return (
        <>
          <MenuItem
            icon={Pencil}
            label={t('fileTree.context.rename', 'Rename')}
            onClick={() => onRename?.(item)}
            shortcut="F2"
          />
          <MenuItem
            icon={Trash2}
            label={t('fileTree.context.delete', 'Delete')}
            onClick={() => onDelete?.(item)}
            danger
            shortcut="Del"
          />
          <MenuDivider />
          <MenuItem
            icon={Copy}
            label={t('fileTree.context.copyPath', 'Copy Path')}
            onClick={() => onCopyPath?.(item)}
          />
          <MenuItem
            icon={Download}
            label={t('fileTree.context.download', 'Download')}
            onClick={() => onDownload?.(item)}
          />
        </>
      );
    }

    if (isDirectory) {
      return (
        <>
          <MenuItem
            icon={FileText}
            label={t('fileTree.context.newFile', 'New File')}
            onClick={() => onNewFile?.(item.path)}
            shortcut="⌘N"
          />
          <MenuItem
            icon={FolderPlus}
            label={t('fileTree.context.newFolder', 'New Folder')}
            onClick={() => onNewFolder?.(item.path)}
            shortcut="⇧⌘N"
          />
          <MenuDivider />
          <MenuItem
            icon={Pencil}
            label={t('fileTree.context.rename', 'Rename')}
            onClick={() => onRename?.(item)}
            shortcut="F2"
          />
          <MenuItem
            icon={Trash2}
            label={t('fileTree.context.delete', 'Delete')}
            onClick={() => onDelete?.(item)}
            danger
            shortcut="Del"
          />
          <MenuDivider />
          <MenuItem
            icon={Copy}
            label={t('fileTree.context.copyPath', 'Copy Path')}
            onClick={() => onCopyPath?.(item)}
          />
          <MenuItem
            icon={Download}
            label={t('fileTree.context.download', 'Download')}
            onClick={() => onDownload?.(item)}
          />
        </>
      );
    }

    // Background context (empty space)
    return (
      <>
        <MenuItem
          icon={FileText}
          label={t('fileTree.context.newFile', 'New File')}
          onClick={() => onNewFile?.('')}
          shortcut="⌘N"
        />
        <MenuItem
          icon={FolderPlus}
          label={t('fileTree.context.newFolder', 'New Folder')}
          onClick={() => onNewFolder?.('')}
          shortcut="⇧⌘N"
        />
        <MenuDivider />
        <MenuItem
          icon={RefreshCw}
          label={t('fileTree.context.refresh', 'Refresh')}
          onClick={onRefresh}
          shortcut="⌘R"
        />
      </>
    );
  };

  return (
    <>
      {/* Trigger element */}
      <div
        ref={triggerRef}
        onContextMenu={handleContextMenu}
        className={cn('contents', className)}
      >
        {children}
      </div>

      {/* Context menu portal */}
      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('fileTree.context.menuLabel', 'File context menu')}
          style={{
            position: 'fixed',
            left: position.x,
            top: position.y,
            zIndex: 9999
          }}
          className={cn(
            'min-w-[180px] py-1 px-1',
            'bg-popover border border-border rounded-lg shadow-lg',
            'animate-in fade-in-0 zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95'
          )}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                {t('fileTree.context.loading', 'Loading...')}
              </span>
            </div>
          ) : (
            renderMenuItems()
          )}
        </div>
      )}
    </>
  );
};

export default FileContextMenu;

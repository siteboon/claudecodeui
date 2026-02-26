import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Copy,
  Download,
  FileText,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { FileTreeNode } from '../types/types';

type FileContextMenuProps = {
  children: React.ReactNode;
  item: FileTreeNode | null;
  onRename?: (item: FileTreeNode) => void;
  onDelete?: (item: FileTreeNode) => void;
  onNewFile?: (parentPath: string) => void;
  onNewFolder?: (parentPath: string) => void;
  onRefresh?: () => void;
  onCopyPath?: (item: FileTreeNode) => void;
  onDownload?: (item: FileTreeNode) => void;
  isLoading?: boolean;
  className?: string;
};

export default function FileContextMenu({
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
  className = '',
}: FileContextMenuProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  const isDirectory = item?.type === 'directory';
  const isFile = item?.type === 'file';
  const isBackground = !item;

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const x = e.clientX;
    const y = e.clientY;

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

  const closeMenu = useCallback(() => {
    setIsOpen(false);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
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

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const menuItems = menuRef.current?.querySelectorAll('[role="menuitem"]');
      if (!menuItems || menuItems.length === 0) return;

      const currentIndex = Array.from(menuItems).findIndex(
        (menuItem) => menuItem === document.activeElement
      );

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          {
            const nextIndex = currentIndex < menuItems.length - 1 ? currentIndex + 1 : 0;
            (menuItems[nextIndex] as HTMLElement)?.focus();
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          {
            const prevIndex = currentIndex > 0 ? currentIndex - 1 : menuItems.length - 1;
            (menuItems[prevIndex] as HTMLElement)?.focus();
          }
          break;
        case 'Enter':
        case ' ':
          if (document.activeElement?.getAttribute('role') === 'menuitem') {
            e.preventDefault();
            (document.activeElement as HTMLElement).click();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleAction = (action?: (...args: unknown[]) => void, ...args: unknown[]) => {
    closeMenu();
    action?.(...args);
  };

  type MenuItemProps = {
    icon?: typeof FileText;
    label: string;
    onClick?: () => void;
    danger?: boolean;
    disabled?: boolean;
    shortcut?: string;
  };

  const MenuItem = ({ icon: Icon, label, onClick, danger = false, disabled = false, shortcut }: MenuItemProps) => (
    <button
      type="button"
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

  const MenuDivider = () => (
    <div className="h-px bg-border my-1 mx-2" />
  );

  const renderMenuItems = () => {
    if (isFile && item) {
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

    if (isDirectory && item) {
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
        </>
      );
    }

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
      <div
        onContextMenu={handleContextMenu}
        className={cn('contents', className)}
      >
        {children}
      </div>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('fileTree.context.menuLabel', 'File context menu')}
          style={{
            position: 'fixed',
            left: position.x,
            top: position.y,
            zIndex: 9999,
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
}

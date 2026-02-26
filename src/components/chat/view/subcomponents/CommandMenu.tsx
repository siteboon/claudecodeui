import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

type CommandMenuCommand = {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: { type?: string; [key: string]: unknown };
  [key: string]: unknown;
};

type CommandMenuProps = {
  commands?: CommandMenuCommand[];
  selectedIndex?: number;
  onSelect?: (command: CommandMenuCommand, index: number, isHover: boolean) => void;
  onClose: () => void;
  position?: { top: number; left: number; bottom?: number };
  isOpen?: boolean;
  frequentCommands?: CommandMenuCommand[];
};

const menuBaseStyle: CSSProperties = {
  maxHeight: '300px',
  overflowY: 'auto',
  borderRadius: '8px',
  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  zIndex: 1000,
  padding: '8px',
  transition: 'opacity 150ms ease-in-out, transform 150ms ease-in-out',
};

const namespaceLabels: Record<string, string> = {
  frequent: 'Frequently Used',
  builtin: 'Built-in Commands',
  project: 'Project Commands',
  user: 'User Commands',
  other: 'Other Commands',
};

const namespaceIcons: Record<string, string> = {
  frequent: '[*]',
  builtin: '[B]',
  project: '[P]',
  user: '[U]',
  other: '[O]',
};

const getCommandKey = (command: CommandMenuCommand) =>
  `${command.name}::${command.namespace || command.type || 'other'}::${command.path || ''}`;

const getNamespace = (command: CommandMenuCommand) => command.namespace || command.type || 'other';

const getMenuPosition = (position: { top: number; left: number; bottom?: number }): CSSProperties => {
  if (typeof window === 'undefined') {
    return { position: 'fixed', top: '16px', left: '16px' };
  }
  if (window.innerWidth < 640) {
    return {
      position: 'fixed',
      bottom: `${position.bottom ?? 90}px`,
      left: '16px',
      right: '16px',
      width: 'auto',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'min(50vh, 300px)',
    };
  }
  return {
    position: 'fixed',
    top: `${Math.max(16, Math.min(position.top, window.innerHeight - 316))}px`,
    left: `${position.left}px`,
    width: 'min(400px, calc(100vw - 32px))',
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: '300px',
  };
};

export default function CommandMenu({
  commands = [],
  selectedIndex = -1,
  onSelect,
  onClose,
  position = { top: 0, left: 0 },
  isOpen = false,
  frequentCommands = [],
}: CommandMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedItemRef = useRef<HTMLDivElement | null>(null);
  const menuPosition = getMenuPosition(position);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current || !(event.target instanceof Node)) {
        return;
      }
      if (!menuRef.current.contains(event.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!selectedItemRef.current || !menuRef.current) {
      return;
    }
    const menuRect = menuRef.current.getBoundingClientRect();
    const itemRect = selectedItemRef.current.getBoundingClientRect();
    if (itemRect.bottom > menuRect.bottom || itemRect.top < menuRect.top) {
      selectedItemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  if (!isOpen) {
    return null;
  }

  const hasFrequentCommands = frequentCommands.length > 0;
  const frequentCommandKeys = new Set(frequentCommands.map(getCommandKey));
  const groupedCommands = commands.reduce<Record<string, CommandMenuCommand[]>>((groups, command) => {
    if (hasFrequentCommands && frequentCommandKeys.has(getCommandKey(command))) {
      return groups;
    }
    const namespace = getNamespace(command);
    if (!groups[namespace]) {
      groups[namespace] = [];
    }
    groups[namespace].push(command);
    return groups;
  }, {});
  if (hasFrequentCommands) {
    groupedCommands.frequent = frequentCommands;
  }

  const preferredOrder = hasFrequentCommands
    ? ['frequent', 'builtin', 'project', 'user', 'other']
    : ['builtin', 'project', 'user', 'other'];
  const extraNamespaces = Object.keys(groupedCommands).filter((namespace) => !preferredOrder.includes(namespace));
  const orderedNamespaces = [...preferredOrder, ...extraNamespaces].filter((namespace) => groupedCommands[namespace]);

  const commandIndexByKey = new Map<string, number>();
  commands.forEach((command, index) => {
    const key = getCommandKey(command);
    if (!commandIndexByKey.has(key)) {
      commandIndexByKey.set(key, index);
    }
  });

  if (commands.length === 0) {
    return (
      <div
        ref={menuRef}
        className="command-menu command-menu-empty border border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
        style={{ ...menuPosition, ...menuBaseStyle, overflowY: 'hidden', padding: '20px', opacity: 1, transform: 'translateY(0)', textAlign: 'center' }}
      >
        No commands available
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      role="listbox"
      aria-label="Available commands"
      className="command-menu border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
      style={{ ...menuPosition, ...menuBaseStyle, opacity: 1, transform: 'translateY(0)' }}
    >
      {orderedNamespaces.map((namespace) => (
        <div key={namespace} className="command-group">
          {orderedNamespaces.length > 1 && (
            <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {namespaceLabels[namespace] || namespace}
            </div>
          )}

          {(groupedCommands[namespace] || []).map((command) => {
            const commandKey = getCommandKey(command);
            const commandIndex = commandIndexByKey.get(commandKey) ?? -1;
            const isSelected = commandIndex === selectedIndex;
            return (
              <div
                key={`${namespace}-${command.name}-${command.path || ''}`}
                ref={isSelected ? selectedItemRef : null}
                role="option"
                aria-selected={isSelected}
                className={`command-item mb-0.5 flex cursor-pointer items-start rounded-md px-3 py-2.5 transition-colors ${
                  isSelected ? 'bg-blue-50 dark:bg-blue-900' : 'bg-transparent'
                }`}
                onMouseEnter={() => onSelect && commandIndex >= 0 && onSelect(command, commandIndex, true)}
                onClick={() => onSelect && commandIndex >= 0 && onSelect(command, commandIndex, false)}
                onMouseDown={(event) => event.preventDefault()}
              >
                <div className="min-w-0 flex-1">
                  <div className={`flex items-center gap-2 ${command.description ? 'mb-1' : 'mb-0'}`}>
                    <span className="shrink-0 text-xs text-gray-500 dark:text-gray-300">{namespaceIcons[namespace] || namespaceIcons.other}</span>
                    <span className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">{command.name}</span>
                    {command.metadata?.type && (
                      <span className="command-metadata-badge rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                        {command.metadata.type}
                      </span>
                    )}
                  </div>
                  {command.description && (
                    <div className="ml-6 truncate whitespace-nowrap text-[13px] text-gray-500 dark:text-gray-300">
                      {command.description}
                    </div>
                  )}
                </div>
                {isSelected && <span className="ml-2 text-xs font-semibold text-blue-500 dark:text-blue-300">{'<-'}</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

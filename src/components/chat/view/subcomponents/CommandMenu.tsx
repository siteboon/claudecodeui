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
        className="command-menu command-menu-empty"
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
      className="command-menu"
      style={{ ...menuPosition, ...menuBaseStyle, opacity: isOpen ? 1 : 0, transform: isOpen ? 'translateY(0)' : 'translateY(-10px)' }}
    >
      {orderedNamespaces.map((namespace) => (
        <div key={namespace} className="command-group">
          {orderedNamespaces.length > 1 && (
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: '#6b7280', padding: '8px 12px 4px', letterSpacing: '0.05em' }}>
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
                className="command-item"
                onMouseEnter={() => onSelect && commandIndex >= 0 && onSelect(command, commandIndex, true)}
                onClick={() => onSelect && onSelect(command, commandIndex, false)}
                onMouseDown={(event) => event.preventDefault()}
                style={{ display: 'flex', alignItems: 'flex-start', padding: '10px 12px', borderRadius: '6px', cursor: 'pointer', backgroundColor: isSelected ? '#eff6ff' : 'transparent', transition: 'background-color 100ms ease-in-out', marginBottom: '2px' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: command.description ? '4px' : 0 }}>
                    <span style={{ fontSize: '12px', flexShrink: 0 }}>{namespaceIcons[namespace] || namespaceIcons.other}</span>
                    <span style={{ fontWeight: 600, fontSize: '14px', color: '#111827', fontFamily: 'monospace' }}>{command.name}</span>
                    {command.metadata?.type && (
                      <span className="command-metadata-badge" style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#f3f4f6', color: '#6b7280', fontWeight: 500 }}>
                        {command.metadata.type}
                      </span>
                    )}
                  </div>
                  {command.description && (
                    <div style={{ fontSize: '13px', color: '#6b7280', marginLeft: '24px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {command.description}
                    </div>
                  )}
                </div>
                {isSelected && <span style={{ marginLeft: '8px', color: '#3b82f6', fontSize: '12px', fontWeight: 600 }}>{'<-'}</span>}
              </div>
            );
          })}
        </div>
      ))}

      <style>{`
        .command-menu {
          background-color: white;
          border: 1px solid #e5e7eb;
        }
        .command-menu-empty {
          color: #6b7280;
        }
        @media (prefers-color-scheme: dark) {
          .command-menu {
            background-color: #1f2937 !important;
            border: 1px solid #374151 !important;
          }
          .command-menu-empty {
            color: #9ca3af !important;
          }
          .command-item[aria-selected="true"] {
            background-color: #1e40af !important;
          }
          .command-item span:not(.command-metadata-badge) {
            color: #f3f4f6 !important;
          }
          .command-metadata-badge {
            background-color: #f3f4f6 !important;
            color: #6b7280 !important;
          }
          .command-item div {
            color: #d1d5db !important;
          }
          .command-group > div:first-child {
            color: #9ca3af !important;
          }
        }
      `}</style>
    </div>
  );
}

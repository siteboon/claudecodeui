import React, { useEffect, useRef } from 'react';

/**
 * CommandMenu - Autocomplete dropdown for slash commands
 *
 * @param {Array} commands - Array of command objects to display
 * @param {number} selectedIndex - Currently selected command index
 * @param {Function} onSelect - Callback when a command is selected
 * @param {Function} onClose - Callback when menu should close
 * @param {Object} position - Position object { top, left } for absolute positioning
 * @param {boolean} isOpen - Whether the menu is open
 * @param {Array} frequentCommands - Array of frequently used command objects
 */
const CommandMenu = ({ commands = [], selectedIndex = -1, onSelect, onClose, position = { top: 0, left: 0 }, isOpen = false, frequentCommands = [] }) => {
  const menuRef = useRef(null);
  const selectedItemRef = useRef(null);

  // Calculate responsive positioning
  const getMenuPosition = () => {
    const isMobile = window.innerWidth < 640;
    const viewportHeight = window.innerHeight;
    const menuHeight = 300; // Max height of menu

    if (isMobile) {
      // On mobile, calculate bottom position dynamically to appear above the input
      // Use the bottom value which is calculated as: window.innerHeight - textarea.top + spacing
      const inputBottom = position.bottom || 90; // Use provided bottom or default

      return {
        position: 'fixed',
        bottom: `${inputBottom}px`, // Position above the input with spacing already included
        left: '16px',
        right: '16px',
        width: 'auto',
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'min(50vh, 300px)' // Limit to smaller of 50vh or 300px
      };
    }

    // On desktop, use provided position but ensure it stays on screen
    return {
      position: 'fixed',
      top: `${Math.max(16, Math.min(position.top, viewportHeight - 316))}px`,
      left: `${position.left}px`,
      width: 'min(400px, calc(100vw - 32px))',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: '300px'
    };
  };

  const menuPosition = getMenuPosition();

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target) && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedItemRef.current && menuRef.current) {
      const menuRect = menuRef.current.getBoundingClientRect();
      const itemRect = selectedItemRef.current.getBoundingClientRect();

      if (itemRect.bottom > menuRect.bottom) {
        selectedItemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (itemRect.top < menuRect.top) {
        selectedItemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) {
    return null;
  }

  // Show a message if no commands are available
  if (commands.length === 0) {
    return (
      <div
        ref={menuRef}
        className="command-menu command-menu-empty"
        style={{
          ...menuPosition,
          maxHeight: '300px',
          borderRadius: '8px',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
          zIndex: 1000,
          padding: '20px',
          opacity: 1,
          transform: 'translateY(0)',
          transition: 'opacity 150ms ease-in-out, transform 150ms ease-in-out',
          textAlign: 'center'
        }}
      >
        No commands available
      </div>
    );
  }

  // Add frequent commands as a special group if provided
  const hasFrequentCommands = frequentCommands.length > 0;

  // Group commands by namespace
  const groupedCommands = commands.reduce((groups, command) => {
    const namespace = command.namespace || command.type || 'other';
    if (!groups[namespace]) {
      groups[namespace] = [];
    }
    groups[namespace].push(command);
    return groups;
  }, {});

  // Add frequent commands as a separate group
  if (hasFrequentCommands) {
    groupedCommands['frequent'] = frequentCommands;
  }

  // Order: frequent, builtin, project, user, other
  const namespaceOrder = hasFrequentCommands
    ? ['frequent', 'builtin', 'project', 'user', 'other']
    : ['builtin', 'project', 'user', 'other'];
  const orderedNamespaces = namespaceOrder.filter(ns => groupedCommands[ns]);

  const namespaceLabels = {
    frequent: '⭐ Frequently Used',
    builtin: 'Built-in Commands',
    project: 'Project Commands',
    user: 'User Commands',
    other: 'Other Commands'
  };

  // Calculate global index for each command
  let globalIndex = 0;
  const commandsWithIndex = [];
  orderedNamespaces.forEach(namespace => {
    groupedCommands[namespace].forEach(command => {
      commandsWithIndex.push({
        ...command,
        globalIndex: globalIndex++,
        namespace
      });
    });
  });

  return (
    <div
      ref={menuRef}
      role="listbox"
      aria-label="Available commands"
      className="command-menu"
      style={{
        ...menuPosition,
        maxHeight: '300px',
        overflowY: 'auto',
        borderRadius: '8px',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        zIndex: 1000,
        padding: '8px',
        opacity: isOpen ? 1 : 0,
        transform: isOpen ? 'translateY(0)' : 'translateY(-10px)',
        transition: 'opacity 150ms ease-in-out, transform 150ms ease-in-out'
      }}
    >
      {orderedNamespaces.map((namespace) => (
        <div key={namespace} className="command-group">
          {orderedNamespaces.length > 1 && (
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                color: '#6b7280',
                padding: '8px 12px 4px',
                letterSpacing: '0.05em'
              }}
            >
              {namespaceLabels[namespace] || namespace}
            </div>
          )}
          {groupedCommands[namespace].map((command) => {
            const cmdWithIndex = commandsWithIndex.find(c => c.name === command.name && c.namespace === namespace);
            const isSelected = cmdWithIndex && cmdWithIndex.globalIndex === selectedIndex;

            return (
              <div
                key={`${namespace}-${command.name}`}
                ref={isSelected ? selectedItemRef : null}
                role="option"
                aria-selected={isSelected}
                className="command-item"
                onMouseEnter={() => onSelect && onSelect(command, cmdWithIndex.globalIndex, true)}
                onClick={() => onSelect && onSelect(command, cmdWithIndex.globalIndex, false)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  backgroundColor: isSelected ? '#eff6ff' : 'transparent',
                  transition: 'background-color 100ms ease-in-out',
                  marginBottom: '2px'
                }}
                onMouseDown={(e) => e.preventDefault()} // Prevent textarea blur
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: command.description ? '4px' : 0
                    }}
                  >
                    {/* Command icon based on namespace */}
                    <span
                      style={{
                        fontSize: '16px',
                        flexShrink: 0
                      }}
                    >
                      {namespace === 'builtin' && '⚡'}
                      {namespace === 'project' && '📁'}
                      {namespace === 'user' && '👤'}
                      {namespace === 'other' && '📝'}
                    </span>

                    {/* Command name */}
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: '14px',
                        color: '#111827',
                        fontFamily: 'monospace'
                      }}
                    >
                      {command.name}
                    </span>

                    {/* Command metadata badge */}
                    {command.metadata?.type && (
                      <span
                        className="command-metadata-badge"
                        style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          backgroundColor: '#f3f4f6',
                          color: '#6b7280',
                          fontWeight: 500
                        }}
                      >
                        {command.metadata.type}
                      </span>
                    )}
                  </div>

                  {/* Command description */}
                  {command.description && (
                    <div
                      style={{
                        fontSize: '13px',
                        color: '#6b7280',
                        marginLeft: '24px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {command.description}
                    </div>
                  )}
                </div>

                {/* Selection indicator */}
                {isSelected && (
                  <span
                    style={{
                      marginLeft: '8px',
                      color: '#3b82f6',
                      fontSize: '12px',
                      fontWeight: 600
                    }}
                  >
                    ↵
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* Default light mode styles */}
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
};

export default CommandMenu;

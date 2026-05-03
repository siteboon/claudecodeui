import { useEffect, useRef } from 'react';
import { Pencil, Pin, Trash2 } from 'lucide-react';

interface ConversationContextMenuProps {
  position: { x: number; y: number };
  onClose: () => void;
  onRename: () => void;
  onPin: () => void;
  onDelete: () => void;
}

export default function ConversationContextMenu({
  position,
  onClose,
  onRename,
  onPin,
  onDelete,
}: ConversationContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  function item(label: string, icon: React.ReactNode, action: () => void, testId?: string, extraClass?: string) {
    return (
      <button
        data-testid={testId}
        className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-accent ${extraClass || ''}`}
        onClick={() => { action(); onClose(); }}
      >
        {icon}
        {label}
      </button>
    );
  }

  return (
    <div
      ref={ref}
      data-testid="context-menu"
      className="fixed z-50 min-w-[160px] rounded-lg border border-border bg-popover p-1 shadow-md"
      style={{ left: position.x, top: position.y }}
    >
      {item('Rename', <Pencil size={14} />, onRename)}
      {item('Pin to top', <Pin size={14} />, onPin)}
      {item('Delete', <Trash2 size={14} />, onDelete, 'context-menu-delete', 'text-destructive')}
    </div>
  );
}

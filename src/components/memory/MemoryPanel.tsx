import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Search, Pencil, Trash2 } from 'lucide-react';
import type { MemoryEntry, MemoryPanelProps } from './types';

const TYPE_COLORS: Record<MemoryEntry['type'], string> = {
  user: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  project: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  style: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400',
};

export default function MemoryPanel({ isOpen, onClose, memories, onEdit, onDelete }: MemoryPanelProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const filtered = useMemo(() => {
    if (!search) return memories;
    const lower = search.toLowerCase();
    return memories.filter(
      (m) => m.title.toLowerCase().includes(lower) || m.content.toLowerCase().includes(lower),
    );
  }, [memories, search]);

  const handleStartEdit = (memory: MemoryEntry) => {
    setEditingId(memory.id);
    setEditContent(memory.content);
  };

  const handleSave = () => {
    if (editingId) {
      onEdit(editingId, editContent);
      setEditingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold text-foreground">{t('memory.title')}</span>
        <button type="button" aria-label={t('memory.close')} onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-secondary">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-2 py-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={t('memory.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">{t('memory.empty')}</div>
        ) : (
          filtered.map((memory) => (
            <div key={memory.id} className="border-b border-border/50 px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{memory.title}</span>
                    <span
                      data-testid="memory-type-badge"
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${TYPE_COLORS[memory.type]}`}
                    >
                      {memory.type}
                    </span>
                  </div>
                  {editingId === memory.id ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full rounded border border-border bg-secondary/30 px-2 py-1 text-sm text-foreground outline-none focus:border-primary/50"
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <button type="button" onClick={handleSave} className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground">
                          {t('memory.save')}
                        </button>
                        <button type="button" onClick={() => setEditingId(null)} className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                          {t('memory.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">{memory.content}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" aria-label={t('memory.edit')} onClick={() => handleStartEdit(memory)} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-label={t('memory.delete')} onClick={() => onDelete(memory.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

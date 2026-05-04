import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMemories } from '../../../../hooks/useMemories';
import SettingsCard from '../SettingsCard';
import SettingsSection from '../SettingsSection';

export default function MemoryTab() {
  const { t } = useTranslation('settings');
  const { memories, addMemory, deleteMemory, toggleMemory } = useMemories();
  const [newMemory, setNewMemory] = useState('');

  const handleAdd = () => {
    const trimmed = newMemory.trim();
    if (!trimmed) return;
    addMemory(trimmed);
    setNewMemory('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection title={t('mainTabs.memory', 'Memory')}>
        <SettingsCard>
          <div className="space-y-4 p-1">
            <p className="text-sm text-muted-foreground">
              {t('memory.description', 'Memories are included with every message to personalize responses. Toggle individual memories on or off.')}
            </p>

            {/* Add new memory */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newMemory}
                onChange={(e) => setNewMemory(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('memory.placeholder', 'Add a memory...')}
                className="flex-1 rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={handleAdd}
                aria-label="Add"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t('memory.add', 'Add')}
              </button>
            </div>

            {/* Memory list */}
            {memories.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t('memory.empty', 'No memories yet. Add one above to get started.')}
              </p>
            ) : (
              <ul className="space-y-2">
                {memories.map((memory) => (
                  <li
                    key={memory.id}
                    className="flex items-center gap-3 rounded-lg border border-border p-3"
                  >
                    <input
                      type="checkbox"
                      role="checkbox"
                      checked={memory.enabled}
                      onChange={() => toggleMemory(memory.id)}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    <span className={`flex-1 text-sm ${memory.enabled ? 'text-foreground' : 'text-muted-foreground line-through'}`}>
                      {memory.content}
                    </span>
                    <button
                      onClick={() => deleteMemory(memory.id)}
                      aria-label="Delete"
                      className="text-xs text-muted-foreground transition-colors hover:text-destructive"
                    >
                      {t('memory.delete', 'Delete')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

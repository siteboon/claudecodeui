import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import SettingsCard from '../SettingsCard';
import SettingsSection from '../SettingsSection';

const STORAGE_KEY = 'custom-instructions';

export default function CustomInstructionsTab() {
  const { t } = useTranslation('settings');
  const [instructions, setInstructions] = useState(() =>
    localStorage.getItem(STORAGE_KEY) || ''
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSaved(false);
  }, [instructions]);

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, instructions);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-8">
      <SettingsSection title={t('mainTabs.instructions', 'Custom Instructions')}>
        <SettingsCard>
          <div className="space-y-3 p-1">
            <p className="text-sm text-muted-foreground">
              {t('instructions.description', 'Provide custom instructions that will be included with every message you send. Use this to set preferences, context, or guidelines.')}
            </p>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={t('instructions.placeholder', 'e.g., "Always respond in a concise manner. Use TypeScript for code examples."')}
              className="min-h-[200px] w-full resize-y rounded-lg border border-input bg-card p-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {instructions.length} {t('instructions.characters', 'characters')}
              </span>
              <button
                onClick={handleSave}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {saved ? t('instructions.saved', 'Saved!') : t('instructions.save', 'Save')}
              </button>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

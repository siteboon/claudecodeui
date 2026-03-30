import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Button, DarkModeToggle } from '../../../../shared/view/ui';
import { cn } from '../../../../lib/utils';

type CodeEditorSettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  onThemeChange: (value: 'dark' | 'light') => void;
  wordWrap: boolean;
  onWordWrapChange: (value: boolean) => void;
  minimapEnabled: boolean;
  onMinimapChange: (value: boolean) => void;
  showLineNumbers: boolean;
  onShowLineNumbersChange: (value: boolean) => void;
  fontSize: number;
  onFontSizeChange: (value: number) => void;
};

const SwitchControl = ({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    onClick={() => onChange(!checked)}
    className={cn(
      'relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full border-2 transition-colors duration-200',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      checked ? 'border-primary bg-primary' : 'border-border bg-muted',
    )}
  >
    <span
      className={cn(
        'pointer-events-none inline-block h-5 w-5 rounded-full shadow-sm transition-transform duration-200',
        checked ? 'translate-x-[22px] bg-white' : 'translate-x-[2px] bg-foreground/60 dark:bg-foreground/80',
      )}
    />
  </button>
);

export default function CodeEditorSettingsModal({
  isOpen,
  onClose,
  isDarkMode,
  onThemeChange,
  wordWrap,
  onWordWrapChange,
  minimapEnabled,
  onMinimapChange,
  showLineNumbers,
  onShowLineNumbersChange,
  fontSize,
  onFontSizeChange,
}: CodeEditorSettingsModalProps) {
  const { t } = useTranslation('settings');

  if (!isOpen) {
    return null;
  }

  const renderRow = ({
    label,
    description,
    control,
  }: {
    label: string;
    description: string;
    control: ReactNode;
  }) => (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex-shrink-0">{control}</div>
      </div>
    </div>
  );

  const fontSizeOptions = ['10', '11', '12', '13', '14', '15', '16', '18', '20'];

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-background/80 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-lg font-semibold text-foreground">{t('appearanceSettings.codeEditor.title')}</p>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-9 w-9 p-0 text-muted-foreground">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-4 p-4">
          {renderRow({
            label: t('appearanceSettings.codeEditor.theme.label'),
            description: t('appearanceSettings.codeEditor.theme.description'),
            control: (
              <DarkModeToggle
                checked={isDarkMode}
                onToggle={(enabled) => onThemeChange(enabled ? 'dark' : 'light')}
                ariaLabel={t('appearanceSettings.codeEditor.theme.label')}
              />
            ),
          })}
          {renderRow({
            label: t('appearanceSettings.codeEditor.wordWrap.label'),
            description: t('appearanceSettings.codeEditor.wordWrap.description'),
            control: (
              <SwitchControl
                checked={wordWrap}
                onChange={onWordWrapChange}
                ariaLabel={t('appearanceSettings.codeEditor.wordWrap.label')}
              />
            ),
          })}
          {renderRow({
            label: t('appearanceSettings.codeEditor.showMinimap.label'),
            description: t('appearanceSettings.codeEditor.showMinimap.description'),
            control: (
              <SwitchControl
                checked={minimapEnabled}
                onChange={onMinimapChange}
                ariaLabel={t('appearanceSettings.codeEditor.showMinimap.label')}
              />
            ),
          })}
          {renderRow({
            label: t('appearanceSettings.codeEditor.lineNumbers.label'),
            description: t('appearanceSettings.codeEditor.lineNumbers.description'),
            control: (
              <SwitchControl
                checked={showLineNumbers}
                onChange={onShowLineNumbersChange}
                ariaLabel={t('appearanceSettings.codeEditor.lineNumbers.label')}
              />
            ),
          })}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">{t('appearanceSettings.codeEditor.fontSize.label')}</p>
                <p className="text-xs text-muted-foreground">{t('appearanceSettings.codeEditor.fontSize.description')}</p>
              </div>
              <select
                value={String(fontSize)}
                onChange={(event) => onFontSizeChange(Number(event.target.value))}
                className="w-full max-w-[120px] rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
              >
                {fontSizeOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}px
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

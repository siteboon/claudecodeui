import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../utils/api';
import SettingsSection from '../SettingsSection';

type IgnoredDirectoriesSettings = {
  ignoredDirectories: string[];
  defaults: string[];
};

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return data as T;
}

export default function FilesSettingsTab() {
  const { t } = useTranslation('settings');
  const [ignoredDirectories, setIgnoredDirectories] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [newDirectory, setNewDirectory] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applySettings = useCallback((settings: IgnoredDirectoriesSettings) => {
    setIgnoredDirectories(settings.ignoredDirectories);
    setDefaults(settings.defaults);
  }, []);

  useEffect(() => {
    let isActive = true;

    void authenticatedFetch('/api/file-tree/settings/ignored-directories')
      .then((response) => readJson<IgnoredDirectoriesSettings>(response))
      .then((settings) => {
        if (isActive) {
          applySettings(settings);
        }
      })
      .catch((loadError: unknown) => {
        if (isActive) {
          setError(loadError instanceof Error ? loadError.message : t('filesSettings.loadError'));
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [applySettings, t]);

  const stageDirectories = (nextDirectories: string[]) => {
    setIgnoredDirectories(nextDirectories);
    setIsSaved(false);
    setError(null);
  };

  const addDirectory = () => {
    const name = newDirectory.trim();
    if (!name || ignoredDirectories.includes(name)) {
      setNewDirectory('');
      return;
    }

    stageDirectories([...ignoredDirectories, name]);
    setNewDirectory('');
  };

  const save = async (nextDirectories: string[]) => {
    setIsSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/file-tree/settings/ignored-directories', {
        method: 'PUT',
        body: JSON.stringify({ ignoredDirectories: nextDirectories }),
      });
      const result = await readJson<{ ignoredDirectories: string[] }>(response);
      setIgnoredDirectories(result.ignoredDirectories);
      setIsSaved(true);
      // The tree filters server-side, so an open file tree has to reload to
      // reflect the new list instead of waiting for the next project switch.
      window.dispatchEvent(new Event('fileTreeIgnoredDirectoriesChanged'));
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : t('filesSettings.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('filesSettings.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('filesSettings.ignoredTitle')}
        description={t('filesSettings.ignoredDescription')}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {ignoredDirectories.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('filesSettings.empty')}</p>
            )}
            {ignoredDirectories.map((directory) => (
              <span
                key={directory}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 py-1 pl-2 pr-1 text-sm text-foreground"
              >
                {directory}
                <button
                  type="button"
                  onClick={() => stageDirectories(
                    ignoredDirectories.filter((name) => name !== directory),
                  )}
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title={t('filesSettings.remove', { name: directory })}
                  aria-label={t('filesSettings.remove', { name: directory })}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>

          <div className="flex gap-2">
            <Input
              value={newDirectory}
              onChange={(event) => setNewDirectory(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addDirectory();
                }
              }}
              placeholder={t('filesSettings.addPlaceholder')}
              aria-label={t('filesSettings.addPlaceholder')}
              className="h-9 max-w-xs text-sm"
            />
            <Button variant="outline" onClick={addDirectory} disabled={!newDirectory.trim()}>
              {t('filesSettings.add')}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void save(ignoredDirectories)} disabled={isSaving}>
              {isSaving ? t('filesSettings.saving') : t('filesSettings.save')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void save(defaults)}
              disabled={isSaving}
              title={t('filesSettings.reset')}
            >
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              {t('filesSettings.reset')}
            </Button>
            {isSaved && !error && (
              <span className="text-sm text-muted-foreground">{t('filesSettings.saved')}</span>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </SettingsSection>
    </div>
  );
}

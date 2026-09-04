import { useCallback, useEffect, useState } from 'react';
import { Archive, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import { authenticatedFetch } from '@/shared/api';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';

type AutoArchiveSettings = {
  enabled: boolean;
  retentionDays: number;
};

const RETENTION_OPTIONS = [
  { value: 1, labelKey: 'sessions.retention.1day' },
  { value: 3, labelKey: 'sessions.retention.3days' },
  { value: 7, labelKey: 'sessions.retention.7days' },
  { value: 14, labelKey: 'sessions.retention.14days' },
  { value: 30, labelKey: 'sessions.retention.30days' },
];

export default function SessionsSettingsTab() {
  const { t } = useTranslation('settings');
  const [settings, setSettings] = useState<AutoArchiveSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunningArchive, setIsRunningArchive] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await authenticatedFetch('/api/providers/sessions/auto-archive/settings');
      const data = await res.json();
      if (!res.ok || !data.success || !data.data) {
        throw new Error(data.error?.message || data.error || `Request failed (${res.status})`);
      }
      setSettings(data.data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!actionFeedback) return undefined;
    const timer = setTimeout(() => setActionFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [actionFeedback]);

  const handleUpdate = async (nextSettings: Partial<AutoArchiveSettings>) => {
    if (!settings) return;
    setIsSaving(true);
    setErrorMessage(null);
    setActionFeedback(null);
    try {
      const res = await authenticatedFetch('/api/providers/sessions/auto-archive/settings', {
        method: 'PUT',
        body: JSON.stringify(nextSettings),
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.data) {
        throw new Error(data.error?.message || data.error || `Request failed (${res.status})`);
      }
      setSettings(data.data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunNow = async () => {
    setIsRunningArchive(true);
    setActionFeedback(null);
    setErrorMessage(null);
    try {
      const res = await authenticatedFetch('/api/providers/sessions/auto-archive/run', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.data) {
        throw new Error(data.error?.message || data.error || `Request failed (${res.status})`);
      }
      const count = data.data.archivedCount ?? 0;
      setActionFeedback(
        count > 0
          ? t('sessions.manualRun.successCount', { count, defaultValue: `已成功归档 ${count} 个历史会话！` })
          : t('sessions.manualRun.noneFound', { defaultValue: '没有发现需要归档的历史会话。' })
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to run archive');
    } finally {
      setIsRunningArchive(false);
    }
  };


  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const currentSettings = settings ?? { enabled: false, retentionDays: 1 };

  return (
    <div className="space-y-8">
      {/* Auto-archive Configuration */}
      <SettingsSection title={t('sessions.title', '会话管理')}>
        <SettingsCard>
          <SettingsRow
            label={t('sessions.autoArchive.enableLabel', '自动归档历史会话')}
            description={t(
              'sessions.autoArchive.enableDescription',
              '定期将长时间未活跃的会话自动移入归档，保持侧边栏清爽顺畅。'
            )}
          >
            <div className="flex items-center gap-2">
              {isSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <SettingsToggle
                checked={currentSettings.enabled}
                onChange={(enabled) => handleUpdate({ enabled })}
                ariaLabel={t('sessions.autoArchive.enableLabel', '自动归档历史会话')}
                disabled={isSaving}
              />
            </div>
          </SettingsRow>

          {currentSettings.enabled && (
            <div className="border-t border-border/60 px-4 py-4">
              <label className="text-sm font-medium text-foreground">
                {t('sessions.autoArchive.retentionLabel', '归档时间阈值')}
              </label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t(
                  'sessions.autoArchive.retentionDescription',
                  '选择超过多长时间没有新活跃记录的会话会被归档（例如选择“1天”即归档今天之前的所有会话）。'
                )}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {RETENTION_OPTIONS.map((opt) => {
                  const isSelected = currentSettings.retentionDays === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleUpdate({ retentionDays: opt.value })}
                      disabled={isSaving}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary/10 text-primary shadow-sm'
                          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
                      }`}
                    >
                      {t(opt.labelKey, `${opt.value} 天`)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </SettingsCard>
      </SettingsSection>

      {/* Manual Archive Trigger */}
      <SettingsSection title={t('sessions.manualSection.title', '手动清理操作')}>
        <SettingsCard className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">
                {t('sessions.manualRun.title', '立即执行历史会话归档')}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {t(
                  'sessions.manualRun.description',
                  '按照当前的归档阈值设置，立即扫描并归档所有符合条件的旧会话。'
                )}
              </div>
            </div>
            <Button
              onClick={handleRunNow}
              disabled={isRunningArchive}
              className="flex items-center gap-2 self-start sm:self-auto"
            >
              {isRunningArchive ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
              {t('sessions.manualRun.button', '立即归档')}
            </Button>
          </div>

          {actionFeedback && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              <span>{actionFeedback}</span>
            </div>
          )}

          {errorMessage && (
            <div className="mt-3 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
              {errorMessage}
            </div>
          )}
        </SettingsCard>
      </SettingsSection>

      {/* Info notice */}
      <div className="rounded-xl border border-border/80 bg-muted/30 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="flex-1 text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">
              {t('sessions.notice.title', '数据安全说明：')}
            </span>{' '}
            {t(
              'sessions.notice.content',
              '归档操作只会从侧边栏列表中移出旧会话，绝不会删除您的对话历史和磁盘文件。您随时可以在侧边栏点击“归档视图”（顶部箱子图标）查看完整历史记录，或者一键将其恢复回活跃列表中。'
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

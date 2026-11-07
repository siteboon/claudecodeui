import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useClaudeSettingsPermissionRules } from '@/modules/settings/hooks/useClaudeSettingsPermissionRules';
import type { ClaudeSettingsPermissionSource } from '@/shared/types';

const RULE_GROUPS = [
  { key: 'allow', chipClassName: 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200' },
  { key: 'ask', chipClassName: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200' },
  { key: 'deny', chipClassName: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200' },
] as const;

function SettingsFileCard({ source }: { source: ClaudeSettingsPermissionSource }) {
  const { t } = useTranslation('settings');
  const hasRules = RULE_GROUPS.some(({ key }) => source[key].length > 0);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card/50 p-3" data-testid={`claude-settings-file-${source.scope}`}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{t(`permissions.settingsFiles.sources.${source.scope}`)}</div>
        <div className="break-all font-mono text-xs text-muted-foreground">{source.path}</div>
      </div>

      {source.status === 'invalid' && (
        <p className="text-sm text-amber-700 dark:text-amber-300">{t('permissions.settingsFiles.invalid')}</p>
      )}
      {source.status === 'missing' && (
        <p className="text-sm text-muted-foreground">{t('permissions.settingsFiles.missing')}</p>
      )}
      {source.status === 'ok' && !hasRules && (
        <p className="text-sm text-muted-foreground">{t('permissions.settingsFiles.empty')}</p>
      )}

      {RULE_GROUPS.filter(({ key }) => source[key].length > 0).map(({ key, chipClassName }) => (
        <div key={key} className="space-y-1" data-testid={`claude-settings-file-${source.scope}-${key}`}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t(`permissions.settingsFiles.groups.${key}`)}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {source[key].map((rule) => (
              <li key={rule} className={`max-w-full break-all rounded border px-2 py-0.5 font-mono text-xs ${chipClassName}`}>
                {rule}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Used by PermissionsContent (Claude variant) to show, read-only, the rules the
 * Claude CLI also applies from its own settings files, so users can see why a
 * tool runs or is refused without a matching entry in the lists above.
 */
export default function ClaudeSettingsFileRules() {
  const { t } = useTranslation('settings');
  const { sources, loadFailed } = useClaudeSettingsPermissionRules();
  // A missing managed file is the normal case outside managed installs; only
  // the user's own file is worth a "not found" line.
  const visibleSources = (sources ?? []).filter((source) => source.scope === 'user' || source.status !== 'missing');

  return (
    <div className="space-y-4" data-testid="claude-settings-file-rules">
      <div className="flex items-center gap-3">
        <FileText className="h-5 w-5 text-blue-500" />
        <h3 className="text-lg font-medium text-foreground">{t('permissions.settingsFiles.title')}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{t('permissions.settingsFiles.description')}</p>

      {loadFailed && (
        <p className="text-sm text-amber-700 dark:text-amber-300">{t('permissions.settingsFiles.loadFailed')}</p>
      )}
      {!loadFailed && sources === null && (
        <p className="text-sm text-muted-foreground">{t('permissions.settingsFiles.loading')}</p>
      )}

      {visibleSources.length > 0 && (
        <div className="space-y-2">
          {visibleSources.map((source) => (
            <SettingsFileCard key={source.scope} source={source} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t('permissions.settingsFiles.projectNote')}</p>
    </div>
  );
}

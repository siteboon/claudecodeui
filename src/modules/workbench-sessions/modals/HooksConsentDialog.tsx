import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, readApiJson } from '@/shared/api';
import type { WorkbenchHookAgent, WorkbenchHooksStatus } from '@/shared/types';
import { getErrorText } from '@/shared/utils';
import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { HOOK_AGENTS, getAgentHookState } from '@/modules/workbench-sessions/utils/workbenchSessionLogic';

type HooksConsentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Don't ask again": the caller remembers the choice so the first-session prompt is not repeated. */
  onDeclined: () => void;
};

type AgentSectionProps = {
  agent: WorkbenchHookAgent;
  installed: boolean;
  settingsPath: string;
  isBusy: boolean;
  error: string | null;
  onInstall: () => void;
  onRemove: () => void;
};

function AgentSection({ agent, installed, settingsPath, isBusy, error, onInstall, onRemove }: AgentSectionProps) {
  const { t } = useTranslation('workbench');
  return (
    <section className="rounded-lg border border-border/60 p-3" aria-label={t(`agents.${agent}`)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{t(`agents.${agent}`)}</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            installed
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {installed ? t('hooks.installed') : t('hooks.notInstalled')}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t(`hooks.${agent}.explain`)}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>{t('hooks.pointFile', { path: settingsPath || t(`hooks.${agent}.defaultPath`) })}</li>
        <li>{t('hooks.pointBackup')}</li>
        <li>{t('hooks.pointScoped')}</li>
        <li>{t('hooks.pointRemove')}</li>
      </ul>
      {agent === 'codex' && (
        <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-300">
          {t('hooks.codex.trustNote')}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end">
        {installed ? (
          <Button variant="outline" size="sm" disabled={isBusy} onClick={onRemove} className="min-h-11 md:min-h-0">
            {isBusy ? t('common.working') : t('hooks.remove')}
          </Button>
        ) : (
          <Button size="sm" disabled={isBusy} onClick={onInstall} className="min-h-11 md:min-h-0">
            {isBusy ? t('common.working') : t(`hooks.${agent}.install`)}
          </Button>
        )}
      </div>
    </section>
  );
}

/** Rendered by WorkbenchSessionsSection: per-CLI consent to add, or later remove, Workbench's status hooks in that CLI's user-level config. */
export default function HooksConsentDialog({ open, onOpenChange, onDeclined }: HooksConsentDialogProps) {
  const { t } = useTranslation('workbench');
  // Install state read from the server each time the dialog opens, so it never shows a stale "installed".
  const [status, setStatus] = useState<WorkbenchHooksStatus | null>(null);
  // The agent whose install/remove request is running; only one runs at a time.
  const [busyAgent, setBusyAgent] = useState<WorkbenchHookAgent | null>(null);
  // Per-agent failure text (for example an unparsable settings file), shown inside that agent's block.
  const [errors, setErrors] = useState<Partial<Record<WorkbenchHookAgent, string>>>({});
  // Why the status itself could not be loaded.
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const body = await readApiJson<{ data: WorkbenchHooksStatus }>(await api.workbench.hooksStatus());
      setStatus(body.data);
      setLoadError(null);
    } catch (error) {
      setLoadError(getErrorText(error));
    }
  }, []);

  useEffect(() => {
    if (open) void loadStatus();
  }, [open, loadStatus]);

  const run = async (agent: WorkbenchHookAgent, action: 'install' | 'remove') => {
    setBusyAgent(agent);
    setErrors((previous) => ({ ...previous, [agent]: undefined }));
    try {
      const response = action === 'install'
        ? await api.workbench.installHooks(agent)
        : await api.workbench.uninstallHooks(agent);
      await readApiJson(response);
      await loadStatus();
    } catch (error) {
      setErrors((previous) => ({ ...previous, [agent]: getErrorText(error) }));
    } finally {
      setBusyAgent(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-full max-w-lg overflow-y-auto p-5" aria-describedby="workbench-hooks-description">
        <DialogTitle className="not-sr-only text-base font-semibold text-foreground">{t('hooks.title')}</DialogTitle>
        <p id="workbench-hooks-description" className="mt-2 text-sm text-muted-foreground">
          {t('hooks.explain')}
        </p>

        <div className="mt-3 space-y-3">
          {loadError && <p role="alert" className="text-xs text-destructive">{loadError}</p>}
          {!status && !loadError && <p className="text-xs text-muted-foreground">{t('hooks.loading')}</p>}
          {status && HOOK_AGENTS.map((agent) => {
            const state = getAgentHookState(status, agent);
            return (
              <AgentSection
                key={agent}
                agent={agent}
                installed={state.installed}
                settingsPath={state.settingsPath}
                isBusy={busyAgent !== null}
                error={errors[agent] ?? null}
                onInstall={() => void run(agent, 'install')}
                onRemove={() => void run(agent, 'remove')}
              />
            );
          })}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">{t('hooks.fallback')}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={busyAgent !== null}
            onClick={() => {
              onDeclined();
              onOpenChange(false);
            }} className="min-h-11 md:min-h-0">
            {t('hooks.dontAsk')}
          </Button>
          <Button variant="outline" size="sm" disabled={busyAgent !== null} onClick={() => onOpenChange(false)} className="min-h-11 md:min-h-0">
            {t('hooks.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

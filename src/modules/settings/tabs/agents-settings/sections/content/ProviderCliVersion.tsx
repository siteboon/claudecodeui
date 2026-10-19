import { Download, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useProviderCliVersion } from '@/modules/settings/hooks/useProviderCliVersion';
import { Badge, Button } from '@/shared/ui';
import type { AgentProvider, ProviderCliUpdateResult } from '@/shared/types';

type ProviderCliVersionProps = {
  agent: AgentProvider;
  /** From the auth status, shown until the CLI status request answers. */
  installedVersion: string | null;
  textClass: string;
  subtextClass: string;
};

type UpdateResultProps = {
  result: ProviderCliUpdateResult;
  /** The newest npm release, when known; an unchanged version equal to it means there was nothing to update. */
  latestVersion: string | null;
};

function UpdateResult({ result, latestVersion }: UpdateResultProps) {
  const { t } = useTranslation('settings');
  const changed = result.installedVersion !== null && result.installedVersion !== result.previousVersion;

  let message: string;
  if (result.failure === 'permission_denied') {
    message = t('agents.cli.result.permissionDenied', { command: result.command });
  } else if (result.failure === 'timed_out') {
    message = t('agents.cli.result.timedOut', { command: result.command });
  } else if (result.failure === 'failed') {
    // OpenCode's updater reports a failed upgrade and still exits 0.
    message = result.exitCode === null
      ? t('agents.cli.result.notStarted')
      : result.exitCode === 0
        ? t('agents.cli.result.failedQuietly')
        : t('agents.cli.result.failed', { exitCode: result.exitCode });
  } else if (changed) {
    message = t('agents.cli.result.updated', { version: result.installedVersion });
  } else if (result.installedVersion && result.installedVersion === latestVersion) {
    message = t('agents.cli.result.alreadyUpToDate', { version: result.installedVersion });
  } else {
    message = result.installedVersion
      ? t('agents.cli.result.unchanged', { version: result.installedVersion })
      : t('agents.cli.result.unchangedUnknown');
  }

  const tone = result.failure
    ? 'text-red-600 dark:text-red-400'
    : changed
      ? 'text-green-700 dark:text-green-400'
      : 'text-foreground';

  return (
    <div className="mt-3 space-y-2" data-testid="provider-cli-update-result">
      <p role="status" className={`break-words text-sm ${tone}`}>{message}</p>
      {result.output && (
        <details className="rounded-md border border-border/60 bg-background/60">
          <summary className="cursor-pointer select-none px-3 py-1.5 text-xs text-muted-foreground">
            {t('agents.cli.output', { command: result.command })}
          </summary>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words border-t border-border/60 px-3 py-2 font-mono text-xs text-foreground">
            {result.output}
          </pre>
        </details>
      )}
    </div>
  );
}

/**
 * Rendered by AccountContent under the connection status: the provider CLI's
 * installed version, whether npm has a newer release, and a button that runs
 * the CLI's own updater on the server. Keyed by agent there, so each agent's
 * row has its own request state.
 */
export default function ProviderCliVersion({ agent, installedVersion, textClass, subtextClass }: ProviderCliVersionProps) {
  const { t } = useTranslation('settings');
  const { status, statusFailed, updating, updateResult, updateError, runUpdate } = useProviderCliVersion(agent);

  // Nothing to say about a CLI that is not there; the status line above
  // already reports it. Unless an update this row showed left the CLI unable
  // to start: then the run's result and output say what happened.
  const missing = status !== null && !status.installed;
  if (missing && !updateResult && !updateError) {
    return null;
  }

  const version = status ? status.installedVersion : installedVersion;
  let versionText: string;
  if (version) {
    versionText = t('agents.cli.installed', { version });
  } else if (status && !missing) {
    versionText = t('agents.cli.installedUnknown');
  } else if (status || statusFailed) {
    versionText = t('agents.cli.versionUnavailable');
  } else {
    versionText = t('agents.cli.checking');
  }

  let detail: string | null = null;
  if (status?.updateUnavailableReason === 'bundled') {
    detail = t('agents.cli.bundled');
  } else if (status?.updateUnavailableReason === 'platform') {
    detail = t('agents.cli.platform');
  } else if (status?.updateAvailable && status.latestVersion) {
    detail = t('agents.cli.updateAvailable', { version: status.latestVersion });
  } else if (status?.latestVersion && version) {
    detail = t('agents.cli.upToDate');
  }

  const updateCommand = status?.updateCommand ?? null;
  let updateErrorMessage: string | null = null;
  if (updateError?.kind === 'unconfirmed') {
    // The answer was lost, not refused: the update may have run all the same.
    updateErrorMessage = t('agents.cli.result.unconfirmed', { error: updateError.message });
  } else if (updateError?.code === 'PROVIDER_CLI_BUSY') {
    updateErrorMessage = t('agents.cli.result.busy');
  } else if (updateError) {
    updateErrorMessage = t('agents.cli.result.requestFailed', { error: updateError.message });
  }

  return (
    <div className="border-t border-border/50 pt-4" data-testid="provider-cli-version">
      {/* The minimum width wraps the button under the version on phones instead of squeezing it. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-48 flex-1">
          <div className={`font-medium ${textClass}`}>{t('agents.cli.title')}</div>
          <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${subtextClass}`}>
            <span className="break-all">{versionText}</span>
            {detail && status?.updateAvailable ? (
              <Badge
                variant="secondary"
                className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
              >
                {detail}
              </Badge>
            ) : detail ? (
              <span className="text-muted-foreground">{detail}</span>
            ) : null}
          </div>
        </div>
        {/* The server refuses to update a CLI it cannot start. */}
        {updateCommand && !missing && (
          <Button
            type="button"
            size="sm"
            variant={status?.updateAvailable ? 'default' : 'outline'}
            onClick={() => {
              void runUpdate();
            }}
            disabled={updating}
            title={t('agents.cli.runsCommand', { command: updateCommand })}
          >
            {updating ? (
              <Loader2 className="animate-spin" />
            ) : status?.updateAvailable ? (
              <Download />
            ) : (
              <RefreshCw />
            )}
            {updating
              ? t('agents.cli.updating')
              : status?.updateAvailable && status.latestVersion
                ? t('agents.cli.updateTo', { version: status.latestVersion })
                : t('agents.cli.runUpdater')}
          </Button>
        )}
      </div>

      {updating && (
        <p role="status" className="mt-3 break-words text-sm text-muted-foreground">
          {t('agents.cli.updatingHint', { command: updateCommand })}
        </p>
      )}
      {!updating && updateResult && <UpdateResult result={updateResult} latestVersion={status?.latestVersion ?? null} />}
      {!updating && updateErrorMessage && (
        <p role="alert" className="mt-3 break-words text-sm text-red-600 dark:text-red-400">
          {updateErrorMessage}
        </p>
      )}
    </div>
  );
}

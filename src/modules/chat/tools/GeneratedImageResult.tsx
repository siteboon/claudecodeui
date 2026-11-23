import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import type { GeneratedImageToolView } from '@/shared/types';
import { useMarkdownWorkspaceProjectId } from '@/modules/chat/context/MarkdownWorkspaceContext';
import { readGeneratedImageResult } from '@/shared/utils';
import { Markdown } from '@/modules/chat/transcript/Markdown';
import { MarkdownImage } from '@/modules/chat/transcript/MarkdownImage';
import { ToolStatusBadge } from '@/modules/chat/tools/ToolStatusBadge';

/** Used by chat's ToolRenderer for validated image jobs, including transcript reloads. */
export function GeneratedImageResult({ job }: { job: GeneratedImageToolView }) {
  const { t } = useTranslation('common');
  const projectId = useMarkdownWorkspaceProjectId();
  const key = (projectId ?? '') + ':' + job.jobId + ':' + job.status + ':' + (job.assetPath ?? '');
  // A transcript contains a snapshot. Refresh the saved job so reloads and
  // accepted background generations can reveal their persisted image later.
  const [live, setLive] = useState<{ key: string; job: GeneratedImageToolView; refreshFailed?: boolean } | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const sourceJob: GeneratedImageToolView = {
      jobId: job.jobId, status: job.status, promptPreview: job.promptPreview,
      assetPath: job.assetPath, errorMessage: job.errorMessage,
    };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const deadline = Date.now() + 360_000;
    const retryRefresh = () => {
      if (controller.signal.aborted) return;
      if (failures >= 5 || Date.now() >= deadline) {
        if (sourceJob.status === 'running') setLive({ key, job: { ...sourceJob, status: 'uncertain' }, refreshFailed: true });
        return;
      }
      const backoff = Math.min(4000, 250 * 2 ** failures++);
      timer = setTimeout(() => { void refresh(); }, backoff);
    };
    const refresh = async () => {
      try {
        const response = await api.imageGeneration.job(projectId, job.jobId, { signal: controller.signal });
        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) retryRefresh();
          return; // Authentication/not-found responses never trigger generation or repeated reads.
        }
        const next = readGeneratedImageResult(await response.json());
        if (controller.signal.aborted || !next || next.jobId !== job.jobId) return;
        failures = 0;
        if (next.status === 'running' && Date.now() >= deadline) next.status = 'uncertain';
        setLive({ key, job: next });
        if (next.status === 'running') timer = setTimeout(() => { void refresh(); }, 2000);
      } catch { retryRefresh(); }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [key, projectId, job.jobId, job.status, job.promptPreview, job.assetPath, job.errorMessage]);
  const current = live?.key === key ? live.job : job;
  const status = current.status === 'running' ? 'running' : current.status === 'succeeded' ? 'completed' : 'error';
  return (
    <div className="my-2 rounded-lg border border-border/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToolStatusBadge status={status} />
        <code className="break-all text-[10px] text-muted-foreground">{current.jobId}</code>
      </div>
      {current.assetPath && (
        <>
          <MarkdownImage src={current.assetPath} alt={current.promptPreview || current.assetPath} />
          <Markdown>{'[' + current.assetPath.split('/').pop() + '](' + current.assetPath + ')'}</Markdown>
        </>
      )}
      {current.errorMessage && <p role="alert" className="mt-2 text-sm text-muted-foreground">{current.errorMessage}</p>}
      {live?.key === key && live.refreshFailed && <p role="alert" className="mt-2 text-sm text-muted-foreground">{t('messages.networkError')}</p>}
    </div>
  );
}

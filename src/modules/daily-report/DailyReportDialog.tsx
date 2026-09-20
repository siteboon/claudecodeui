import { useState } from 'react';
import { ChevronDown, Copy, ExternalLink, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useDailyReport } from '@/modules/daily-report/hooks/useDailyReport';
import type { DailyReport } from '@/shared/types';
import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { copyTextToClipboard } from '@/shared/utils';

type DailyReportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const INITIAL_ITEM_LIMIT = 8;
const REPORT_LANGUAGE_STORAGE_KEY = 'cloudcli.dailyReport.locale';
const REPORT_LANGUAGES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'pt-BR', label: 'Português' },
  { value: 'ru', label: 'Русский' },
] as const;
type ReportLocale = typeof REPORT_LANGUAGES[number]['value'];

function initialReportLocale(language: string): ReportLocale {
  const stored = window.localStorage.getItem(REPORT_LANGUAGE_STORAGE_KEY);
  if (REPORT_LANGUAGES.some(({ value }) => value === stored)) return stored as ReportLocale;
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

function reportMarkdown(report: DailyReport, labels: Record<string, string>): string {
  const lines = [
    `# ${labels.title} · ${report.date}`,
    '',
    `${report.coverage.projectCount} ${labels.projects} · ${report.coverage.sessionCount} ${labels.sessions} · ${labels.asOf} ${new Date(report.snapshotAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${report.timezone})`,
    '',
    ...report.highlights.map((highlight) => `- ${highlight}`),
  ];
  for (const [index, item] of report.items.entries()) {
    lines.push(
      '',
      `## ${index + 1}. ${item.task}`,
      `- ${labels.currentProgress}: ${labels[item.status]} · ${item.progress}`,
      `- ${labels.nextStep}: ${item.nextStep}`,
      `- ${item.projectName} · ${[...new Set(item.sources.map((source) => source.provider))].join(' / ')}`,
    );
  }
  return lines.join('\n');
}

/** Rendered by Sidebar as the global, non-destructive Daily Report dialog. */
export function DailyReportDialog({ open, onOpenChange }: DailyReportDialogProps) {
  const { i18n } = useTranslation();
  // The selected report language controls both generated content and this dialog's labels.
  const [reportLocale, setReportLocale] = useState<ReportLocale>(() => (
    initialReportLocale(i18n.resolvedLanguage || i18n.language || 'en')
  ));
  const { t } = useTranslation('dailyReport', { lng: reportLocale });
  const navigate = useNavigate();
  const { report, isLoading, isGenerating, error, timezone, generate } = useDailyReport(
    open,
    reportLocale,
  );
  // Expansion is user-controlled so the default report stays scannable at eight items.
  const [expanded, setExpanded] = useState(false);
  // Copy feedback is transient and announced through the button label.
  const [copied, setCopied] = useState(false);

  const displayedReport = report?.locale === reportLocale ? report : null;
  const visibleItems = expanded ? displayedReport?.items || [] : displayedReport?.items.slice(0, INITIAL_ITEM_LIMIT) || [];
  const hiddenCount = Math.max(0, (displayedReport?.items.length || 0) - INITIAL_ITEM_LIMIT);
  const copyReport = async () => {
    if (!displayedReport) return;
    await copyTextToClipboard(reportMarkdown(displayedReport, {
      title: t('title'),
      projects: t('projects'),
      sessions: t('sessions'),
      asOf: t('asOf'),
      completed: t('status.completed'),
      progress: t('status.progress'),
      needs_attention: t('status.needs_attention'),
      currentProgress: t('fields.currentProgress'),
      nextStep: t('fields.nextStep'),
    }));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-[720px] flex-col overflow-hidden rounded-xl sm:max-h-[85dvh]">
        <DialogTitle>{t('title')}</DialogTitle>
        <header className="flex items-start justify-between border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-foreground">{t('title')}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {displayedReport
                ? t('coverage', {
                  date: new Date(`${displayedReport.date}T12:00:00`).toLocaleDateString(reportLocale),
                  projects: displayedReport.coverage.projectCount,
                  sessions: displayedReport.coverage.sessionCount,
                  time: new Date(displayedReport.snapshotAt).toLocaleTimeString(reportLocale, { hour: '2-digit', minute: '2-digit' }),
                  timezone: displayedReport.timezone,
                })
                : t('todayInTimezone', { timezone })}
            </p>
          </div>
          <div className="ml-3 flex shrink-0 items-center gap-2">
            <label className="sr-only" htmlFor="daily-report-language">{t('reportLanguage')}</label>
            <select
              id="daily-report-language"
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
              value={reportLocale}
              onChange={(event) => {
                const locale = event.target.value as ReportLocale;
                window.localStorage.setItem(REPORT_LANGUAGE_STORAGE_KEY, locale);
                setExpanded(false);
                setReportLocale(locale);
              }}
              disabled={isGenerating}
            >
              {REPORT_LANGUAGES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => onOpenChange(false)}
              aria-label={t('close')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="sr-only" aria-live="polite">
            {isLoading ? t('loading') : isGenerating ? t('generating') : ''}
          </div>
          {(isLoading || isGenerating) && !displayedReport && (
            <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              {isGenerating ? t('generating') : t('loading')}
            </div>
          )}
          {!isLoading && !displayedReport && !isGenerating && (
            <div className="mx-auto flex min-h-48 max-w-md flex-col items-center justify-center text-center">
              <p className="text-sm text-muted-foreground">{t('notGenerated')}</p>
              <label className="mt-4 text-xs text-muted-foreground" htmlFor="daily-report-provider">
                {t('summaryProvider')}
              </label>
              <select
                id="daily-report-provider"
                className="mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                defaultValue="claude"
                onChange={() => localStorage.setItem('cloudcli.dailyReport.summaryProvider', 'claude')}
              >
                <option value="claude">Claude</option>
              </select>
              <p className="mt-2 text-xs text-muted-foreground">{t('providerNote')}</p>
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}
          {displayedReport && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{t('summary')}</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-foreground">
                  {displayedReport.highlights.map((highlight, index) => (
                    <li key={`${index}-${highlight}`}>{highlight}</li>
                  ))}
                </ul>
                {displayedReport.coverage.warnings.length > 0 && (
                  <div className="mt-3 border-l-2 border-border pl-3 text-xs text-muted-foreground">
                    {displayedReport.coverage.warnings.map((warning) => (
                      <p key={warning}>{t(`warnings.${warning}`, { defaultValue: t('warnings.partial') })}</p>
                    ))}
                  </div>
                )}
              </div>

              {visibleItems.length > 0 && (
                <ol className="space-y-3">
                  {visibleItems.map((item, index) => (
                      <li key={item.id} className="rounded-lg border border-border p-3">
                        <h3 className="text-sm font-semibold text-foreground">
                          {index + 1}. {t('fields.task')}: {item.task}
                        </h3>
                        <dl className="mt-2 grid gap-2 text-sm">
                          <div>
                            <dt className="inline font-medium text-foreground">{t('fields.currentProgress')}: </dt>
                            <dd className="inline text-muted-foreground">
                              <span className="font-medium text-foreground">{t(`status.${item.status}`)}</span>
                              {' · '}{item.progress}
                            </dd>
                          </div>
                          <div>
                            <dt className="inline font-medium text-foreground">{t('fields.nextStep')}: </dt>
                            <dd className="inline text-muted-foreground">{item.nextStep}</dd>
                          </div>
                        </dl>
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span>{item.projectName}</span>
                          {item.sources.map((source, index) => (
                            <button
                              key={source.evidenceId}
                              type="button"
                              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                              onClick={() => {
                                onOpenChange(false);
                                navigate(`/session/${encodeURIComponent(source.sessionId)}`);
                              }}
                            >
                              {t('source', { provider: source.provider, index: index + 1 })}
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          ))}
                        </div>
                      </li>
                  ))}
                </ol>
              )}

              {hiddenCount > 0 && !expanded && (
                <Button variant="ghost" size="sm" className="w-full" onClick={() => setExpanded(true)}>
                  <ChevronDown className="h-4 w-4" />
                  {t('showMore', { count: hiddenCount })}
                </Button>
              )}
            </div>
          )}
        </main>

        <footer className="flex justify-end gap-2 border-t border-border px-4 py-3 sm:px-5" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          {displayedReport && (
            <Button variant="outline" size="sm" onClick={() => void copyReport()} disabled={isGenerating}>
              <Copy className="h-4 w-4" />
              {copied ? t('copied') : t('copy')}
            </Button>
          )}
          <Button size="sm" onClick={() => void generate(Boolean(displayedReport))} disabled={isLoading || isGenerating}>
            {isGenerating && <RefreshCw className="h-4 w-4 animate-spin" />}
            {displayedReport ? t('refresh') : t('generate')}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

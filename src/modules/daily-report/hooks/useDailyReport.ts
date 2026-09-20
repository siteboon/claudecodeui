import { useCallback, useEffect, useRef, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { DailyReport, DailyReportStatus, DailyReportSummaryProvider } from '@/shared/types';

type ApiEnvelope<T> = { success: true; data: T };

function localDate(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** Used by DailyReportDialog to load cache on open and generate only after an explicit action. */
export function useDailyReport(open: boolean, locale: string, summaryProvider: DailyReportSummaryProvider) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  // The cached/generated report is retained across closing so reopening is instant.
  const [report, setReport] = useState<DailyReport | null>(null);
  // Loading distinguishes cache discovery from the initial empty dialog.
  const [isLoading, setIsLoading] = useState(false);
  // Generating drives the live region and disables duplicate user actions.
  const [isGenerating, setIsGenerating] = useState(false);
  // Errors remain visible until a successful retry or a fresh dialog open.
  const [error, setError] = useState<string | null>(null);
  // The active request is retained solely so closing the dialog can cancel its listener.
  const requestController = useRef<AbortController | null>(null);

  const loadCached = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.dailyReports.today(timezone, locale, summaryProvider);
      const payload = await readApiJson<ApiEnvelope<DailyReportStatus>>(response);
      setReport(payload.data.report);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load Daily Report.');
    } finally {
      setIsLoading(false);
    }
  }, [locale, summaryProvider, timezone]);

  useEffect(() => {
    // Defer the request one task so opening the Dialog can paint before cache I/O updates state.
    const loadTimer = open ? window.setTimeout(() => void loadCached(), 0) : null;
    return () => {
      if (loadTimer !== null) window.clearTimeout(loadTimer);
      requestController.current?.abort();
    };
  }, [loadCached, open]);

  const generate = useCallback(async (refresh: boolean) => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setIsGenerating(true);
    setError(null);
    try {
      const response = await api.dailyReports.generate({
        date: localDate(timezone),
        timezone,
        locale,
        summaryProvider,
        refresh,
      }, { signal: controller.signal });
      const payload = await readApiJson<ApiEnvelope<DailyReport>>(response);
      setReport(payload.data);
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : 'Unable to generate Daily Report.');
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setIsGenerating(false);
      }
    }
  }, [locale, summaryProvider, timezone]);

  return { report, isLoading, isGenerating, error, timezone, generate };
}

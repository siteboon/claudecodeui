import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';

type TranscriptTimestampProps = {
  /** When the row happened, in any shape a transcript row carries it: an ISO string, epoch milliseconds or a Date. */
  value: string | number | Date | null | undefined;
  className?: string;
};

/** The formatters one locale needs, built once: long transcripts draw hundreds of these. */
type TimestampFormatters = {
  time: Intl.DateTimeFormat;
  dayAndTime: Intl.DateTimeFormat;
  yearDayAndTime: Intl.DateTimeFormat;
  full: Intl.DateTimeFormat;
};

/**
 * Anything older is a row that was never really stamped (epoch 0, or seconds
 * read as milliseconds) rather than a conversation from 1970, so it is hidden
 * instead of drawn as a date that cannot be true.
 */
const EARLIEST_PLAUSIBLE_TIMESTAMP_MS = Date.UTC(2000, 0, 1);

const formattersByLocale = new Map<string, TimestampFormatters>();

function createFormatters(locale: string | undefined): TimestampFormatters {
  // Seconds are kept: an agent's tool calls are often seconds apart, and
  // without them a whole run of rows reads as the same minute.
  const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', second: '2-digit' };
  return {
    time: new Intl.DateTimeFormat(locale, time),
    dayAndTime: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', ...time }),
    yearDayAndTime: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', ...time }),
    full: new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'medium' }),
  };
}

function getFormatters(locale: string | undefined): TimestampFormatters {
  const cacheKey = locale ?? '';
  let formatters = formattersByLocale.get(cacheKey);
  if (!formatters) {
    try {
      formatters = createFormatters(locale);
    } catch {
      // A language tag Intl does not accept falls back to the browser's own.
      formatters = createFormatters(undefined);
    }
    formattersByLocale.set(cacheKey, formatters);
  }
  return formatters;
}

/**
 * The locale a time is written in: the app's language, refined by the
 * browser's own regional variant of that language when it lists one. The app
 * only knows `en`, which alone means US 12-hour time even for a reader whose
 * browser says `en-GB`; a language the app already pins to a region (`zh-TW`,
 * `pt-BR`) is used as it is.
 */
function resolveTimestampLocale(appLanguage: string | undefined): string | undefined {
  if (!appLanguage || appLanguage.includes('-')) {
    return appLanguage || undefined;
  }
  const browserLanguages = typeof navigator === 'undefined' ? [] : navigator.languages ?? [];
  const regional = browserLanguages.find(
    (language) => language.toLowerCase().split('-')[0] === appLanguage.toLowerCase(),
  );
  return regional ?? appLanguage;
}

function toPlausibleDate(value: TranscriptTimestampProps['value']): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) && time >= EARLIEST_PLAUSIBLE_TIMESTAMP_MS ? date : null;
}

/**
 * Rendered by chat's MessageComponent, ToolGroupContainer, SubagentTimeline
 * and WorkflowPanel to stamp a row, a tool group, a subagent step or a
 * workflow agent with the time it happened, while the "Show timestamps"
 * preference is on.
 *
 * The local time to the second, prefixed with the date once the row is not
 * from today (and with the year once it is not from this year); the full date
 * and time are in the tooltip. Absolute rather than "5 min ago", so nothing has
 * to tick: a relative label would need a timer to stay true, and would be
 * wrong in an exported file the moment it was saved. An exported row always
 * carries its date, since the file outlives the day it was made.
 *
 * Renders nothing for a missing or implausible value rather than
 * "Invalid Date" or a day in 1970.
 */
function TranscriptTimestamp({ value, className }: TranscriptTimestampProps) {
  const { i18n } = useTranslation();
  const isExporting = useIsExportingTranscript();
  const locale = resolveTimestampLocale(i18n.language);

  // Whether the date is shown is decided at render, so a row drawn before
  // midnight keeps its date-less label until it next renders.
  const stamp = useMemo(() => {
    const date = toPlausibleDate(value);
    if (!date) {
      return null;
    }
    const formatters = getFormatters(locale);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const label = isToday && !isExporting
      ? formatters.time.format(date)
      : date.getFullYear() === now.getFullYear()
        ? formatters.dayAndTime.format(date)
        : formatters.yearDayAndTime.format(date);
    return { iso: date.toISOString(), label, full: formatters.full.format(date) };
  }, [value, locale, isExporting]);

  if (!stamp) {
    return null;
  }

  return (
    // Isolated, and directed by its own text: a Hebrew month name inside a
    // left-to-right row otherwise comes out reordered around the digits.
    <time
      dir="auto"
      dateTime={stamp.iso}
      title={stamp.full}
      className={cn('whitespace-nowrap tabular-nums', className)}
    >
      {stamp.label}
    </time>
  );
}

export default memo(TranscriptTimestamp);

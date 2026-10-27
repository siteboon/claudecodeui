import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { cn, toPlausibleTimestamp } from '@/shared/utils';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';

type TimestampValue = string | number | Date | null | undefined;

type TranscriptTimestampProps = {
  /** When the row happened, in any shape a transcript row carries it: an ISO string, epoch milliseconds or a Date. */
  value: TimestampValue;
  /**
   * When set, the stamp reads as a span from `value` to this: a collapsed run
   * of work, labelled with when it began and when it last did something.
   */
  endValue?: TimestampValue;
  className?: string;
};

/** The formatters one locale needs, built once: long transcripts draw hundreds of these. */
type TimestampFormatters = {
  time: Intl.DateTimeFormat;
  dayAndTime: Intl.DateTimeFormat;
  yearDayAndTime: Intl.DateTimeFormat;
  full: Intl.DateTimeFormat;
};

/** `formatRange` is ES2021; the project's lib stops at ES2020, and an old engine may lack it. */
type RangeCapableFormat = Intl.DateTimeFormat & { formatRange?: (start: Date, end: Date) => string };

const formattersByLocale = new Map<string, TimestampFormatters>();
const hour12ByBrowserLocale = new Map<string, boolean | undefined>();

function createFormatters(locale: string | undefined, hour12: boolean | undefined): TimestampFormatters {
  // Seconds are kept: an agent's tool calls are often seconds apart, and
  // without them a whole run of rows reads as the same minute.
  const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12 };
  return {
    time: new Intl.DateTimeFormat(locale, time),
    dayAndTime: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', ...time }),
    yearDayAndTime: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', ...time }),
    full: new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'medium', hour12 }),
  };
}

function getFormatters(locale: string | undefined, hour12: boolean | undefined): TimestampFormatters {
  const cacheKey = `${locale ?? ''}|${String(hour12)}`;
  let formatters = formattersByLocale.get(cacheKey);
  if (!formatters) {
    try {
      formatters = createFormatters(locale, hour12);
    } catch {
      // A language tag Intl does not accept falls back to the browser's own.
      formatters = createFormatters(undefined, hour12);
    }
    formattersByLocale.set(cacheKey, formatters);
  }
  return formatters;
}

/**
 * The locale a time is written in: the app's language, refined by the
 * browser's own regional variant of that language when it lists one. The app
 * only knows `en`, which alone means US month and day order even for a reader
 * whose browser says `en-GB`; a language the app already pins to a region
 * (`zh-TW`, `pt-BR`) is used as it is.
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

/**
 * Whether times are written on a 12-hour clock, or undefined to leave it to
 * the locale. A region-pinned app language decides for itself. Otherwise the
 * browser's own locale does, as it does for every other time the app prints
 * (the time under a user turn, schedules): the app language is `en` until
 * someone picks another, and `en` alone would turn a German reader's 17:00
 * into 5:00 PM the moment these stamps are switched on.
 */
function resolveHour12(appLanguage: string | undefined): boolean | undefined {
  const browserLocale = typeof navigator === 'undefined' ? undefined : navigator.language;
  if (!browserLocale || appLanguage?.includes('-')) {
    return undefined;
  }
  if (!hour12ByBrowserLocale.has(browserLocale)) {
    let hour12: boolean | undefined;
    try {
      hour12 = new Intl.DateTimeFormat(browserLocale, { hour: 'numeric' }).resolvedOptions().hour12;
    } catch {
      hour12 = undefined;
    }
    hour12ByBrowserLocale.set(browserLocale, hour12);
  }
  return hour12ByBrowserLocale.get(browserLocale);
}

/** One formatter's label for a single time or, when the two differ, for the span between them. */
function formatSpan(formatter: Intl.DateTimeFormat, start: Date, end: Date | null): string {
  if (!end || end.getTime() === start.getTime()) {
    return formatter.format(start);
  }
  const rangeFormatter = formatter as RangeCapableFormat;
  return typeof rangeFormatter.formatRange === 'function'
    ? rangeFormatter.formatRange(start, end)
    : `${formatter.format(start)} – ${formatter.format(end)}`;
}

/**
 * Rendered by chat's MessageComponent, ToolGroupContainer, SubagentPanel,
 * SubagentTimeline and WorkflowPanel to stamp a row, a tool group, an agent
 * card, a subagent step or a workflow agent with the time it happened, while
 * the "Show timestamps" preference is on.
 *
 * The local time to the second, prefixed with the date once the row is not
 * from today (and with the year once it is not from this year); the full date
 * and time are in the tooltip. A collapsed run of work gets its first and
 * last time as one span. Absolute rather than "5 min ago", so nothing has to
 * tick: a relative label would need a timer to stay true, and would be wrong
 * in an exported file the moment it was saved. An exported row always
 * carries its date, since the file outlives the day it was made.
 *
 * Renders nothing for a missing or implausible value rather than
 * "Invalid Date" or a day in 1970.
 */
function TranscriptTimestamp({ value, endValue, className }: TranscriptTimestampProps) {
  const { i18n } = useTranslation();
  const isExporting = useIsExportingTranscript();
  const locale = resolveTimestampLocale(i18n.language);
  const hour12 = resolveHour12(i18n.language);

  // Whether the date is shown is decided at render, so a row drawn before
  // midnight keeps its date-less label until it next renders.
  const stamp = useMemo(() => {
    const first = toPlausibleTimestamp(value);
    const last = toPlausibleTimestamp(endValue);
    const known = [first, last].filter((date): date is Date => date !== null);
    if (known.length === 0) {
      return null;
    }
    known.sort((left, right) => left.getTime() - right.getTime());
    const start = known[0];
    const end = known.length > 1 ? known[1] : null;

    const formatters = getFormatters(locale, hour12);
    const now = new Date();
    const isToday = (date: Date) => date.toDateString() === now.toDateString();
    const isThisYear = (date: Date) => date.getFullYear() === now.getFullYear();
    const span = end ? [start, end] : [start];
    const formatter = span.every(isToday) && !isExporting
      ? formatters.time
      : span.every(isThisYear)
        ? formatters.dayAndTime
        : formatters.yearDayAndTime;
    return {
      // A span is machine-readable by where it starts.
      iso: start.toISOString(),
      label: formatSpan(formatter, start, end),
      full: formatSpan(formatters.full, start, end),
    };
  }, [value, endValue, locale, hour12, isExporting]);

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

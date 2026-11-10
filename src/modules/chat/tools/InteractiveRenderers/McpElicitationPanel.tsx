import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
// The rules file alone: it has no dependencies, unlike the ajv plugin around it.
import { fullFormats } from 'ajv-formats/dist/formats';

import type { PermissionPanelProps } from '@/shared/types';

/** One value a form field can hold once parsed, as MCP elicitation allows them. */
type FieldValue = string | number | boolean | string[];

type Choice = { value: string; label: string };

/** One field of the requested schema, read into what the form needs to draw and check it. */
type ElicitationField = {
  key: string;
  label: string;
  description?: string;
  required: boolean;
  kind: 'text' | 'number' | 'integer' | 'boolean' | 'choice' | 'multi';
  inputType: 'text' | 'email' | 'url' | 'date' | 'datetime-local';
  format?: string;
  choices: Choice[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  initial: string | boolean | string[];
};

/** The request as the backend forwards it from the Agent SDK's `onElicitation`. */
type ElicitationInput = {
  serverName?: string;
  displayName?: string;
  title?: string;
  description?: string;
  message?: string;
  mode?: 'form' | 'url';
  url?: string;
  requestedSchema?: { properties?: Record<string, unknown>; required?: unknown };
};

type RawValues = Record<string, string | boolean | string[]>;

const FORMAT_INPUT_TYPES: Record<string, ElicitationField['inputType']> = {
  email: 'email',
  uri: 'url',
  date: 'date',
  'date-time': 'datetime-local',
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asNumber = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

/** Choices from `enum` (labelled by `enumNames`) or from `oneOf`/`anyOf` entries of `const` and `title`. */
const readChoices = (schema: Record<string, unknown>): Choice[] | null => {
  if (Array.isArray(schema.enum)) {
    const names = Array.isArray(schema.enumNames) ? schema.enumNames : [];
    return schema.enum.map((value, index) => ({ value: String(value), label: String(names[index] ?? value) }));
  }
  const alternatives = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : null;
  if (alternatives && alternatives.length > 0 && alternatives.every((entry) => 'const' in asRecord(entry))) {
    return alternatives.map((entry) => {
      const record = asRecord(entry);
      return { value: String(record.const), label: String(record.title ?? record.const) };
    });
  }
  return null;
};

/** Reads the flat object schema MCP elicitation allows into form fields, in the server's order. */
const readFields = (requestedSchema: ElicitationInput['requestedSchema']): ElicitationField[] => {
  const properties = asRecord(requestedSchema?.properties);
  const required = new Set(Array.isArray(requestedSchema?.required) ? requestedSchema.required : []);
  return Object.entries(properties).map(([key, raw]) => {
    const schema = asRecord(raw);
    const itemChoices = schema.type === 'array' ? readChoices(asRecord(schema.items)) : null;
    const choices = itemChoices ?? readChoices(schema);
    const kind: ElicitationField['kind'] = itemChoices
      ? 'multi'
      : choices
        ? 'choice'
        : schema.type === 'boolean'
          ? 'boolean'
          : schema.type === 'integer'
            ? 'integer'
            : schema.type === 'number'
              ? 'number'
              : 'text';
    const fallback = schema.default;
    // A single choice is held as its position in `choices`, so that '' can mean
    // "nothing chosen" even when an enum value is itself empty or blank.
    const defaultChoice = kind === 'choice' && fallback !== undefined
      ? (choices ?? []).findIndex((choice) => choice.value === String(fallback))
      : -1;
    const initial = kind === 'multi'
      // Only what a box can show as ticked, so nothing is sent that was not on screen.
      ? (Array.isArray(fallback) ? (choices ?? []).map((choice) => choice.value).filter((value) => fallback.map(String).includes(value)) : [])
      : kind === 'boolean'
        ? fallback === true
        : kind === 'choice'
          ? (defaultChoice >= 0 ? String(defaultChoice) : '')
          : toInitialText(schema.format, fallback);
    return {
      key,
      label: typeof schema.title === 'string' && schema.title ? schema.title : key,
      description: typeof schema.description === 'string' ? schema.description : undefined,
      required: required.has(key),
      kind,
      inputType: FORMAT_INPUT_TYPES[String(schema.format)] ?? 'text',
      format: typeof schema.format === 'string' ? schema.format : undefined,
      choices: choices ?? [],
      minLength: asNumber(schema.minLength),
      maxLength: asNumber(schema.maxLength),
      minimum: asNumber(schema.minimum),
      maximum: asNumber(schema.maximum),
      minItems: asNumber(schema.minItems),
      maxItems: asNumber(schema.maxItems),
      initial,
    };
  });
};

/**
 * The text a field sends. A `datetime-local` input gives local time without
 * seconds or offset, which RFC 3339 `date-time` rejects, so a `date-time`
 * answer goes out as an ISO 8601 instant in UTC. Null when it is not a date,
 * or names a local time that does not exist.
 */
// What a datetime-local input gives (local time, seconds and fraction optional),
// and the same with an explicit offset. Any other shape is not guessed at.
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const OFFSET_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** An instant as a datetime-local input shows it: local wall time, seconds only when it has them. */
const toPickerValue = (instant: Date): string => {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  const minutes = `${pad(instant.getFullYear(), 4)}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}T${pad(instant.getHours())}:${pad(instant.getMinutes())}`;
  const milliseconds = instant.getMilliseconds();
  if (!instant.getSeconds() && !milliseconds) return minutes;
  return `${minutes}:${pad(instant.getSeconds())}${milliseconds ? `.${pad(milliseconds, 3)}` : ''}`;
};

/**
 * A schema default as its input can show it. Date inputs blank any value not in
 * their own shape, while the state behind them keeps it, which would submit a
 * value nobody saw. So a date-time default becomes local wall time, and a default
 * these inputs cannot show starts the field empty.
 */
const toInitialText = (format: unknown, fallback: unknown): string => {
  if (fallback === undefined || fallback === null) return '';
  const text = String(fallback);
  if (format === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  if (format !== 'date-time') return text;
  if (!LOCAL_DATE_TIME.test(text) && !OFFSET_DATE_TIME.test(text)) return '';
  const instant = new Date(text);
  return Number.isNaN(instant.getTime()) ? '' : toPickerValue(instant);
};

const toSubmittedText = (field: ElicitationField, text: string): string | null => {
  if (field.format !== 'date-time') return text;
  const local = LOCAL_DATE_TIME.exec(text);
  if (!local && !OFFSET_DATE_TIME.test(text)) return null;
  const instant = new Date(text);
  if (Number.isNaN(instant.getTime())) return null;
  // A local time a DST change skipped (02:30 on a spring-forward night) parses
  // to an hour later; refuse it rather than send a time nobody picked. Offsets
  // are whole seconds but not always whole minutes (historical zones had gaps
  // of under a minute), so the wall time is compared to the second.
  if (local) {
    const [year, month, day, hours, minutes] = local.slice(1, 6).map(Number);
    const seconds = Number(local[6] ?? '0');
    const sameWallTime = instant.getFullYear() === year
      && instant.getMonth() + 1 === month
      && instant.getDate() === day
      && instant.getHours() === hours
      && instant.getMinutes() === minutes
      && instant.getSeconds() === seconds;
    if (!sameWallTime) return null;
  }
  return instant.toISOString();
};

/**
 * Whether a value meets its `format` by the rules the MCP SDK validates an
 * answer with on the server (ajv-formats, full mode), so the panel does not
 * send what the server would reject. A format those rules lack is not checked.
 */
const matchesFormat = (format: string, value: string): boolean => {
  const rule: unknown = (fullFormats as Record<string, unknown>)[format];
  const check = rule && typeof rule === 'object' && !(rule instanceof RegExp) && 'validate' in rule
    ? (rule as { validate: unknown }).validate
    : rule;
  if (check instanceof RegExp) return check.test(value);
  if (typeof check === 'function') return Boolean((check as (candidate: string) => unknown)(value));
  return true;
};

/**
 * The string a choice or text field would send, so every check runs on what the
 * server will validate rather than on what was typed. `answered: false` is an
 * empty field; `text: null` is a date-time that does not parse.
 */
const toSentString = (
  field: ElicitationField,
  value: RawValues[string] | undefined,
): { answered: false } | { answered: true; text: string | null } => {
  if (field.kind === 'choice') {
    // Held as a position: '' is "nothing chosen", and the enum value itself goes
    // out untrimmed, because an empty or blank value is a real choice.
    const choice = typeof value === 'string' && value !== '' ? field.choices[Number(value)] : undefined;
    return choice ? { answered: true, text: choice.value } : { answered: false };
  }
  const typed = typeof value === 'string' ? value.trim() : '';
  return typed ? { answered: true, text: toSubmittedText(field, typed) } : { answered: false };
};

const FORMAT_ERRORS: Record<string, { key: string; text: string }> = {
  email: { key: 'notAnEmail', text: 'Enter an email address' },
  uri: { key: 'notAUri', text: 'Enter a full address, such as https://example.com' },
  date: { key: 'notADate', text: 'Enter a date' },
  'date-time': { key: 'notADateTime', text: 'Enter a date and time' },
};

/** Only http(s) links get an Open button; anything else (`javascript:` above all) is shown as text. */
const isOpenableUrl = (url: string | undefined): boolean => {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

const inputClassName = 'w-full rounded-lg border-0 bg-gray-50 px-3 py-1.5 text-[13px] text-gray-900 outline-none ring-1 ring-gray-200 transition-shadow duration-200 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-400 dark:bg-gray-900/60 dark:text-gray-100 dark:ring-gray-700 dark:placeholder:text-gray-600 dark:focus:ring-blue-500';

/**
 * Registered by chat's PermissionRequestsBanner as the permission panel for
 * `McpElicitation` requests: an MCP server asking the person for input in the
 * middle of a tool call. A form request is drawn as a form built from its
 * schema and answered with typed content; a URL request offers its link.
 * Submit is `accept`, Decline is `decline`; the backend maps a request that
 * goes away unanswered to `cancel`.
 */
export const McpElicitationPanel: React.FC<PermissionPanelProps> = ({ request, onDecision }) => {
  const { t } = useTranslation();
  const input = (request.input ?? {}) as ElicitationInput;
  const isUrlMode = input.mode === 'url';
  const fields = useMemo(() => readFields(input.requestedSchema), [input.requestedSchema]);

  // The person's answers as typed, kept raw so a half-typed number is not lost
  // to parsing; they are parsed and checked against the schema on submit.
  const [values, setValues] = useState<RawValues>(() =>
    Object.fromEntries(fields.map((field) => [field.key, field.initial])),
  );
  // Whether Submit was tried once: field errors stay hidden until then, so an
  // empty form does not open covered in "Required".
  const [attempted, setAttempted] = useState(false);

  // The part of the form that scrolls, so a failed Submit can bring its first error into view.
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const setValue = useCallback((key: string, value: string | boolean | string[]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
  }, []);

  /** A field's error message, or null when its value fits the schema. */
  const errorFor = useCallback((field: ElicitationField): string | null => {
    const value = values[field.key];
    if (field.kind === 'boolean') return null;
    if (field.kind === 'multi') {
      const picked = Array.isArray(value) ? value : [];
      if (field.required && picked.length === 0) return t('chat:mcpElicitation.required', { defaultValue: 'Required' });
      if (field.minItems !== undefined && picked.length > 0 && picked.length < field.minItems) {
        return t('chat:mcpElicitation.tooFew', { count: field.minItems, defaultValue: 'Pick at least {{count}}' });
      }
      if (field.maxItems !== undefined && picked.length > field.maxItems) {
        return t('chat:mcpElicitation.tooMany', { count: field.maxItems, defaultValue: 'Pick at most {{count}}' });
      }
      return null;
    }
    if (field.kind === 'number' || field.kind === 'integer') {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text) return field.required ? t('chat:mcpElicitation.required', { defaultValue: 'Required' }) : null;
      const number = Number(text);
      if (!Number.isFinite(number)) return t('chat:mcpElicitation.notANumber', { defaultValue: 'Enter a number' });
      if (field.kind === 'integer' && !Number.isInteger(number)) {
        return t('chat:mcpElicitation.notAnInteger', { defaultValue: 'Enter a whole number' });
      }
      if (field.minimum !== undefined && number < field.minimum) {
        return t('chat:mcpElicitation.tooSmall', { value: field.minimum, defaultValue: 'At least {{value}}' });
      }
      if (field.maximum !== undefined && number > field.maximum) {
        return t('chat:mcpElicitation.tooLarge', { value: field.maximum, defaultValue: 'At most {{value}}' });
      }
      return null;
    }
    // Choice and text fields: every limit applies to the string that is sent,
    // which for a date-time is the UTC instant, not what the picker shows.
    const sent = toSentString(field, value);
    if (!sent.answered) {
      return field.required ? t('chat:mcpElicitation.required', { defaultValue: 'Required' }) : null;
    }
    const formatError = () => {
      const message = field.format ? FORMAT_ERRORS[field.format] : undefined;
      return message
        ? t(`chat:mcpElicitation.${message.key}`, { defaultValue: message.text })
        : t('chat:mcpElicitation.notTheFormat', { format: field.format, defaultValue: 'Not a valid {{format}}' });
    };
    if (sent.text === null) return formatError();
    // JSON Schema counts characters as code points, so an emoji is one, not two.
    const length = [...sent.text].length;
    if (field.minLength !== undefined && length < field.minLength) {
      return t('chat:mcpElicitation.tooShort', { count: field.minLength, defaultValue: 'At least {{count}} characters' });
    }
    if (field.maxLength !== undefined && length > field.maxLength) {
      return t('chat:mcpElicitation.tooLong', { count: field.maxLength, defaultValue: 'At most {{count}} characters' });
    }
    if (field.format && !matchesFormat(field.format, sent.text)) return formatError();
    return null;
  }, [values, t]);

  /** The typed content sent back on accept; optional fields left empty are left out. */
  const buildContent = useCallback((): Record<string, FieldValue> => {
    const content: Record<string, FieldValue> = {};
    for (const field of fields) {
      const value = values[field.key];
      if (field.kind === 'boolean') {
        content[field.key] = value === true;
      } else if (field.kind === 'multi') {
        const picked = Array.isArray(value) ? value : [];
        if (picked.length > 0) content[field.key] = picked;
      } else if (field.kind === 'number' || field.kind === 'integer') {
        const text = typeof value === 'string' ? value.trim() : '';
        if (text) content[field.key] = Number(text);
      } else {
        // The same string the checks above ran on.
        const sent = toSentString(field, value);
        if (sent.answered && sent.text !== null) content[field.key] = sent.text;
      }
    }
    return content;
  }, [fields, values]);

  const handleSubmit = useCallback((event?: React.FormEvent) => {
    event?.preventDefault();
    setAttempted(true);
    if (fields.some((field) => errorFor(field) !== null)) {
      // After the render that draws the errors. The buttons stay pinned while the
      // fields scroll, so the error may be out of sight.
      requestAnimationFrame(() => {
        const alert = scrollAreaRef.current?.querySelector('[role="alert"]');
        alert?.parentElement?.scrollIntoView?.({ block: 'nearest' });
      });
      return;
    }
    onDecision(request.requestId, { allow: true, updatedInput: { content: buildContent() } });
  }, [fields, errorFor, onDecision, request.requestId, buildContent]);

  const handleDecline = useCallback(() => {
    onDecision(request.requestId, { allow: false });
  }, [onDecision, request.requestId]);

  const handleOpenUrl = useCallback(() => {
    onDecision(request.requestId, { allow: true, updatedInput: {} });
  }, [onDecision, request.requestId]);

  const serverLabel = input.displayName || input.serverName || 'MCP';
  const canOpenUrl = isUrlMode && isOpenableUrl(input.url);

  return (
    <div className="w-full" data-testid="mcp-elicitation-panel">
      <div className="relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-lg dark:border-gray-700/50 dark:bg-gray-800/90 dark:shadow-2xl">
        <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-blue-500 via-cyan-400 to-teal-400" />

        <form onSubmit={handleSubmit} noValidate className="flex max-h-[70dvh] flex-col">
          {/* Only this part scrolls: a long form must not push its buttons out of reach, with the composer hidden. */}
          <div ref={scrollAreaRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            <div className="px-4 pb-2 pt-3.5">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  {t('chat:mcpElicitation.asks', { server: serverLabel, defaultValue: '{{server}} asks for your input' })}
                </span>
              </div>
              {input.title && (
                <p className="text-[12px] font-semibold text-gray-700 dark:text-gray-300">{input.title}</p>
              )}
              <p className="whitespace-pre-wrap text-[14px] font-medium leading-snug text-gray-900 dark:text-gray-100">
                {input.message}
              </p>
              {input.description && (
                <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{input.description}</p>
              )}
            </div>

            {isUrlMode ? (
              <div className="px-4 pb-2">
                <code className="block break-all rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-900/60 dark:text-gray-300">{input.url}</code>
                {!canOpenUrl && (
                  <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                    {t('chat:mcpElicitation.unsafeUrl', { defaultValue: 'Only http and https links can be opened from here.' })}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3 px-4 pb-3">
                {fields.map((field) => {
                  const id = `${request.requestId}-${field.key}`;
                  const error = attempted ? errorFor(field) : null;
                  const value = values[field.key];
                  // A checkbox always answers (unticked is false), so it is never marked optional.
                  const labelText = (
                    <span>
                      {field.label}
                      {!field.required && field.kind !== 'boolean' && (
                        <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">
                          ({t('chat:mcpElicitation.optional', { defaultValue: 'optional' })})
                        </span>
                      )}
                    </span>
                  );

                  if (field.kind === 'boolean') {
                    return (
                      <div key={field.key}>
                        <label htmlFor={id} className="flex items-center gap-2 text-[13px] font-medium text-gray-800 dark:text-gray-200">
                          <input
                            id={id}
                            type="checkbox"
                            checked={value === true}
                            onChange={(event) => setValue(field.key, event.target.checked)}
                          />
                          {labelText}
                        </label>
                        {field.description && <p className="ml-6 text-[11px] text-gray-500 dark:text-gray-400">{field.description}</p>}
                      </div>
                    );
                  }

                  if (field.kind === 'multi') {
                    const picked = Array.isArray(value) ? value : [];
                    return (
                      <fieldset key={field.key}>
                        <legend className="text-[13px] font-medium text-gray-800 dark:text-gray-200">{labelText}</legend>
                        {field.description && <p className="text-[11px] text-gray-500 dark:text-gray-400">{field.description}</p>}
                        <div className="mt-1 space-y-1">
                          {field.choices.map((choice) => (
                            <label key={choice.value} className="flex items-center gap-2 text-[13px] text-gray-700 dark:text-gray-300">
                              <input
                                type="checkbox"
                                checked={picked.includes(choice.value)}
                                onChange={(event) => setValue(
                                  field.key,
                                  event.target.checked
                                    ? field.choices.map((c) => c.value).filter((v) => v === choice.value || picked.includes(v))
                                    : picked.filter((v) => v !== choice.value),
                                )}
                              />
                              {choice.label}
                            </label>
                          ))}
                        </div>
                        {error && <p role="alert" className="mt-0.5 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
                      </fieldset>
                    );
                  }

                  return (
                    <div key={field.key}>
                      <label htmlFor={id} className="block text-[13px] font-medium text-gray-800 dark:text-gray-200">{labelText}</label>
                      {field.description && <p className="text-[11px] text-gray-500 dark:text-gray-400">{field.description}</p>}
                      <div className="mt-1">
                        {field.kind === 'choice' ? (
                          <select
                            id={id}
                            value={typeof value === 'string' ? value : ''}
                            onChange={(event) => setValue(field.key, event.target.value)}
                            className={inputClassName}
                          >
                            <option value="">{t('chat:mcpElicitation.choose', { defaultValue: 'Choose…' })}</option>
                            {field.choices.map((choice, index) => (
                              <option key={index} value={String(index)}>{choice.label}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={id}
                            type={field.kind === 'text' ? field.inputType : 'text'}
                            inputMode={field.kind === 'integer' ? 'numeric' : field.kind === 'number' ? 'decimal' : undefined}
                            value={typeof value === 'string' ? value : ''}
                            onChange={(event) => setValue(field.key, event.target.value)}
                            className={inputClassName}
                          />
                        )}
                      </div>
                      {error && <p role="alert" className="mt-0.5 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-gray-100 bg-gray-50/50 px-4 py-2 dark:border-gray-700/50 dark:bg-gray-800/50">
            <button
              type="button"
              onClick={handleDecline}
              className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-gray-600 transition-all duration-150 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/60"
            >
              {t('chat:mcpElicitation.decline', { defaultValue: 'Decline' })}
            </button>
            {isUrlMode ? (
              canOpenUrl && (
                <a
                  href={input.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleOpenUrl}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white transition-all duration-150 hover:bg-blue-700"
                >
                  {t('chat:mcpElicitation.openLink', { defaultValue: 'Open link' })}
                </a>
              )
            ) : (
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white transition-all duration-150 hover:bg-blue-700"
              >
                {t('chat:mcpElicitation.submit', { defaultValue: 'Submit' })}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

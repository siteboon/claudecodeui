/**
 * Classifies tool errors into categories for structured display.
 */

export type ErrorCategory =
  | 'permission_denied'
  | 'file_not_found'
  | 'syntax_error'
  | 'timeout'
  | 'network'
  | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  details?: string;
  isRetryable: boolean;
  suggestion: string;
}

// Patterns matched in order; first match wins.
const CATEGORY_PATTERNS: {
  category: ErrorCategory;
  patterns: RegExp[];
  isRetryable: boolean;
  suggestion: string;
}[] = [
  {
    category: 'permission_denied',
    patterns: [
      /permission denied/i,
      /EACCES/,
      /user denied tool use/i,
      /tool disallowed/i,
      /access denied/i,
      /not allowed/i,
      /forbidden/i,
    ],
    isRetryable: false,
    suggestion: 'Grant permission for this tool in settings or allow it when prompted.',
  },
  {
    category: 'file_not_found',
    patterns: [
      /ENOENT/,
      /no such file/i,
      /file not found/i,
      /does not exist/i,
      /not found.*path/i,
      /cannot find/i,
    ],
    isRetryable: false,
    suggestion: 'Check that the file path exists and is spelled correctly.',
  },
  {
    category: 'timeout',
    patterns: [
      /timeout/i,
      /ETIMEDOUT/,
      /timed out/i,
      /ESOCKETTIMEDOUT/,
      /deadline exceeded/i,
    ],
    isRetryable: true,
    suggestion: 'The operation timed out. Try again or increase the timeout.',
  },
  {
    category: 'network',
    patterns: [
      /ECONNREFUSED/,
      /ENOTFOUND/,
      /ECONNRESET/,
      /network error/i,
      /fetch failed/i,
      /socket hang up/i,
      /EHOSTUNREACH/,
      /getaddrinfo/i,
    ],
    isRetryable: true,
    suggestion: 'Check your network connection and try again.',
  },
  {
    category: 'syntax_error',
    patterns: [
      /SyntaxError/,
      /parse error/i,
      /unexpected token/i,
      /invalid syntax/i,
      /unterminated string/i,
    ],
    isRetryable: false,
    suggestion: 'Review the code for syntax issues.',
  },
];

/**
 * Classify a tool error string into a structured category.
 */
export function classifyToolError(
  _toolName: string,
  errorContent: string,
): ClassifiedError {
  const text = String(errorContent || '');

  for (const { category, patterns, isRetryable, suggestion } of CATEGORY_PATTERNS) {
    if (patterns.some((p) => p.test(text))) {
      return {
        category,
        message: text,
        isRetryable,
        suggestion,
      };
    }
  }

  return {
    category: 'unknown',
    message: text,
    isRetryable: false,
    suggestion: 'An unexpected error occurred.',
  };
}

/**
 * Extract a brief one-line summary from a potentially long error message.
 * Keeps the first meaningful line (skipping blanks).
 */
export function errorSummary(message: string, maxLength = 120): string {
  const firstLine = message
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return message;
  return firstLine.length > maxLength
    ? `${firstLine.slice(0, maxLength - 3)}...`
    : firstLine;
}

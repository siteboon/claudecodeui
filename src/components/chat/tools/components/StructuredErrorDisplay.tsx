import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  FileX,
  RefreshCw,
  ShieldAlert,
  Wifi,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ClassifiedError, ErrorCategory } from '../utils/errorClassifier';
import { errorSummary } from '../utils/errorClassifier';

// ---------------------------------------------------------------------------
// Category visual config
// ---------------------------------------------------------------------------

interface CategoryStyle {
  icon: typeof AlertCircle;
  label: string;
  borderClass: string;
  bgClass: string;
  iconClass: string;
  titleClass: string;
  textClass: string;
}

const CATEGORY_STYLES: Record<ErrorCategory, CategoryStyle> = {
  permission_denied: {
    icon: ShieldAlert,
    label: 'Permission Denied',
    borderClass: 'border-orange-200/60 dark:border-orange-800/40',
    bgClass: 'bg-orange-50/50 dark:bg-orange-950/10',
    iconClass: 'text-orange-500 dark:text-orange-400',
    titleClass: 'text-orange-700 dark:text-orange-300',
    textClass: 'text-orange-900 dark:text-orange-100',
  },
  file_not_found: {
    icon: FileX,
    label: 'File Not Found',
    borderClass: 'border-amber-200/60 dark:border-amber-800/40',
    bgClass: 'bg-amber-50/50 dark:bg-amber-950/10',
    iconClass: 'text-amber-500 dark:text-amber-400',
    titleClass: 'text-amber-700 dark:text-amber-300',
    textClass: 'text-amber-900 dark:text-amber-100',
  },
  syntax_error: {
    icon: AlertTriangle,
    label: 'Syntax Error',
    borderClass: 'border-red-200/60 dark:border-red-800/40',
    bgClass: 'bg-red-50/50 dark:bg-red-950/10',
    iconClass: 'text-red-500 dark:text-red-400',
    titleClass: 'text-red-700 dark:text-red-300',
    textClass: 'text-red-900 dark:text-red-100',
  },
  timeout: {
    icon: Clock,
    label: 'Timeout',
    borderClass: 'border-yellow-200/60 dark:border-yellow-800/40',
    bgClass: 'bg-yellow-50/50 dark:bg-yellow-950/10',
    iconClass: 'text-yellow-600 dark:text-yellow-400',
    titleClass: 'text-yellow-700 dark:text-yellow-300',
    textClass: 'text-yellow-900 dark:text-yellow-100',
  },
  network: {
    icon: Wifi,
    label: 'Network Error',
    borderClass: 'border-blue-200/60 dark:border-blue-800/40',
    bgClass: 'bg-blue-50/50 dark:bg-blue-950/10',
    iconClass: 'text-blue-500 dark:text-blue-400',
    titleClass: 'text-blue-700 dark:text-blue-300',
    textClass: 'text-blue-900 dark:text-blue-100',
  },
  unknown: {
    icon: AlertCircle,
    label: 'Error',
    borderClass: 'border-red-200/60 dark:border-red-800/40',
    bgClass: 'bg-red-50/50 dark:bg-red-950/10',
    iconClass: 'text-red-500 dark:text-red-400',
    titleClass: 'text-red-700 dark:text-red-300',
    textClass: 'text-red-900 dark:text-red-100',
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface StructuredErrorDisplayProps {
  error: ClassifiedError;
  toolName: string;
  /** Extra content to render below the error (e.g. permission grant buttons) */
  children?: React.ReactNode;
}

export default function StructuredErrorDisplay({
  error,
  toolName,
  children,
}: StructuredErrorDisplayProps) {
  const { t } = useTranslation('chat');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const style = CATEGORY_STYLES[error.category];
  const Icon = style.icon;
  const hasDetails = error.message.includes('\n') || error.message.length > 150;
  const brief = errorSummary(error.message);

  return (
    <div
      className={`relative mt-2 scroll-mt-4 rounded border ${style.borderClass} ${style.bgClass} p-3`}
    >
      {/* Header */}
      <div className="relative mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className={`h-4 w-4 ${style.iconClass}`} />
          <span className={`text-xs font-medium ${style.titleClass}`}>
            {style.label}
          </span>
          <span className="text-xs text-muted-foreground">
            {toolName}
          </span>
        </div>
        {error.isRetryable && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3" />
            {t('errors.retryable', 'Retryable')}
          </span>
        )}
      </div>

      {/* Summary */}
      <p className={`text-sm ${style.textClass}`}>{brief}</p>

      {/* Suggestion */}
      <p className="mt-1.5 text-xs text-muted-foreground italic">
        {error.suggestion}
      </p>

      {/* Collapsible details */}
      {hasDetails && (
        <div className="mt-2 border-t border-border/30 pt-2">
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {detailsOpen ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {t('errors.details', 'Details')}
          </button>
          {detailsOpen && (
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-background/60 p-2 text-xs text-muted-foreground">
              {error.message}
            </pre>
          )}
        </div>
      )}

      {/* Extra content (permission grant buttons, etc.) */}
      {children}
    </div>
  );
}

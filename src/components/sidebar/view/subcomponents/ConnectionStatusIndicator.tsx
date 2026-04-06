import { useTranslation } from 'react-i18next';
import { cn } from '../../../../lib/utils';

type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'deploying'
  | 'initializing'
  | 'ready'
  | 'reconnecting'
  | 'error'
  | 'failed';

type ConnectionStatusIndicatorProps = {
  state?: ConnectionState;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  showLabel?: boolean;
};

type StatusConfig = {
  colorClass: string;
  i18nKey: string;
  shouldPulse: boolean;
};

const sizeClassNames: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'w-2 h-2',
  sm: 'w-2.5 h-2.5',
  md: 'w-3 h-3',
};

const getStatusConfig = (state: ConnectionState): StatusConfig => {
  switch (state) {
    case 'ready':
      return {
        colorClass: 'bg-green-500 dark:bg-green-400',
        i18nKey: 'connectionStatus.connected',
        shouldPulse: false,
      };
    case 'connecting':
      return {
        colorClass: 'bg-yellow-500 dark:bg-yellow-400',
        i18nKey: 'connectionStatus.connecting',
        shouldPulse: true,
      };
    case 'deploying':
      return {
        colorClass: 'bg-yellow-500 dark:bg-yellow-400',
        i18nKey: 'connectionStatus.deploying',
        shouldPulse: true,
      };
    case 'initializing':
      return {
        colorClass: 'bg-yellow-500 dark:bg-yellow-400',
        i18nKey: 'connectionStatus.initializing',
        shouldPulse: true,
      };
    case 'reconnecting':
      return {
        colorClass: 'bg-yellow-500 dark:bg-yellow-400',
        i18nKey: 'connectionStatus.reconnecting',
        shouldPulse: true,
      };
    case 'error':
      return {
        colorClass: 'bg-red-500 dark:bg-red-400',
        i18nKey: 'connectionStatus.error',
        shouldPulse: false,
      };
    case 'failed':
      return {
        colorClass: 'bg-red-500 dark:bg-red-400',
        i18nKey: 'connectionStatus.failed',
        shouldPulse: false,
      };
    case 'disconnected':
    default:
      return {
        colorClass: 'bg-gray-400 dark:bg-gray-500',
        i18nKey: 'connectionStatus.disconnected',
        shouldPulse: false,
      };
  }
};

export default function ConnectionStatusIndicator({
  state = 'disconnected',
  size = 'xs',
  className,
  showLabel = false,
}: ConnectionStatusIndicatorProps) {
  const { t } = useTranslation('sidebar');
  const config = getStatusConfig(state);
  const label = t(config.i18nKey);

  return (
    <div className={cn('inline-flex items-center gap-1.5', className)} title={label}>
      <div
        className={cn(
          'rounded-full',
          sizeClassNames[size],
          config.colorClass,
          config.shouldPulse && 'animate-pulse',
        )}
      />
      {showLabel && (
        <span className="text-xs text-muted-foreground">{label}</span>
      )}
    </div>
  );
}

export type { ConnectionState };

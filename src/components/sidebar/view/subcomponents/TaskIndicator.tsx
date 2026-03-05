import { AlertCircle, CheckCircle, Settings, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../../../lib/utils';

type TaskIndicatorStatus =
  | 'fully-configured'
  | 'taskmaster-only'
  | 'mcp-only'
  | 'not-configured'
  | 'error';

type TaskIndicatorSize = 'xs' | 'sm' | 'md' | 'lg';

type TaskIndicatorProps = {
  status?: TaskIndicatorStatus;
  size?: TaskIndicatorSize;
  className?: string;
  showLabel?: boolean;
};

type IndicatorConfig = {
  icon: LucideIcon;
  colorClassName: string;
  backgroundClassName: string;
  label: string;
  title: string;
};

const sizeClassNames: Record<TaskIndicatorSize, string> = {
  xs: 'w-3 h-3',
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
};

const paddingClassNames: Record<TaskIndicatorSize, string> = {
  xs: 'p-0.5',
  sm: 'p-1',
  md: 'p-1.5',
  lg: 'p-2',
};

const getIndicatorConfig = (status: TaskIndicatorStatus): IndicatorConfig => {
  // Keep color and label mapping centralized so status display remains consistent in sidebar UIs.
  if (status === 'fully-configured') {
    return {
      icon: CheckCircle,
      colorClassName: 'text-green-500 dark:text-green-400',
      backgroundClassName: 'bg-green-50 dark:bg-green-950',
      label: 'TaskMaster Ready',
      title: 'TaskMaster fully configured with MCP server',
    };
  }

  if (status === 'taskmaster-only') {
    return {
      icon: Settings,
      colorClassName: 'text-blue-500 dark:text-blue-400',
      backgroundClassName: 'bg-blue-50 dark:bg-blue-950',
      label: 'TaskMaster Init',
      title: 'TaskMaster initialized, MCP server needs setup',
    };
  }

  if (status === 'mcp-only') {
    return {
      icon: AlertCircle,
      colorClassName: 'text-amber-500 dark:text-amber-400',
      backgroundClassName: 'bg-amber-50 dark:bg-amber-950',
      label: 'MCP Ready',
      title: 'MCP server configured, TaskMaster needs initialization',
    };
  }

  return {
    icon: X,
    colorClassName: 'text-gray-400 dark:text-gray-500',
    backgroundClassName: 'bg-gray-50 dark:bg-gray-900',
    label: 'No TaskMaster',
    title: 'TaskMaster not configured',
  };
};

export default function TaskIndicator({
  status = 'not-configured',
  size = 'sm',
  className = '',
  showLabel = false,
}: TaskIndicatorProps) {
  const indicatorConfig = getIndicatorConfig(status);
  const Icon = indicatorConfig.icon;

  if (showLabel) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1.5 text-xs rounded-md px-2 py-1 transition-colors',
          indicatorConfig.backgroundClassName,
          indicatorConfig.colorClassName,
          className,
        )}
        title={indicatorConfig.title}
      >
        <Icon className={sizeClassNames[size]} />
        <span className="font-medium">{indicatorConfig.label}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded-full transition-colors',
        indicatorConfig.backgroundClassName,
        paddingClassNames[size],
        className,
      )}
      title={indicatorConfig.title}
    >
      <Icon className={cn(sizeClassNames[size], indicatorConfig.colorClassName)} />
    </div>
  );
}

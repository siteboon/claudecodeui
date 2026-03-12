type LoggerLevel = 'info' | 'warn' | 'error';

function formatMetadata(metadata?: Record<string, unknown>): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return '';
  }

  return ` ${JSON.stringify(metadata)}`;
}

function write(level: LoggerLevel, message: string, metadata?: Record<string, unknown>): void {
  const prefix = `[server:${level}]`;
  const formatted = `${prefix} ${message}${formatMetadata(metadata)}`;

  if (level === 'error') {
    console.error(formatted);
    return;
  }

  if (level === 'warn') {
    console.warn(formatted);
    return;
  }

  console.log(formatted);
}

export const logger = {
  info: (message: string, metadata?: Record<string, unknown>) => write('info', message, metadata),
  warn: (message: string, metadata?: Record<string, unknown>) => write('warn', message, metadata),
  error: (message: string, metadata?: Record<string, unknown>) => write('error', message, metadata),
};

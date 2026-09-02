export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  level: LogLevel;
  enabled: boolean;
}

class Logger {
  private config: LoggerConfig = {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
    enabled: true
  };

  private levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  configure(config: Partial<LoggerConfig>) {
    this.config = { ...this.config, ...config };
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.config.enabled) return false;
    return this.levels[level] >= this.levels[this.config.level];
  }

  private format(level: LogLevel, source: string, message: string): string {
    const time = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    return `[${time}] [${level.toUpperCase()}] [${source}] ${message}`;
  }

  debug(source: string, message: string, data?: any) {
    if (!this.shouldLog('debug')) return;
    console.log(this.format('debug', source, message), data || '');
  }

  info(source: string, message: string, data?: any) {
    if (!this.shouldLog('info')) return;
    console.info(this.format('info', source, message), data || '');
  }

  warn(source: string, message: string, data?: any) {
    if (!this.shouldLog('warn')) return;
    console.warn(this.format('warn', source, message), data || '');
  }

  error(source: string, message: string, error?: any) {
    if (!this.shouldLog('error')) return;
    console.error(this.format('error', source, message), error || '');
  }
}

export const logger = new Logger();

if (process.env.NODE_ENV === 'production') {
  logger.configure({ level: 'error' });
}

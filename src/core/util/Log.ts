export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Единый лог с уровнями. В релизе уровень поднимается до warn (см. main.ts). */
class Logger {
  private min: LogLevel = 'debug';

  setLevel(level: LogLevel): void {
    this.min = level;
  }

  get level(): LogLevel {
    return this.min;
  }

  debug(...args: unknown[]): void {
    this.write('debug', args);
  }
  info(...args: unknown[]): void {
    this.write('info', args);
  }
  warn(...args: unknown[]): void {
    this.write('warn', args);
  }
  error(...args: unknown[]): void {
    this.write('error', args);
  }

  private write(level: LogLevel, args: unknown[]): void {
    if (ORDER[level] < ORDER[this.min]) return;
    const fn =
      level === 'debug'
        ? console.debug
        : level === 'info'
          ? console.info
          : level === 'warn'
            ? console.warn
            : console.error;
    fn('[pustosh]', ...args);
  }
}

export const log = new Logger();

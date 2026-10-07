export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Discards everything. The default for programmatic use. */
export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

/** Writes to the terminal: progress to stdout, warnings and errors to stderr. */
export function createConsoleLogger(): Logger {
  const paint = (code: number, text: string): string =>
    process.stderr.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text;

  return {
    info(message) {
      process.stdout.write(`${message}\n`);
    },
    warn(message) {
      process.stderr.write(`${paint(33, 'warning:')} ${message}\n`);
    },
    error(message) {
      process.stderr.write(`${paint(31, 'error:')} ${message}\n`);
    },
  };
}

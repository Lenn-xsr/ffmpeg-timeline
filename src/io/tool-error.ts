interface ProcessError extends Error {
  code?: string | number | null;
  stderr?: unknown;
}

/**
 * Converts a failure to start or run an external tool into a readable error.
 * A missing executable is by far the most common cause, so it gets its own message.
 */
export function toolError(tool: string, cause: unknown, summary: string): Error {
  if (!(cause instanceof Error)) {
    return new Error(summary, { cause });
  }

  const error: ProcessError = cause;
  if (error.code === 'ENOENT') {
    return new Error(`${tool} was not found on PATH. Install FFmpeg and try again.`, { cause });
  }

  const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
  return new Error(`${summary}: ${stderr || error.message}`, { cause });
}

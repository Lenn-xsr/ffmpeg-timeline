import { spawn } from 'node:child_process';
import { toolError } from './tool-error.js';

export interface RunOptions {
  /** Forward FFmpeg's progress output to the terminal instead of capturing it. */
  showOutput: boolean;
}

/** Runs FFmpeg and resolves when it exits successfully. */
export function runFfmpeg(args: readonly string[], { showOutput }: RunOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    // Errors only, plus the one-line progress display when the output is shown.
    const fullArgs = ['-loglevel', 'error', ...(showOutput ? ['-stats'] : []), ...args];
    const child = spawn('ffmpeg', fullArgs, {
      stdio: ['ignore', showOutput ? 'inherit' : 'ignore', showOutput ? 'inherit' : 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    child.on('error', (error) => {
      reject(toolError('ffmpeg', error, 'ffmpeg could not be started'));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim();
      reject(new Error(`ffmpeg exited with code ${code}${detail ? `:\n${detail}` : ''}`));
    });
  });
}

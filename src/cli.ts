#!/usr/bin/env node
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { ValidationError } from './core/errors.js';
import { createConsoleLogger } from './io/logger.js';
import { render } from './render.js';

const USAGE = `Usage: ffmpeg-timeline render [project.json] [options]

Compiles a timeline project into a single FFmpeg invocation and renders it.

Arguments:
  project.json         Project file (default: project.json)

Options:
  -o, --output <file>  Output file (default: output/final.mp4 next to the project file)
  -h, --help           Show this help
  -v, --version        Show the version
`;

/** Runs the CLI and returns the process exit code. */
async function main(argv: string[]): Promise<number> {
  const log = createConsoleLogger();

  let values: { output?: string; help?: boolean; version?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        output: { type: 'string', short: 'o' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    }));
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.stderr.write(`\n${USAGE}`);
    return 2;
  }

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (values.version) {
    const require = createRequire(import.meta.url);
    const { version } = require('../package.json') as { version: string };
    process.stdout.write(`${version}\n`);
    return 0;
  }

  const [command, projectFile = 'project.json', ...extra] = positionals;
  if (command !== 'render' || extra.length > 0) {
    log.error(usageProblem(command, extra));
    process.stderr.write(`\n${USAGE}`);
    return 2;
  }

  try {
    await render({ projectFile, outputFile: values.output, logger: log, showFfmpegOutput: true });
    return 0;
  } catch (error) {
    if (error instanceof ValidationError) {
      log.error('The project is not valid:');
      error.issues.forEach((issue) => process.stderr.write(`  - ${issue}\n`));
    } else {
      log.error(error instanceof Error ? error.message : String(error));
    }
    return 1;
  }
}

function usageProblem(command: string | undefined, extra: string[]): string {
  if (command === undefined) {
    return 'Missing command.';
  }
  if (command !== 'render') {
    return `Unknown command "${command}".`;
  }
  return `Unexpected argument "${extra[0]}".`;
}

process.exitCode = await main(process.argv.slice(2));

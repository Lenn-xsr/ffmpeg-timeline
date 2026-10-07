import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { compileProject } from './core/compile.js';
import { buildFfmpegArgs } from './core/ffmpeg-args.js';
import type { FilterGraph } from './core/filter-graph.js';
import type { Freeze, OverlaySegment } from './core/timeline.js';
import { runFfmpeg } from './io/ffmpeg.js';
import { silentLogger, type Logger } from './io/logger.js';
import { probeMedia, type MediaInfo } from './io/probe.js';
import { loadProject } from './io/project-loader.js';

export interface RenderOptions {
  projectFile: string;
  /** Defaults to `output/final.mp4` next to the project file. */
  outputFile?: string;
  logger?: Logger;
  /** Forward FFmpeg's own progress output to the terminal. Default false. */
  showFfmpegOutput?: boolean;
}

export interface RenderResult {
  outputPath: string;
  graph: FilterGraph;
  ffmpegArgs: string[];
}

/**
 * Renders a project file to an MP4.
 *
 * This is the only place where the stages meet the outside world:
 * load and validate -> probe the media -> compile (pure) -> run FFmpeg.
 */
export async function render(options: RenderOptions): Promise<RenderResult> {
  const log = options.logger ?? silentLogger;
  const startedAt = Date.now();

  const { project, projectDir, inputs } = await loadProject(options.projectFile);
  log.info(`Project: ${path.resolve(options.projectFile)} (${inputs.length} track(s))`);

  const media = await Promise.all(inputs.map((input) => probeMedia(input)));
  media.forEach((info, index) => {
    const role = index === 0 ? 'base' : 'overlay';
    log.info(`  input ${index} (${role}): ${describeMedia(info)}`);
  });

  // The loader guarantees at least one track, so the base media is always present.
  const base = media[0] as MediaInfo;
  const { timeline, graph } = compileProject(project, base);

  log.info(
    `Timeline: ${timeline.freezes.length} freeze(s), ${timeline.overlays.length} overlay segment(s)`,
  );
  timeline.freezes.forEach((freeze) => log.info(`  ${describeFreeze(freeze)}`));
  timeline.overlays.forEach((segment) => log.info(`  ${describeSegment(segment)}`));

  log.info('Filter graph:');
  graph.chains.forEach((chain) => log.info(`  ${chain}`));

  const outputPath = options.outputFile
    ? path.resolve(options.outputFile)
    : path.join(projectDir, 'output', 'final.mp4');
  await mkdir(path.dirname(outputPath), { recursive: true });

  const ffmpegArgs = buildFfmpegArgs({ inputs, graph, output: outputPath });
  await runFfmpeg(ffmpegArgs, { showOutput: options.showFfmpegOutput ?? false });

  const { size } = await stat(outputPath);
  const megabytes = (size / (1024 * 1024)).toFixed(2);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  log.info(`Output: ${outputPath} (${megabytes} MB, rendered in ${seconds}s)`);

  return { outputPath, graph, ffmpegArgs };
}

function describeMedia(info: MediaInfo): string {
  const fps = info.fps === null ? 'unknown fps' : `${Number(info.fps.toFixed(2))} fps`;
  const audio = info.hasAudio ? 'with audio' : 'no audio';
  return `${info.width}x${info.height}, ${info.duration.toFixed(2)}s, ${fps}, ${audio}`;
}

function describeFreeze(freeze: Freeze): string {
  const end = Number((freeze.outputStart + freeze.duration).toFixed(6));
  return `freeze ${freeze.outputStart}s-${end}s: holds the base frame at ${freeze.sourceTime}s`;
}

function describeSegment(segment: OverlaySegment): string {
  const { placement } = segment;
  const window = `${segment.start}s-${segment.end === null ? 'end' : `${segment.end}s`}`;

  let layout: string;
  switch (placement.kind) {
    case 'fullscreen':
      layout = 'fullscreen';
      break;
    case 'anchor':
      layout = `scale ${placement.scale}, ${placement.anchor}, padding ${placement.padding}`;
      break;
    case 'absolute':
      layout = `scale ${placement.scale}, at (${placement.x}, ${placement.y})`;
      break;
  }

  const opacity = segment.opacity < 1 ? `, opacity ${segment.opacity}` : '';
  return `overlay input ${segment.input} ${window}: ${layout}${opacity}`;
}

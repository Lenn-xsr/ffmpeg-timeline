import type { FilterGraph } from './filter-graph.js';

export interface FfmpegInvocation {
  /** Absolute paths of the inputs, in track order (base first). */
  inputs: readonly string[];
  graph: FilterGraph;
  output: string;
}

/**
 * Builds the argument list of the single FFmpeg process that renders a
 * project: H.264 video, AAC audio, MP4 container.
 */
export function buildFfmpegArgs({ inputs, graph, output }: FfmpegInvocation): string[] {
  return [
    '-hide_banner',
    '-y',
    ...inputs.flatMap((input) => ['-i', input]),
    '-filter_complex',
    graph.filterComplex,
    '-map',
    graph.videoLabel,
    // Without a graph-produced audio stream, pass the base audio through if it exists.
    '-map',
    graph.audioLabel ?? '0:a?',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'medium',
    '-crf',
    '22',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    output,
  ];
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { toolError } from './tool-error.js';

const execFileAsync = promisify(execFile);

export interface MediaInfo {
  width: number;
  height: number;
  /** Duration of the video stream in seconds. */
  duration: number;
  /** Frames per second, or `null` when ffprobe does not report a usable rate. */
  fps: number | null;
  hasAudio: boolean;
}

/** The subset of `ffprobe -print_format json` output this module reads. */
interface ProbeOutput {
  streams?: {
    codec_type?: string;
    width?: number;
    height?: number;
    duration?: string;
    r_frame_rate?: string;
  }[];
  format?: { duration?: string };
}

/** Runs ffprobe on a media file. */
export async function probeMedia(file: string): Promise<MediaInfo> {
  const args = ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file];

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('ffprobe', args));
  } catch (error) {
    throw toolError('ffprobe', error, `ffprobe could not read ${file}`);
  }

  return parseProbeOutput(stdout, file);
}

/** Extracts the facts the pipeline needs from ffprobe's JSON output. Pure. */
export function parseProbeOutput(json: string, file: string): MediaInfo {
  const data = JSON.parse(json) as ProbeOutput;
  const streams = data.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');

  if (video === undefined || !video.width || !video.height) {
    throw new Error(`No video stream found in ${file}`);
  }

  const duration = parseSeconds(video.duration) ?? parseSeconds(data.format?.duration);
  if (duration === null) {
    throw new Error(`Could not determine the duration of ${file}`);
  }

  return {
    width: video.width,
    height: video.height,
    duration,
    fps: parseFrameRate(video.r_frame_rate),
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
  };
}

function parseSeconds(value: string | undefined): number | null {
  const seconds = Number.parseFloat(value ?? '');
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** Parses a rational such as `30000/1001`. */
function parseFrameRate(value: string | undefined): number | null {
  const [numerator, denominator] = (value ?? '').split('/').map(Number);
  if (numerator === undefined || denominator === undefined) {
    return null;
  }
  const fps = numerator / denominator;
  return Number.isFinite(fps) && fps > 0 ? fps : null;
}

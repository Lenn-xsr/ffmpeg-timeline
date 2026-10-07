import type { Anchor } from './schema.js';
import type { Freeze, OverlaySegment, Placement, Timeline } from './timeline.js';

/** Facts about the base video (FFmpeg input 0) the graph depends on. */
export interface BaseVideo {
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface FilterGraph {
  /** One entry per filter chain, in order. */
  chains: string[];
  /** The chains joined with `;`, ready to be passed to `-filter_complex`. */
  filterComplex: string;
  /** Output label of the composed video. */
  videoLabel: string;
  /** Output label of the audio, or `null` when the graph leaves the audio untouched. */
  audioLabel: string | null;
}

const VIDEO_OUT = '[vout]';
const AUDIO_OUT = '[aout]';

/**
 * Compiles a timeline into an FFmpeg filter graph.
 *
 * Input 0 is the base video; overlay segments reference their own input
 * index. The graph has two parts:
 *
 * 1. Freezes: the base is cut at every hold position, each piece that follows
 *    a hold repeats its first frame for the hold duration, and the pieces are
 *    concatenated again. The base audio, if any, gets matching silence.
 * 2. Overlays: every segment scales its input and is composited on top of the
 *    previous result, enabled only inside its time window.
 */
export function buildFilterGraph(timeline: Timeline, base: BaseVideo): FilterGraph {
  const chains: string[] = [];
  let video = '[0:v]';
  let audioLabel: string | null = null;

  if (timeline.freezes.length > 0) {
    const sections = splitBase(timeline.freezes);
    chains.push(...buildFreezeChains(sections, base.hasAudio));
    video = '[base]';
    audioLabel = base.hasAudio ? AUDIO_OUT : null;
  }

  const { overlays } = timeline;

  if (overlays.length === 0) {
    chains.push(`${video}null${VIDEO_OUT}`);
  }

  overlays.forEach((segment, index) => {
    const scaled = `[ov${index}]`;
    const output = index === overlays.length - 1 ? VIDEO_OUT : `[v${index}]`;
    const { x, y } = position(segment.placement);

    chains.push(`[${segment.input}:v]${sizeFilters(segment, base)}${scaled}`);
    chains.push(
      `${video}${scaled}overlay=x=${x}:y=${y}:format=auto:enable='${enableWindow(segment)}'${output}`,
    );
    video = output;
  });

  return { chains, filterComplex: chains.join(';'), videoLabel: VIDEO_OUT, audioLabel };
}

/** A contiguous piece of the base video, optionally preceded by a hold of its first frame. */
interface BaseSection {
  start: number;
  end: number | null;
  hold: number;
}

function splitBase(freezes: readonly Freeze[]): BaseSection[] {
  const sections: BaseSection[] = [];
  const first = freezes[0];

  if (first !== undefined && first.sourceTime > 0) {
    sections.push({ start: 0, end: first.sourceTime, hold: 0 });
  }

  freezes.forEach((freeze, index) => {
    sections.push({
      start: freeze.sourceTime,
      end: freezes[index + 1]?.sourceTime ?? null,
      hold: freeze.duration,
    });
  });

  return sections;
}

function buildFreezeChains(sections: readonly BaseSection[], withAudio: boolean): string[] {
  const chains: string[] = [];
  const concatInputs: string[] = [];

  sections.forEach((section, index) => {
    const range = trimRange(section);
    const videoLabel = `[base${index}]`;
    const hold =
      section.hold > 0 ? `,tpad=start_mode=clone:start_duration=${num(section.hold)}` : '';

    chains.push(`[0:v]trim=${range},setpts=PTS-STARTPTS${hold}${videoLabel}`);
    concatInputs.push(videoLabel);

    if (withAudio) {
      const audioLabel = `[aud${index}]`;
      const silence =
        section.hold > 0 ? `,adelay=delays=${Math.round(section.hold * 1000)}:all=1` : '';

      chains.push(`[0:a]atrim=${range},asetpts=PTS-STARTPTS${silence}${audioLabel}`);
      concatInputs.push(audioLabel);
    }
  });

  const outputs = withAudio ? `[base]${AUDIO_OUT}` : '[base]';
  chains.push(
    `${concatInputs.join('')}concat=n=${sections.length}:v=1:a=${withAudio ? 1 : 0}${outputs}`,
  );

  return chains;
}

function trimRange(section: BaseSection): string {
  const start = `start=${num(section.start)}`;
  return section.end === null ? start : `${start}:end=${num(section.end)}`;
}

function sizeFilters(segment: OverlaySegment, base: BaseVideo): string {
  const { placement, opacity } = segment;
  const scale =
    placement.kind === 'fullscreen'
      ? `scale=${base.width}:${base.height}`
      : `scale=iw*${num(placement.scale)}:ih*${num(placement.scale)}`;

  // colorchannelmixer can only fade a stream that has an alpha channel.
  return opacity < 1 ? `${scale},format=rgba,colorchannelmixer=aa=${num(opacity)}` : scale;
}

/** Half-open window, so adjacent segments never overlap on the boundary frame. */
function enableWindow(segment: OverlaySegment): string {
  const from = `gte(t,${num(segment.start)})`;
  return segment.end === null ? from : `${from}*lt(t,${num(segment.end)})`;
}

interface Position {
  x: string;
  y: string;
}

/** Overlay coordinates as FFmpeg expressions (`W`/`H`: base size, `w`/`h`: overlay size). */
function position(placement: Placement): Position {
  switch (placement.kind) {
    case 'fullscreen':
      return { x: '0', y: '0' };
    case 'anchor':
      return anchorPosition(placement.anchor, placement.padding);
    case 'absolute':
      return { x: coordinate(placement.x), y: coordinate(placement.y) };
  }
}

function anchorPosition(anchor: Anchor, padding: number): Position {
  const pad = num(padding);
  const left = pad;
  const center = '(W-w)/2';
  const right = `W-w-${pad}`;
  const top = pad;
  const middle = '(H-h)/2';
  const bottom = `H-h-${pad}`;

  const positions: Record<Anchor, Position> = {
    'top-left': { x: left, y: top },
    'top-center': { x: center, y: top },
    'top-right': { x: right, y: top },
    'center-left': { x: left, y: middle },
    center: { x: center, y: middle },
    'center-right': { x: right, y: middle },
    'bottom-left': { x: left, y: bottom },
    'bottom-center': { x: center, y: bottom },
    'bottom-right': { x: right, y: bottom },
  };

  return positions[anchor];
}

/** Expressions are quoted because they may contain commas, which separate filters. */
function coordinate(value: number | string): string {
  return typeof value === 'number' ? num(value) : `'${value}'`;
}

/** Formats a number without float noise or exponent notation. */
function num(value: number): string {
  return String(Number(value.toFixed(6)));
}

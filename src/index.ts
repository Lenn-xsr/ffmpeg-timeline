export { compileProject, type BaseMedia, type CompiledProject } from './core/compile.js';
export { ValidationError } from './core/errors.js';
export { buildFfmpegArgs, type FfmpegInvocation } from './core/ffmpeg-args.js';
export { buildFilterGraph, type BaseVideo, type FilterGraph } from './core/filter-graph.js';
export {
  ANCHORS,
  type Anchor,
  type BaseTrack,
  type FreezeKeyframe,
  type OverlayKeyframe,
  type OverlayTrack,
  type Project,
} from './core/schema.js';
export {
  buildTimeline,
  parseFreezes,
  parseOverlaySegments,
  type Freeze,
  type OverlaySegment,
  type Placement,
  type Timeline,
} from './core/timeline.js';
export { validateProject } from './core/validation.js';
export { createConsoleLogger, silentLogger, type Logger } from './io/logger.js';
export { parseProbeOutput, probeMedia, type MediaInfo } from './io/probe.js';
export { loadProject, type LoadedProject } from './io/project-loader.js';
export { render, type RenderOptions, type RenderResult } from './render.js';

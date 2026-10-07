import { buildFilterGraph, type BaseVideo, type FilterGraph } from './filter-graph.js';
import type { Project } from './schema.js';
import { buildTimeline, type Timeline } from './timeline.js';

export interface BaseMedia extends BaseVideo {
  /** Duration of the base video in seconds. */
  duration: number;
}

export interface CompiledProject {
  timeline: Timeline;
  graph: FilterGraph;
}

/**
 * The pure part of the pipeline: validated project in, filter graph out.
 * The only knowledge about the media it needs is what `ffprobe` reports for
 * the base video.
 */
export function compileProject(project: Project, base: BaseMedia): CompiledProject {
  const timeline = buildTimeline(project, base.duration);
  const graph = buildFilterGraph(timeline, base);
  return { timeline, graph };
}

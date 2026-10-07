/**
 * Types describing the project file. `validateProject` turns untrusted JSON
 * into a value of type `Project`; every later stage relies on these types.
 *
 * All `time` values are seconds on the output timeline (the clock of the
 * rendered video), on every track.
 */

/** Points an overlay can be pinned to inside the base frame. */
export const ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;

export type Anchor = (typeof ANCHORS)[number];

/**
 * Keyframe of the base track. Keyframes come in pairs: `freeze: true` holds
 * the current base frame, the following `freeze: false` resumes playback from
 * the position where it stopped.
 */
export interface FreezeKeyframe {
  time: number;
  freeze: boolean;
}

/**
 * Keyframe of an overlay track. The state it describes applies from `time`
 * until the next keyframe of the same track (or the end of the render).
 */
export interface OverlayKeyframe {
  time: number;
  /** Size relative to the overlay source, in (0, 1]. Required unless `fullscreen` or hidden. */
  scale?: number;
  /** Stretch the overlay to the base resolution. Takes precedence over scale and position. */
  fullscreen?: boolean;
  /** Pin the overlay to a point of the base frame. Takes precedence over `x` / `y`. */
  anchor?: Anchor;
  /** Distance in pixels from the anchored edges. Default 0. */
  padding?: number;
  /** Left edge in pixels, or an FFmpeg overlay expression. Default 0. */
  x?: number | string;
  /** Top edge in pixels, or an FFmpeg overlay expression. Default 0. */
  y?: number | string;
  /** 0 (transparent) to 1 (opaque). Default 1. */
  opacity?: number;
  /** `false` hides the overlay until the next keyframe. Default true. */
  visible?: boolean;
}

export interface BaseTrack {
  type: 'video';
  /** Path to the media file, relative to the project file. */
  source: string;
  transform?: FreezeKeyframe[];
}

export interface OverlayTrack {
  type: 'video';
  /** Path to the media file, relative to the project file. */
  source: string;
  transform: OverlayKeyframe[];
}

/** `tracks[0]` is the base video; every following track is drawn on top of it, in order. */
export interface Project {
  tracks: [BaseTrack, ...OverlayTrack[]];
}

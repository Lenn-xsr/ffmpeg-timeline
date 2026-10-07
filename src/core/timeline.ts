import { ValidationError } from './errors.js';
import type { Anchor, FreezeKeyframe, OverlayKeyframe, Project } from './schema.js';

/**
 * A hold of the base video.
 *
 * Keyframes live on the output timeline, but FFmpeg has to cut the base
 * video on the base video's own timeline. The two clocks drift apart by the
 * time every earlier freeze inserted, which is what `sourceTime` accounts for.
 */
export interface Freeze {
  /** Output time at which the hold begins. */
  outputStart: number;
  /** Length of the hold in seconds. */
  duration: number;
  /** Position in the base video that is held: `outputStart` minus all earlier holds. */
  sourceTime: number;
}

/** Where and how large an overlay is drawn. */
export type Placement =
  | { kind: 'fullscreen' }
  | { kind: 'anchor'; scale: number; anchor: Anchor; padding: number }
  | { kind: 'absolute'; scale: number; x: number | string; y: number | string };

/** A time window during which one overlay is drawn with a fixed placement. */
export interface OverlaySegment {
  /** Index of the FFmpeg input that provides the overlay video. */
  input: number;
  /** Output time at which the segment becomes visible (inclusive). */
  start: number;
  /** Output time at which it stops being visible (exclusive); `null` means until the end. */
  end: number | null;
  placement: Placement;
  opacity: number;
}

/** Normalized form of a project: everything the filter graph builder needs, nothing else. */
export interface Timeline {
  freezes: Freeze[];
  overlays: OverlaySegment[];
}

/**
 * Converts a validated project into a timeline.
 *
 * `baseDuration` is the only fact about the media this stage needs: a freeze
 * can only hold a frame that exists in the base video.
 */
export function buildTimeline(project: Project, baseDuration: number): Timeline {
  const [base, ...overlayTracks] = project.tracks;
  const freezes = parseFreezes(base.transform ?? []);

  for (const freeze of freezes) {
    if (freeze.sourceTime >= baseDuration) {
      throw new ValidationError([
        `tracks[0].transform: the freeze at t=${freeze.outputStart} would hold base position ` +
          `${freeze.sourceTime}s, but the base video is only ${baseDuration}s long`,
      ]);
    }
  }

  const overlays = overlayTracks.flatMap((track, index) =>
    parseOverlaySegments(track.transform, index + 1),
  );

  return { freezes, overlays };
}

/**
 * Turns `freeze: true` / `freeze: false` keyframe pairs into holds and maps
 * each one from the output timeline onto the base video's own timeline.
 */
export function parseFreezes(keyframes: readonly FreezeKeyframe[]): Freeze[] {
  const freezes: Freeze[] = [];
  let heldSoFar = 0;
  let startedAt: number | null = null;

  for (const keyframe of keyframes) {
    if (keyframe.freeze && startedAt === null) {
      startedAt = keyframe.time;
    } else if (!keyframe.freeze && startedAt !== null) {
      const duration = roundTime(keyframe.time - startedAt);
      freezes.push({
        outputStart: startedAt,
        duration,
        sourceTime: roundTime(startedAt - heldSoFar),
      });
      heldSoFar += duration;
      startedAt = null;
    }
  }

  return freezes;
}

/**
 * Turns the keyframes of one overlay track into visible segments. Each
 * keyframe applies until the next one; hidden keyframes produce no segment,
 * and nothing is drawn before the first keyframe.
 */
export function parseOverlaySegments(
  keyframes: readonly OverlayKeyframe[],
  input: number,
): OverlaySegment[] {
  const segments: OverlaySegment[] = [];

  for (const [index, keyframe] of keyframes.entries()) {
    if (keyframe.visible === false) {
      continue;
    }

    segments.push({
      input,
      start: keyframe.time,
      end: keyframes[index + 1]?.time ?? null,
      placement: toPlacement(keyframe),
      opacity: keyframe.opacity ?? 1,
    });
  }

  return segments;
}

function toPlacement(keyframe: OverlayKeyframe): Placement {
  if (keyframe.fullscreen) {
    return { kind: 'fullscreen' };
  }

  const scale = keyframe.scale ?? 1;

  if (keyframe.anchor !== undefined) {
    return { kind: 'anchor', scale, anchor: keyframe.anchor, padding: keyframe.padding ?? 0 };
  }

  return { kind: 'absolute', scale, x: keyframe.x ?? 0, y: keyframe.y ?? 0 };
}

/** Rounds to microseconds so sums of decimal fractions do not leak float noise into the graph. */
function roundTime(seconds: number): number {
  return Math.round(seconds * 1e6) / 1e6;
}

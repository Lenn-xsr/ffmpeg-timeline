import { ValidationError } from './errors.js';
import { ANCHORS, type Project } from './schema.js';

type Issues = string[];
type JsonObject = Record<string, unknown>;

const PROJECT_FIELDS = ['tracks'];
const TRACK_FIELDS = ['type', 'source', 'transform'];
const FREEZE_FIELDS = ['time', 'freeze'];
const OVERLAY_FIELDS = [
  'time',
  'scale',
  'fullscreen',
  'anchor',
  'padding',
  'x',
  'y',
  'opacity',
  'visible',
];

/**
 * Characters allowed in an `x` / `y` expression: identifiers, numbers,
 * arithmetic and function calls. Everything that has a meaning in filter
 * graph syntax (quotes, `;`, `[`, `]`, `:`, `=`, `\`) is rejected, so an
 * expression can never alter the structure of the generated graph.
 */
const EXPRESSION = /^[\w\s+\-*/().,]+$/;

/**
 * Checks untrusted JSON against the project schema.
 *
 * Pure: it never touches the filesystem, so whether the referenced media
 * exists is checked by the loader. All problems are collected and reported
 * together in a single `ValidationError`.
 */
export function validateProject(input: unknown): Project {
  const issues: Issues = [];

  if (!isObject(input)) {
    throw new ValidationError([`project: must be a JSON object, ${got(input)}`]);
  }

  rejectUnknownFields(input, PROJECT_FIELDS, 'project', issues);

  const tracks = input.tracks;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    issues.push(
      `tracks: must be a non-empty array (tracks[0] is the base video, the rest are overlays), ${got(tracks)}`,
    );
  } else {
    tracks.forEach((track, index) => checkTrack(track, index, issues));
  }

  if (issues.length > 0) {
    throw new ValidationError(issues);
  }

  // Every field has been checked above and unknown fields are rejected, so
  // the value has exactly the shape of `Project`.
  return input as unknown as Project;
}

function checkTrack(track: unknown, index: number, issues: Issues): void {
  const path = `tracks[${index}]`;

  if (!isObject(track)) {
    issues.push(`${path}: must be an object, ${got(track)}`);
    return;
  }

  rejectUnknownFields(track, TRACK_FIELDS, path, issues);

  if (track.type !== 'video') {
    issues.push(`${path}.type: must be "video", ${got(track.type)}`);
  }

  if (typeof track.source !== 'string' || track.source.trim() === '') {
    issues.push(`${path}.source: must be a non-empty path to a media file, ${got(track.source)}`);
  }

  if (index === 0) {
    checkFreezeKeyframes(track.transform, `${path}.transform`, issues);
  } else {
    checkOverlayKeyframes(track.transform, `${path}.transform`, issues);
  }
}

/** Base track: optional list of alternating `freeze: true` / `freeze: false` keyframes. */
function checkFreezeKeyframes(transform: unknown, path: string, issues: Issues): void {
  if (transform === undefined) {
    return;
  }

  if (!Array.isArray(transform)) {
    issues.push(`${path}: must be an array of keyframes, ${got(transform)}`);
    return;
  }

  let previousTime: number | null = null;
  let frozen = false;
  let frozenSince: number | null = null;

  for (const [index, keyframe] of transform.entries()) {
    const keyframePath = `${path}[${index}]`;

    if (!isObject(keyframe)) {
      issues.push(`${keyframePath}: must be an object, ${got(keyframe)}`);
      continue;
    }

    rejectUnknownFields(keyframe, FREEZE_FIELDS, keyframePath, issues);
    previousTime = checkTime(keyframe, keyframePath, previousTime, issues);

    if (typeof keyframe.freeze !== 'boolean') {
      issues.push(`${keyframePath}.freeze: must be true or false, ${got(keyframe.freeze)}`);
      continue;
    }

    if (keyframe.freeze && frozen) {
      issues.push(
        `${keyframePath}.freeze: the base is already frozen since t=${frozenSince}; expected false`,
      );
    } else if (!keyframe.freeze && !frozen) {
      issues.push(`${keyframePath}.freeze: there is no active freeze to release; expected true`);
    }

    if (keyframe.freeze && !frozen) {
      frozenSince = previousTime;
    }
    frozen = keyframe.freeze;
  }

  if (frozen) {
    issues.push(
      `${path}: the freeze started at t=${frozenSince} is never released; add a keyframe with "freeze": false`,
    );
  }
}

/** Overlay track: at least one keyframe describing size, position and visibility. */
function checkOverlayKeyframes(transform: unknown, path: string, issues: Issues): void {
  if (!Array.isArray(transform) || transform.length === 0) {
    issues.push(
      `${path}: must be a non-empty array of keyframes (an overlay without keyframes is never shown), ${got(transform)}`,
    );
    return;
  }

  let previousTime: number | null = null;

  for (const [index, keyframe] of transform.entries()) {
    const keyframePath = `${path}[${index}]`;

    if (!isObject(keyframe)) {
      issues.push(`${keyframePath}: must be an object, ${got(keyframe)}`);
      continue;
    }

    rejectUnknownFields(keyframe, OVERLAY_FIELDS, keyframePath, issues);
    previousTime = checkTime(keyframe, keyframePath, previousTime, issues);

    checkOptionalBoolean(keyframe, 'fullscreen', keyframePath, issues);
    checkOptionalBoolean(keyframe, 'visible', keyframePath, issues);

    const sizeIsImplied = keyframe.fullscreen === true || keyframe.visible === false;
    if (keyframe.scale !== undefined || !sizeIsImplied) {
      const { scale } = keyframe;
      if (typeof scale !== 'number' || !(scale > 0 && scale <= 1)) {
        issues.push(
          `${keyframePath}.scale: must be a number in (0, 1] unless "fullscreen" is true or "visible" is false, ${got(scale)}`,
        );
      }
    }

    const { opacity, padding, anchor } = keyframe;

    if (opacity !== undefined && !(typeof opacity === 'number' && opacity >= 0 && opacity <= 1)) {
      issues.push(`${keyframePath}.opacity: must be a number between 0 and 1, ${got(opacity)}`);
    }

    if (
      padding !== undefined &&
      !(typeof padding === 'number' && Number.isFinite(padding) && padding >= 0)
    ) {
      issues.push(`${keyframePath}.padding: must be a non-negative number, ${got(padding)}`);
    }

    if (anchor !== undefined && !(ANCHORS as readonly unknown[]).includes(anchor)) {
      issues.push(`${keyframePath}.anchor: must be one of ${ANCHORS.join(', ')}, ${got(anchor)}`);
    }

    checkOptionalCoordinate(keyframe, 'x', keyframePath, issues);
    checkOptionalCoordinate(keyframe, 'y', keyframePath, issues);
  }
}

/** Validates `time` and its ordering; returns the time to compare the next keyframe against. */
function checkTime(
  keyframe: JsonObject,
  path: string,
  previousTime: number | null,
  issues: Issues,
): number | null {
  const { time } = keyframe;

  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) {
    issues.push(`${path}.time: must be a non-negative number of seconds, ${got(time)}`);
    return previousTime;
  }

  if (previousTime !== null && time <= previousTime) {
    issues.push(
      `${path}.time: must be greater than the previous keyframe (${previousTime}), got ${time}`,
    );
  }

  return time;
}

function checkOptionalBoolean(object: JsonObject, field: string, path: string, issues: Issues) {
  const value = object[field];
  if (value !== undefined && typeof value !== 'boolean') {
    issues.push(`${path}.${field}: must be true or false, ${got(value)}`);
  }
}

function checkOptionalCoordinate(object: JsonObject, field: string, path: string, issues: Issues) {
  const value = object[field];
  if (value === undefined) {
    return;
  }

  const isNumber = typeof value === 'number' && Number.isFinite(value);
  const isExpression = typeof value === 'string' && EXPRESSION.test(value) && value.trim() !== '';
  if (!isNumber && !isExpression) {
    issues.push(
      `${path}.${field}: must be a number of pixels or an FFmpeg expression ` +
        `(letters, digits, whitespace and + - * / ( ) . , only), ${got(value)}`,
    );
  }
}

function rejectUnknownFields(
  object: JsonObject,
  allowed: readonly string[],
  path: string,
  issues: Issues,
): void {
  for (const field of Object.keys(object)) {
    if (!allowed.includes(field)) {
      issues.push(`${path}.${field}: unknown field (allowed: ${allowed.join(', ')})`);
    }
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Describes the offending value for an error message. */
function got(value: unknown): string {
  return value === undefined ? 'but it is missing' : `got ${JSON.stringify(value)}`;
}

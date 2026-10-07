import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/core/errors.js';
import { validateProject } from '../src/core/validation.js';

const base = { type: 'video', source: 'base.mp4' };
const overlay = { type: 'video', source: 'overlay.mp4', transform: [{ time: 0, scale: 0.5 }] };

/** Builds a project whose only overlay track has the given keyframes. */
function withOverlayKeyframes(...transform: unknown[]): unknown {
  return { tracks: [base, { ...overlay, transform }] };
}

/** Builds a project whose base track has the given keyframes. */
function withBaseKeyframes(...transform: unknown[]): unknown {
  return { tracks: [{ ...base, transform }, overlay] };
}

function issuesOf(input: unknown): readonly string[] {
  try {
    validateProject(input);
  } catch (error) {
    if (error instanceof ValidationError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error('Expected the project to be rejected');
}

describe('validateProject: accepted projects', () => {
  it('accepts a base track on its own', () => {
    expect(validateProject({ tracks: [base] })).toEqual({ tracks: [base] });
  });

  it('accepts a base track with freezes and several overlay tracks', () => {
    const project = {
      tracks: [
        {
          ...base,
          transform: [
            { time: 1, freeze: true },
            { time: 2.5, freeze: false },
            { time: 6, freeze: true },
            { time: 7, freeze: false },
          ],
        },
        {
          type: 'video',
          source: 'a.mp4',
          transform: [
            { time: 0, scale: 0.3, anchor: 'bottom-right', padding: 30 },
            { time: 1, fullscreen: true },
            { time: 2.5, scale: 1, x: 10, y: 'H-h-10', opacity: 0.5 },
            { time: 8, visible: false },
          ],
        },
        overlay,
      ],
    };

    expect(validateProject(project)).toBe(project);
  });

  it('does not require a scale for fullscreen or hidden keyframes', () => {
    expect(() =>
      validateProject(
        withOverlayKeyframes({ time: 0, fullscreen: true }, { time: 1, visible: false }),
      ),
    ).not.toThrow();
  });

  it('accepts an empty transform on the base track', () => {
    expect(() => validateProject(withBaseKeyframes())).not.toThrow();
  });
});

describe('validateProject: structure', () => {
  it.each([null, 42, 'project', []])('rejects a project that is not an object: %j', (input) => {
    expect(issuesOf(input)).toEqual([expect.stringMatching(/^project: must be a JSON object/)]);
  });

  it('rejects a missing or empty tracks array', () => {
    expect(issuesOf({})).toEqual([expect.stringMatching(/^tracks: must be a non-empty array/)]);
    expect(issuesOf({ tracks: [] })).toEqual([
      expect.stringMatching(/^tracks: must be a non-empty array/),
    ]);
  });

  it('rejects unknown fields at every level', () => {
    const issues = issuesOf({
      effects: [],
      tracks: [
        { ...base, volume: 1 },
        { ...overlay, transform: [{ time: 0, scale: 0.5, rotate: 90 }] },
      ],
    });

    expect(issues).toEqual([
      'project.effects: unknown field (allowed: tracks)',
      'tracks[0].volume: unknown field (allowed: type, source, transform)',
      expect.stringMatching(/^tracks\[1\]\.transform\[0\]\.rotate: unknown field/),
    ]);
  });

  it('rejects tracks with a missing or unsupported type and source', () => {
    const issues = issuesOf({ tracks: [{ type: 'audio' }, 'overlay.mp4'] });

    expect(issues).toEqual([
      'tracks[0].type: must be "video", got "audio"',
      'tracks[0].source: must be a non-empty path to a media file, but it is missing',
      'tracks[1]: must be an object, got "overlay.mp4"',
    ]);
  });

  it('reports every problem at once', () => {
    const issues = issuesOf({
      tracks: [
        { type: 'video', source: '' },
        { type: 'video', source: 'overlay.mp4', transform: [{ time: -1, scale: 2 }] },
      ],
    });

    expect(issues).toHaveLength(3);
  });
});

describe('validateProject: base track keyframes', () => {
  it('rejects a transform that is not an array', () => {
    expect(issuesOf({ tracks: [{ ...base, transform: {} }] })).toEqual([
      'tracks[0].transform: must be an array of keyframes, got {}',
    ]);
  });

  it('rejects a keyframe without a boolean freeze flag', () => {
    expect(issuesOf(withBaseKeyframes({ time: 1 }))).toEqual([
      'tracks[0].transform[0].freeze: must be true or false, but it is missing',
    ]);
  });

  it('rejects overlay fields on the base track', () => {
    expect(issuesOf(withBaseKeyframes({ time: 1, scale: 0.5 }))).toContain(
      'tracks[0].transform[0].scale: unknown field (allowed: time, freeze)',
    );
  });

  it('rejects a freeze that is never released', () => {
    expect(issuesOf(withBaseKeyframes({ time: 5, freeze: true }))).toEqual([
      'tracks[0].transform: the freeze started at t=5 is never released; add a keyframe with "freeze": false',
    ]);
  });

  it('rejects a release without a preceding freeze', () => {
    expect(issuesOf(withBaseKeyframes({ time: 5, freeze: false }))).toEqual([
      'tracks[0].transform[0].freeze: there is no active freeze to release; expected true',
    ]);
  });

  it('rejects a freeze that starts while another one is active', () => {
    const issues = issuesOf(
      withBaseKeyframes(
        { time: 1, freeze: true },
        { time: 2, freeze: true },
        { time: 3, freeze: false },
      ),
    );

    expect(issues).toEqual([
      'tracks[0].transform[1].freeze: the base is already frozen since t=1; expected false',
    ]);
  });

  it('rejects keyframes that are not in strictly increasing order', () => {
    const issues = issuesOf(
      withBaseKeyframes({ time: 5, freeze: true }, { time: 5, freeze: false }),
    );

    expect(issues).toEqual([
      'tracks[0].transform[1].time: must be greater than the previous keyframe (5), got 5',
    ]);
  });
});

describe('validateProject: overlay track keyframes', () => {
  it('requires at least one keyframe', () => {
    expect(issuesOf({ tracks: [base, { type: 'video', source: 'overlay.mp4' }] })).toEqual([
      expect.stringMatching(/^tracks\[1\]\.transform: must be a non-empty array of keyframes/),
    ]);
    expect(issuesOf(withOverlayKeyframes())).toHaveLength(1);
  });

  it.each([undefined, -1, '3', null])('rejects an invalid time: %j', (time) => {
    expect(issuesOf(withOverlayKeyframes({ time, scale: 0.5 }))).toEqual([
      expect.stringMatching(/^tracks\[1\]\.transform\[0\]\.time: must be a non-negative number/),
    ]);
  });

  it('rejects keyframes that go back in time', () => {
    const issues = issuesOf(withOverlayKeyframes({ time: 4, scale: 0.5 }, { time: 2, scale: 0.5 }));

    expect(issues).toEqual([
      'tracks[1].transform[1].time: must be greater than the previous keyframe (4), got 2',
    ]);
  });

  it.each([undefined, 0, 1.5, -0.2, '0.5'])('rejects an invalid scale: %j', (scale) => {
    expect(issuesOf(withOverlayKeyframes({ time: 0, scale }))).toEqual([
      expect.stringMatching(/^tracks\[1\]\.transform\[0\]\.scale: must be a number in \(0, 1\]/),
    ]);
  });

  it('still checks a scale that is given alongside fullscreen', () => {
    expect(issuesOf(withOverlayKeyframes({ time: 0, fullscreen: true, scale: 3 }))).toHaveLength(1);
  });

  it.each([
    ['opacity', 1.2, /opacity: must be a number between 0 and 1, got 1.2$/],
    ['padding', -5, /padding: must be a non-negative number, got -5$/],
    ['anchor', 'middle', /anchor: must be one of top-left, .*, got "middle"$/],
    ['fullscreen', 'yes', /fullscreen: must be true or false, got "yes"$/],
    ['visible', 0, /visible: must be true or false, got 0$/],
    ['x', true, /x: must be a number of pixels or an FFmpeg expression/],
    ['y', '', /y: must be a number of pixels or an FFmpeg expression/],
  ])('rejects an invalid %s', (field, value, message) => {
    const issues = issuesOf(withOverlayKeyframes({ time: 0, scale: 0.5, [field]: value }));

    expect(issues).toEqual([expect.stringMatching(message)]);
  });

  it.each(["0'[1:v]", '10;[0:v]null[vout]', 'x=5', '10:20', '[v0]'])(
    'rejects an expression that could change the structure of the graph: %s',
    (x) => {
      expect(issuesOf(withOverlayKeyframes({ time: 0, scale: 0.5, x }))).toHaveLength(1);
    },
  );

  it('accepts arithmetic and function calls in expressions', () => {
    const keyframe = { time: 0, scale: 0.5, x: '(W-w)/2', y: 'if(gte(t,2), 10, H-h-10)' };

    expect(() => validateProject(withOverlayKeyframes(keyframe))).not.toThrow();
  });
});

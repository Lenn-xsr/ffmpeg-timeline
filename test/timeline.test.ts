import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/core/errors.js';
import type { Project } from '../src/core/schema.js';
import { buildTimeline, parseFreezes, parseOverlaySegments } from '../src/core/timeline.js';

describe('parseFreezes', () => {
  it('returns no freezes for a base track without keyframes', () => {
    expect(parseFreezes([])).toEqual([]);
  });

  it('turns a freeze/release pair into a hold', () => {
    const freezes = parseFreezes([
      { time: 5, freeze: true },
      { time: 8, freeze: false },
    ]);

    expect(freezes).toEqual([{ outputStart: 5, duration: 3, sourceTime: 5 }]);
  });

  it('shifts later freezes back by the time earlier freezes inserted', () => {
    const freezes = parseFreezes([
      { time: 2, freeze: true },
      { time: 5, freeze: false },
      { time: 9, freeze: true },
      { time: 10.5, freeze: false },
      { time: 12, freeze: true },
      { time: 13, freeze: false },
    ]);

    // Output 9s is base position 6s: three of those nine seconds were a hold.
    expect(freezes).toEqual([
      { outputStart: 2, duration: 3, sourceTime: 2 },
      { outputStart: 9, duration: 1.5, sourceTime: 6 },
      { outputStart: 12, duration: 1, sourceTime: 7.5 },
    ]);
  });

  it('keeps float noise out of the computed times', () => {
    const [first, second] = parseFreezes([
      { time: 0.1, freeze: true },
      { time: 0.3, freeze: false },
      { time: 0.7, freeze: true },
      { time: 0.8, freeze: false },
    ]);

    expect(first).toEqual({ outputStart: 0.1, duration: 0.2, sourceTime: 0.1 });
    expect(second).toEqual({ outputStart: 0.7, duration: 0.1, sourceTime: 0.5 });
  });
});

describe('parseOverlaySegments', () => {
  it('makes each keyframe last until the next one and leaves the last one open-ended', () => {
    const segments = parseOverlaySegments(
      [
        { time: 0, scale: 0.3, anchor: 'bottom-right', padding: 30 },
        { time: 5, fullscreen: true },
        { time: 8, scale: 0.5, x: 20, y: 'H-h-20', opacity: 0.6 },
      ],
      1,
    );

    expect(segments).toEqual([
      {
        input: 1,
        start: 0,
        end: 5,
        placement: { kind: 'anchor', scale: 0.3, anchor: 'bottom-right', padding: 30 },
        opacity: 1,
      },
      { input: 1, start: 5, end: 8, placement: { kind: 'fullscreen' }, opacity: 1 },
      {
        input: 1,
        start: 8,
        end: null,
        placement: { kind: 'absolute', scale: 0.5, x: 20, y: 'H-h-20' },
        opacity: 0.6,
      },
    ]);
  });

  it('applies defaults: position (0, 0), no padding, fully opaque', () => {
    expect(parseOverlaySegments([{ time: 0, scale: 0.4 }], 1)[0]?.placement).toEqual({
      kind: 'absolute',
      scale: 0.4,
      x: 0,
      y: 0,
    });
    expect(
      parseOverlaySegments([{ time: 0, scale: 0.4, anchor: 'center' }], 1)[0]?.placement,
    ).toEqual({ kind: 'anchor', scale: 0.4, anchor: 'center', padding: 0 });
  });

  it('gives fullscreen precedence over anchor, and anchor precedence over x / y', () => {
    const [fullscreen, anchored] = parseOverlaySegments(
      [
        { time: 0, fullscreen: true, scale: 0.3, anchor: 'center', x: 5 },
        { time: 1, scale: 0.3, anchor: 'top-left', x: 5, y: 5 },
      ],
      1,
    );

    expect(fullscreen?.placement).toEqual({ kind: 'fullscreen' });
    expect(anchored?.placement).toEqual({
      kind: 'anchor',
      scale: 0.3,
      anchor: 'top-left',
      padding: 0,
    });
  });

  it('drops hidden keyframes but lets them end the previous segment', () => {
    const segments = parseOverlaySegments(
      [
        { time: 1, scale: 0.3 },
        { time: 4, visible: false },
        { time: 6, scale: 0.3 },
        { time: 9, visible: false },
      ],
      2,
    );

    expect(segments.map(({ input, start, end }) => ({ input, start, end }))).toEqual([
      { input: 2, start: 1, end: 4 },
      { input: 2, start: 6, end: 9 },
    ]);
  });
});

describe('buildTimeline', () => {
  const project: Project = {
    tracks: [
      {
        type: 'video',
        source: 'base.mp4',
        transform: [
          { time: 5, freeze: true },
          { time: 8, freeze: false },
        ],
      },
      { type: 'video', source: 'a.mp4', transform: [{ time: 0, scale: 0.3 }] },
      {
        type: 'video',
        source: 'b.mp4',
        transform: [
          { time: 5, fullscreen: true },
          { time: 8, visible: false },
        ],
      },
    ],
  };

  it('maps overlay tracks to FFmpeg inputs in track order', () => {
    const timeline = buildTimeline(project, 12);

    expect(timeline.overlays.map(({ input, start, end }) => ({ input, start, end }))).toEqual([
      { input: 1, start: 0, end: null },
      { input: 2, start: 5, end: 8 },
    ]);
  });

  it('keeps overlay times on the output timeline regardless of freezes', () => {
    const timeline = buildTimeline(project, 12);

    expect(timeline.freezes).toEqual([{ outputStart: 5, duration: 3, sourceTime: 5 }]);
    expect(timeline.overlays[1]).toMatchObject({ start: 5, end: 8 });
  });

  it('handles a base track without keyframes and a project without overlays', () => {
    const baseOnly: Project = { tracks: [{ type: 'video', source: 'base.mp4' }] };

    expect(buildTimeline(baseOnly, 12)).toEqual({ freezes: [], overlays: [] });
  });

  it('rejects a freeze that would hold a frame past the end of the base video', () => {
    expect(() => buildTimeline(project, 5)).toThrow(ValidationError);
    expect(() => buildTimeline(project, 4)).toThrow(
      'tracks[0].transform: the freeze at t=5 would hold base position 5s, but the base video is only 4s long',
    );
  });

  it('compares the base position, not the output time, with the base duration', () => {
    const twoFreezes: Project = {
      tracks: [
        {
          type: 'video',
          source: 'base.mp4',
          transform: [
            { time: 1, freeze: true },
            { time: 11, freeze: false },
            { time: 13, freeze: true },
            { time: 14, freeze: false },
          ],
        },
      ],
    };

    // The second freeze starts at output 13s, which is only base position 3s.
    expect(buildTimeline(twoFreezes, 4).freezes[1]?.sourceTime).toBe(3);
  });
});

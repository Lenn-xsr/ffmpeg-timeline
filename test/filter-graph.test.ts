import { describe, expect, it } from 'vitest';
import { buildFilterGraph, type BaseVideo } from '../src/core/filter-graph.js';
import type { Freeze, OverlaySegment, Placement } from '../src/core/timeline.js';

const base: BaseVideo = { width: 1080, height: 1920, hasAudio: false };
const baseWithAudio: BaseVideo = { ...base, hasAudio: true };

const corner: Placement = { kind: 'anchor', scale: 0.3, anchor: 'bottom-right', padding: 30 };

function segment(overrides: Partial<OverlaySegment> = {}): OverlaySegment {
  return { input: 1, start: 0, end: null, placement: corner, opacity: 1, ...overrides };
}

function freeze(outputStart: number, duration: number, sourceTime: number): Freeze {
  return { outputStart, duration, sourceTime };
}

describe('buildFilterGraph: overlays', () => {
  it('passes the base through when there is nothing to compose', () => {
    const graph = buildFilterGraph({ freezes: [], overlays: [] }, base);

    expect(graph).toEqual({
      chains: ['[0:v]null[vout]'],
      filterComplex: '[0:v]null[vout]',
      videoLabel: '[vout]',
      audioLabel: null,
    });
  });

  it('scales a single overlay and composites it onto the base', () => {
    const graph = buildFilterGraph({ freezes: [], overlays: [segment()] }, base);

    expect(graph.filterComplex).toBe(
      '[1:v]scale=iw*0.3:ih*0.3[ov0];' +
        "[0:v][ov0]overlay=x=W-w-30:y=H-h-30:format=auto:enable='gte(t,0)'[vout]",
    );
  });

  it('chains several segments, each one drawn on the result of the previous one', () => {
    const overlays = [
      segment({ start: 0, end: 4 }),
      segment({ start: 4, end: 9, placement: { kind: 'absolute', scale: 0.5, x: 100, y: 200 } }),
      segment({ start: 12, end: null, placement: { ...corner, anchor: 'top-left' } }),
    ];

    const graph = buildFilterGraph({ freezes: [], overlays }, base);

    expect(graph.chains).toEqual([
      '[1:v]scale=iw*0.3:ih*0.3[ov0]',
      "[0:v][ov0]overlay=x=W-w-30:y=H-h-30:format=auto:enable='gte(t,0)*lt(t,4)'[v0]",
      '[1:v]scale=iw*0.5:ih*0.5[ov1]',
      "[v0][ov1]overlay=x=100:y=200:format=auto:enable='gte(t,4)*lt(t,9)'[v1]",
      '[1:v]scale=iw*0.3:ih*0.3[ov2]',
      "[v1][ov2]overlay=x=30:y=30:format=auto:enable='gte(t,12)'[vout]",
    ]);
    expect(graph.filterComplex).toBe(graph.chains.join(';'));
  });

  it('reads every overlay track from its own FFmpeg input', () => {
    const overlays = [
      segment({ input: 1 }),
      segment({ input: 2, start: 3, end: 6, placement: { kind: 'fullscreen' } }),
    ];

    const graph = buildFilterGraph({ freezes: [], overlays }, base);

    expect(graph.chains).toEqual([
      '[1:v]scale=iw*0.3:ih*0.3[ov0]',
      "[0:v][ov0]overlay=x=W-w-30:y=H-h-30:format=auto:enable='gte(t,0)'[v0]",
      '[2:v]scale=1080:1920[ov1]',
      "[v0][ov1]overlay=x=0:y=0:format=auto:enable='gte(t,3)*lt(t,6)'[vout]",
    ]);
  });

  it('switches to and from fullscreen by stretching to the base resolution', () => {
    const overlays = [
      segment({ start: 0, end: 5 }),
      segment({ start: 5, end: 10, placement: { kind: 'fullscreen' } }),
      segment({ start: 10, end: null }),
    ];

    const graph = buildFilterGraph(
      { freezes: [], overlays },
      { ...base, width: 720, height: 1280 },
    );

    expect(graph.chains).toEqual([
      '[1:v]scale=iw*0.3:ih*0.3[ov0]',
      "[0:v][ov0]overlay=x=W-w-30:y=H-h-30:format=auto:enable='gte(t,0)*lt(t,5)'[v0]",
      '[1:v]scale=720:1280[ov1]',
      "[v0][ov1]overlay=x=0:y=0:format=auto:enable='gte(t,5)*lt(t,10)'[v1]",
      '[1:v]scale=iw*0.3:ih*0.3[ov2]',
      "[v1][ov2]overlay=x=W-w-30:y=H-h-30:format=auto:enable='gte(t,10)'[vout]",
    ]);
  });

  it('adds an alpha channel before fading an overlay', () => {
    const graph = buildFilterGraph({ freezes: [], overlays: [segment({ opacity: 0.4 })] }, base);

    expect(graph.chains[0]).toBe(
      '[1:v]scale=iw*0.3:ih*0.3,format=rgba,colorchannelmixer=aa=0.4[ov0]',
    );
  });

  it('quotes position expressions so their commas do not split the chain', () => {
    const placement: Placement = {
      kind: 'absolute',
      scale: 0.5,
      x: 'if(gte(t,2),10,W-w-10)',
      y: 40,
    };

    const graph = buildFilterGraph({ freezes: [], overlays: [segment({ placement })] }, base);

    expect(graph.chains[1]).toBe(
      "[0:v][ov0]overlay=x='if(gte(t,2),10,W-w-10)':y=40:format=auto:enable='gte(t,0)'[vout]",
    );
  });

  it.each([
    ['top-left', 'x=12:y=12'],
    ['top-center', 'x=(W-w)/2:y=12'],
    ['top-right', 'x=W-w-12:y=12'],
    ['center-left', 'x=12:y=(H-h)/2'],
    ['center', 'x=(W-w)/2:y=(H-h)/2'],
    ['center-right', 'x=W-w-12:y=(H-h)/2'],
    ['bottom-left', 'x=12:y=H-h-12'],
    ['bottom-center', 'x=(W-w)/2:y=H-h-12'],
    ['bottom-right', 'x=W-w-12:y=H-h-12'],
  ] as const)('positions the %s anchor', (anchor, expected) => {
    const placement: Placement = { kind: 'anchor', scale: 0.3, anchor, padding: 12 };

    const graph = buildFilterGraph({ freezes: [], overlays: [segment({ placement })] }, base);

    expect(graph.chains[1]).toContain(`overlay=${expected}:format=auto`);
  });
});

describe('buildFilterGraph: freezes', () => {
  it('cuts the base at the hold position and repeats the first frame of the next piece', () => {
    const graph = buildFilterGraph({ freezes: [freeze(5, 3, 5)], overlays: [] }, base);

    expect(graph.chains).toEqual([
      '[0:v]trim=start=0:end=5,setpts=PTS-STARTPTS[base0]',
      '[0:v]trim=start=5,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=3[base1]',
      '[base0][base1]concat=n=2:v=1:a=0[base]',
      '[base]null[vout]',
    ]);
    expect(graph.audioLabel).toBeNull();
  });

  it('cuts at base positions, which trail the output time after the first freeze', () => {
    // Holds at output 2s-5s and 9s-10.5s: the second one is at base position 6s.
    const freezes = [freeze(2, 3, 2), freeze(9, 1.5, 6)];

    const graph = buildFilterGraph({ freezes, overlays: [] }, base);

    expect(graph.chains).toEqual([
      '[0:v]trim=start=0:end=2,setpts=PTS-STARTPTS[base0]',
      '[0:v]trim=start=2:end=6,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=3[base1]',
      '[0:v]trim=start=6,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=1.5[base2]',
      '[base0][base1][base2]concat=n=3:v=1:a=0[base]',
      '[base]null[vout]',
    ]);
  });

  it('does not emit an empty leading piece for a freeze at the very start', () => {
    const graph = buildFilterGraph({ freezes: [freeze(0, 2, 0)], overlays: [] }, base);

    expect(graph.chains).toEqual([
      '[0:v]trim=start=0,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=2[base0]',
      '[base0]concat=n=1:v=1:a=0[base]',
      '[base]null[vout]',
    ]);
  });

  it('inserts matching silence into the base audio', () => {
    const freezes = [freeze(2, 3, 2), freeze(9, 1.5, 6)];

    const graph = buildFilterGraph({ freezes, overlays: [] }, baseWithAudio);

    expect(graph.chains).toEqual([
      '[0:v]trim=start=0:end=2,setpts=PTS-STARTPTS[base0]',
      '[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS[aud0]',
      '[0:v]trim=start=2:end=6,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=3[base1]',
      '[0:a]atrim=start=2:end=6,asetpts=PTS-STARTPTS,adelay=delays=3000:all=1[aud1]',
      '[0:v]trim=start=6,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=1.5[base2]',
      '[0:a]atrim=start=6,asetpts=PTS-STARTPTS,adelay=delays=1500:all=1[aud2]',
      '[base0][aud0][base1][aud1][base2][aud2]concat=n=3:v=1:a=1[base][aout]',
      '[base]null[vout]',
    ]);
    expect(graph.audioLabel).toBe('[aout]');
  });

  it('leaves the audio alone when there is no freeze', () => {
    const graph = buildFilterGraph({ freezes: [], overlays: [segment()] }, baseWithAudio);

    expect(graph.audioLabel).toBeNull();
    expect(graph.filterComplex).not.toContain('[0:a]');
  });

  it('draws overlays on the reassembled base without shifting their time windows', () => {
    const overlays = [
      segment({ start: 0, end: 5 }),
      segment({ start: 5, end: 8, placement: { kind: 'fullscreen' } }),
      segment({ start: 8, end: null }),
    ];

    const graph = buildFilterGraph({ freezes: [freeze(5, 3, 5)], overlays }, base);

    expect(graph.chains).toEqual([
      '[0:v]trim=start=0:end=5,setpts=PTS-STARTPTS[base0]',
      '[0:v]trim=start=5,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=3[base1]',
      '[base0][base1]concat=n=2:v=1:a=0[base]',
      '[1:v]scale=iw*0.3:ih*0.3[ov0]',
      "[base][ov0]overlay=x=W-w-30:y=H-h-30:format=auto:enable='gte(t,0)*lt(t,5)'[v0]",
      '[1:v]scale=1080:1920[ov1]',
      "[v0][ov1]overlay=x=0:y=0:format=auto:enable='gte(t,5)*lt(t,8)'[v1]",
      '[1:v]scale=iw*0.3:ih*0.3[ov2]',
      "[v1][ov2]overlay=x=W-w-30:y=H-h-30:format=auto:enable='gte(t,8)'[vout]",
    ]);
  });

  it('formats fractional times without float noise', () => {
    const graph = buildFilterGraph(
      {
        freezes: [freeze(0.1 + 0.2, 1 / 3, 0.1 + 0.2)],
        overlays: [segment({ start: 0.1 + 0.2, end: 0.7 })],
      },
      base,
    );

    expect(graph.chains[0]).toBe('[0:v]trim=start=0:end=0.3,setpts=PTS-STARTPTS[base0]');
    expect(graph.chains[1]).toContain('tpad=start_mode=clone:start_duration=0.333333[base1]');
    expect(graph.chains[4]).toContain("enable='gte(t,0.3)*lt(t,0.7)'");
  });
});

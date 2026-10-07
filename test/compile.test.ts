import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileProject } from '../src/core/compile.js';
import { buildFfmpegArgs } from '../src/core/ffmpeg-args.js';
import { validateProject } from '../src/core/validation.js';

const base = { width: 1080, height: 1920, duration: 12, hasAudio: true };

/** The example project shipped in the repository root. */
const example = JSON.parse(readFileSync(new URL('../project.json', import.meta.url), 'utf8')) as {
  tracks: unknown[];
};

describe('compileProject', () => {
  it('compiles the example project from raw JSON to a filter graph without touching FFmpeg', () => {
    const { graph } = compileProject(validateProject(example), base);

    expect(graph.chains).toEqual([
      '[0:v]trim=start=0:end=5,setpts=PTS-STARTPTS[base0]',
      '[0:a]atrim=start=0:end=5,asetpts=PTS-STARTPTS[aud0]',
      '[0:v]trim=start=5,setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=3[base1]',
      '[0:a]atrim=start=5,asetpts=PTS-STARTPTS,adelay=delays=3000:all=1[aud1]',
      '[base0][aud0][base1][aud1]concat=n=2:v=1:a=1[base][aout]',
      '[1:v]scale=iw*0.3:ih*0.3[ov0]',
      "[base][ov0]overlay=x=W-w-30:y=H-h-30:format=auto:enable='gte(t,0)*lt(t,5)'[v0]",
      '[1:v]scale=1080:1920[ov1]',
      "[v0][ov1]overlay=x=0:y=0:format=auto:enable='gte(t,5)*lt(t,8)'[v1]",
      '[1:v]scale=iw*0.3:ih*0.3[ov2]',
      "[v1][ov2]overlay=x=30:y=30:format=auto:enable='gte(t,8)*lt(t,12)'[vout]",
    ]);
  });
});

describe('buildFfmpegArgs', () => {
  it('adds one input per track and maps the outputs of the graph', () => {
    const { graph } = compileProject(validateProject(example), base);

    const args = buildFfmpegArgs({
      inputs: ['/media/base.mp4', '/media/overlay.mp4'],
      graph,
      output: '/out/final.mp4',
    });

    expect(args).toEqual([
      '-hide_banner',
      '-y',
      '-i',
      '/media/base.mp4',
      '-i',
      '/media/overlay.mp4',
      '-filter_complex',
      graph.filterComplex,
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'medium',
      '-crf',
      '22',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      '/out/final.mp4',
    ]);
  });

  it('maps the base audio directly, and only if present, when the graph does not produce audio', () => {
    const { graph } = compileProject(validateProject({ tracks: [example.tracks[0]] }), {
      ...base,
      hasAudio: false,
    });

    const args = buildFfmpegArgs({ inputs: ['base.mp4'], graph, output: 'out.mp4' });

    expect(args.filter((_, index) => args[index - 1] === '-map')).toEqual(['[vout]', '0:a?']);
  });
});

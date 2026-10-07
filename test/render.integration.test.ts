import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeMedia } from '../src/io/probe.js';
import { render } from '../src/render.js';

/**
 * End-to-end tests against the real FFmpeg. The inputs are tiny solid-colour
 * clips generated on the fly, so a pixel sampled from the result tells
 * exactly which layer is visible at a given time and place.
 */

const WIDTH = 320;
const HEIGHT = 240;
const FPS = 25;
const SECONDS = 3;

const hasFfmpeg = ['ffmpeg', 'ffprobe'].every(
  (tool) => spawnSync(tool, ['-version'], { stdio: 'ignore' }).status === 0,
);

type Rgb = [red: number, green: number, blue: number];

function ffmpeg(args: string[]): Buffer {
  return execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
}

function createClip(file: string, color: string, size: string, withAudio: boolean): void {
  const video = ['-f', 'lavfi', '-i', `color=c=${color}:size=${size}:rate=${FPS}:d=${SECONDS}`];
  const audio = withAudio ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${SECONDS}`] : [];
  ffmpeg([
    ...video,
    ...audio,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'ultrafast',
    file,
  ]);
}

/** Colour of the rendered video at the given time and position. */
function pixelAt(file: string, seconds: number, x: number, y: number): Rgb {
  const filter = `crop=2:2:${x}:${y},scale=1:1`;
  const raw = ffmpeg([
    '-ss',
    String(seconds),
    '-i',
    file,
    '-frames:v',
    '1',
    '-vf',
    filter,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ]);
  return [raw[0] ?? -1, raw[1] ?? -1, raw[2] ?? -1];
}

/** Compares colours loosely: the clips went through lossy 4:2:0 encoding twice. */
function expectColor(actual: Rgb, expected: Rgb): void {
  actual.forEach((channel, index) => {
    expect(Math.abs(channel - (expected[index] ?? 0))).toBeLessThanOrEqual(40);
  });
}

const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];
const GREEN: Rgb = [0, 255, 0];

const CENTER = [WIDTH / 2, HEIGHT / 2] as const;

describe.skipIf(!hasFfmpeg)('render (requires ffmpeg and ffprobe on PATH)', () => {
  let dir: string;

  function writeProject(name: string, project: unknown): string {
    const file = path.join(dir, name);
    writeFileSync(file, JSON.stringify(project));
    return file;
  }

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ffmpeg-timeline-'));
    createClip(path.join(dir, 'base.mp4'), 'red', `${WIDTH}x${HEIGHT}`, true);
    createClip(path.join(dir, 'blue.mp4'), 'blue', '160x120', false);
    createClip(path.join(dir, 'green.mp4'), 'lime', '80x60', false);
  }, 60_000);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('renders a freeze with a fullscreen transition', async () => {
    const corner = { scale: 0.5, anchor: 'bottom-right', padding: 10 };
    const projectFile = writeProject('freeze.json', {
      tracks: [
        {
          type: 'video',
          source: 'base.mp4',
          transform: [
            { time: 1, freeze: true },
            { time: 2, freeze: false },
          ],
        },
        {
          type: 'video',
          source: 'blue.mp4',
          transform: [
            { time: 0, ...corner },
            { time: 1, fullscreen: true },
            { time: 2, ...corner },
          ],
        },
      ],
    });

    const { outputPath } = await render({ projectFile });

    // Default location: output/final.mp4 next to the project file.
    expect(outputPath).toBe(path.join(dir, 'output', 'final.mp4'));

    // The one-second freeze makes the result one second longer than the base.
    const info = await probeMedia(outputPath);
    expect(info.width).toBe(WIDTH);
    expect(info.height).toBe(HEIGHT);
    expect(info.duration).toBeCloseTo(SECONDS + 1, 1);
    expect(info.hasAudio).toBe(true);

    // The overlay is 80x60 in the corner, so its centre is at (270, 200).
    const inCorner = [270, 200] as const;

    expectColor(pixelAt(outputPath, 0.5, ...CENTER), RED);
    expectColor(pixelAt(outputPath, 0.5, ...inCorner), BLUE);

    // During the freeze the overlay covers the whole frame.
    expectColor(pixelAt(outputPath, 1.5, ...CENTER), BLUE);

    // Once the base resumes the overlay is back in the corner, until the end.
    expectColor(pixelAt(outputPath, 2.5, ...CENTER), RED);
    expectColor(pixelAt(outputPath, 2.5, ...inCorner), BLUE);
    expectColor(pixelAt(outputPath, 3.8, ...CENTER), RED);
  }, 60_000);

  it('renders a base track on its own, frozen from the first frame', async () => {
    const projectFile = writeProject('base-only.json', {
      tracks: [
        {
          type: 'video',
          source: 'base.mp4',
          transform: [
            { time: 0, freeze: true },
            { time: 1.5, freeze: false },
          ],
        },
      ],
    });
    const outputFile = path.join(dir, 'base-only.mp4');

    const { outputPath } = await render({ projectFile, outputFile });

    const info = await probeMedia(outputPath);
    expect(outputPath).toBe(outputFile);
    expect(info.duration).toBeCloseTo(SECONDS + 1.5, 1);
    expectColor(pixelAt(outputPath, 2, ...CENTER), RED);
  }, 60_000);

  it('stacks several overlay tracks, with opacity and position expressions', async () => {
    const projectFile = writeProject('stack.json', {
      tracks: [
        { type: 'video', source: 'base.mp4' },
        {
          type: 'video',
          source: 'blue.mp4',
          transform: [{ time: 0, fullscreen: true, opacity: 0.5 }],
        },
        {
          type: 'video',
          source: 'green.mp4',
          transform: [
            { time: 1, scale: 1, x: '(W-w)/2', y: 20 },
            { time: 2, visible: false },
          ],
        },
      ],
    });
    const outputFile = path.join(dir, 'stack.mp4');

    await render({ projectFile, outputFile });

    const info = await probeMedia(outputFile);
    expect(info.duration).toBeCloseTo(SECONDS, 1);

    // Half-transparent blue over red.
    expectColor(pixelAt(outputFile, 0.5, ...CENTER), [127, 0, 127]);

    // The green clip is 80x60, horizontally centred, 20 px from the top,
    // and only visible between 1s and 2s.
    const onGreen = [WIDTH / 2, 50] as const;
    expectColor(pixelAt(outputFile, 0.5, ...onGreen), [127, 0, 127]);
    expectColor(pixelAt(outputFile, 1.5, ...onGreen), GREEN);
    expectColor(pixelAt(outputFile, 2.5, ...onGreen), [127, 0, 127]);
  }, 60_000);

  it('fails with a readable error when a source file is missing', async () => {
    const projectFile = writeProject('missing.json', {
      tracks: [{ type: 'video', source: 'nowhere.mp4' }],
    });

    await expect(render({ projectFile })).rejects.toThrow(/tracks\[0\]\.source: file not found/);
  });
});

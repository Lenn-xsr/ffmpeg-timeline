// Generates the two synthetic clips used by the example project (project.json).
// Everything is produced by FFmpeg's built-in test sources, so the repository
// does not have to ship any video files.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const inputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'input');
const SECONDS = 12;
const FPS = 30;

const clips = [
  {
    // Portrait test pattern with a running timestamp and a beep every second,
    // which makes freezes easy to see and hear in the rendered result.
    file: 'base.mp4',
    sources: [
      `testsrc2=size=1080x1920:rate=${FPS}:duration=${SECONDS}`,
      `sine=frequency=440:beep_factor=4:sample_rate=48000:duration=${SECONDS}`,
    ],
    codec: ['-c:a', 'aac', '-b:a', '128k'],
  },
  {
    // A different pattern with its own seconds counter, used as the overlay.
    file: 'overlay.mp4',
    sources: [`testsrc=size=720x1280:rate=${FPS}:duration=${SECONDS}`],
    codec: [],
  },
];

mkdirSync(inputDir, { recursive: true });

for (const clip of clips) {
  const output = path.join(inputDir, clip.file);
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...clip.sources.flatMap((source) => ['-f', 'lavfi', '-i', source]),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    ...clip.codec,
    '-movflags',
    '+faststart',
    output,
  ];

  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });

  if (result.error) {
    const reason =
      result.error.code === 'ENOENT' ? 'ffmpeg was not found on PATH' : result.error.message;
    process.stderr.write(`Could not generate ${clip.file}: ${reason}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(
      `Could not generate ${clip.file}: ffmpeg exited with code ${result.status}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`Created ${path.relative(process.cwd(), output)}\n`);
}

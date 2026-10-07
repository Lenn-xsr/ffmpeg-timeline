import { describe, expect, it } from 'vitest';
import { parseProbeOutput } from '../src/io/probe.js';

const video = {
  codec_type: 'video',
  width: 1080,
  height: 1920,
  duration: '12.000000',
  r_frame_rate: '30/1',
};

describe('parseProbeOutput', () => {
  it('reads resolution, duration, frame rate and audio presence', () => {
    const json = JSON.stringify({
      streams: [{ codec_type: 'audio', duration: '12.010000' }, video],
      format: { duration: '12.010000' },
    });

    expect(parseProbeOutput(json, 'base.mp4')).toEqual({
      width: 1080,
      height: 1920,
      duration: 12,
      fps: 30,
      hasAudio: true,
    });
  });

  it('falls back to the container duration when the stream has none', () => {
    const json = JSON.stringify({
      streams: [{ ...video, duration: undefined, r_frame_rate: '30000/1001' }],
      format: { duration: '7.5' },
    });

    const info = parseProbeOutput(json, 'clip.mkv');

    expect(info.duration).toBe(7.5);
    expect(info.fps).toBeCloseTo(29.97, 2);
    expect(info.hasAudio).toBe(false);
  });

  it('reports an unknown frame rate as null', () => {
    const json = JSON.stringify({ streams: [{ ...video, r_frame_rate: '0/0' }] });

    expect(parseProbeOutput(json, 'clip.mp4').fps).toBeNull();
  });

  it('rejects files without a video stream', () => {
    const json = JSON.stringify({ streams: [{ codec_type: 'audio' }], format: { duration: '3' } });

    expect(() => parseProbeOutput(json, 'song.mp3')).toThrow('No video stream found in song.mp3');
  });

  it('rejects files whose duration is unknown', () => {
    const json = JSON.stringify({ streams: [{ ...video, duration: undefined }], format: {} });

    expect(() => parseProbeOutput(json, 'clip.mp4')).toThrow(
      'Could not determine the duration of clip.mp4',
    );
  });
});

import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { pcmToWav } from './wav.js';
import {
  buildFcpxml,
  fcpTime,
  parseMediaInfo,
  partitionClips,
  rateFromFps,
  safeFileName,
  timecodeFrames,
  wavDuration,
  wavLayout,
  withBextTimecode,
} from './davinciExport.js';

test('timecodes count frames from midnight, non-drop', () => {
  assert.equal(timecodeFrames('01:00:00:00', '25'), 90000);
  assert.equal(timecodeFrames('00:00:01:12', '25'), 37);
  assert.equal(timecodeFrames('01:00:00:00', '29.97'), 108000);
  assert.equal(timecodeFrames('00:00:00:25', '25'), null, 'frame past the rate');
  assert.equal(timecodeFrames('1:00', '25'), null);
});

test('FCPXML times are exact rationals at NTSC rates', () => {
  assert.equal(fcpTime(0, '25'), '0s');
  assert.equal(fcpTime(90000, '25'), '90000/25s');
  assert.equal(fcpTime(2, '23.976'), '2002/24000s');
});

test('clips run edge to edge, cut halfway between lines, so the file plays whole', () => {
  const clips = partitionClips(
    [
      { start: 4, end: 6, name: 'two' },
      { start: 1, end: 3, name: 'one', note: 'Line 1: too long by 0.4 s' },
      { start: 8, end: 9.5, name: 'three' },
    ],
    10,
    '25'
  );
  assert.deepEqual(
    clips.map((c) => [c.name, c.from, c.to]),
    [
      ['one', 0, 88],
      ['two', 88, 175],
      ['three', 175, 250],
    ]
  );
  assert.deepEqual(clips[0].notes, [{ at: 25, note: 'Line 1: too long by 0.4 s' }]);
});

test('a line with no frame of its own joins the clip before it, its marker kept', () => {
  const clips = partitionClips(
    [
      { start: 1, end: 2, name: 'a' },
      { start: 2.001, end: 2.002, name: 'b', note: 'check b' },
      { start: 2.003, end: 4, name: 'c' },
    ],
    5,
    '25'
  );
  const total = clips.reduce((sum, c) => sum + (c.to - c.from), 0);
  assert.equal(total, 125);
  assert.ok(clips.some((c) => c.notes.some((n) => n.note === 'check b')));
});

test('silent lines (no placed words) make no clip', () => {
  assert.deepEqual(partitionClips([{ start: null, end: null, name: 'x' }], 5, '25'), []);
});

test('the timeline puts each speaker on a lane of their own at the start timecode', () => {
  const dir = path.join(os.tmpdir(), 'Dubs', 'Talk');
  const out = buildFcpxml({
    title: 'Talk & dub',
    fps: '25',
    startTimecode: '01:00:00:00',
    tracks: [
      { name: 'Speaker 1', file: path.join(dir, 'Talk - Speaker 1.wav'), duration: 10, sampleRate: 48000, channels: 1, lines: [{ start: 1, end: 3, name: '1 Namaste', note: 'Line 1: <late>' }] },
      { name: 'Speaker 2', file: path.join(dir, 'Talk - Speaker 2.wav'), duration: 10, sampleRate: 48000, channels: 1, lines: [{ start: 4, end: 6, name: '2 Haan' }] },
    ],
  });
  assert.match(out, /<fcpxml version="1\.9">/);
  assert.match(out, /tcStart="90000\/25s"/);
  assert.match(out, /<project name="Talk &amp; dub">/);
  assert.match(out, /lane="-1" name="1 Namaste" offset="90000\/25s" start="90000\/25s" duration="250\/25s"/);
  assert.match(out, /lane="-2" name="2 Haan"/);
  assert.match(out, /<marker start="90025\/25s" duration="1\/25s" value="Line 1: &lt;late&gt;"\/>/);
  const src = pathToFileURL(path.join(dir, 'Talk - Speaker 1.wav')).href;
  assert.ok(out.includes(`src="${src}"`), 'the file as a file:// URL');
  assert.match(src, /Talk%20-%20Speaker%201\.wav$/);
});

test("ffmpeg's report gives the video's size, rate, sound and timecode", () => {
  const report = [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'talk.mp4':",
    '  Metadata:',
    '    timecode        : 10:00:00:00',
    '  Duration: 00:01:16.48, start: 0.000000, bitrate: 2400 kb/s',
    '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 2200 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)',
    '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 192 kb/s (default)',
    '  Stream #0:2: Video: mjpeg, yuvj420p, 300x300, 90k tbr (attached pic)',
  ].join('\n');
  assert.deepEqual(parseMediaInfo(report), {
    duration: 76.48,
    hasVideo: true,
    width: 1920,
    height: 1080,
    fps: 29.97,
    rate: '29.97',
    hasAudio: true,
    sampleRate: 48000,
    channels: 2,
    timecode: '10:00:00:00',
  });
  assert.equal(rateFromFps('23.98'), '23.976');
  assert.equal(rateFromFps('15'), null, 'no Resolve timeline at 15 fps');
});

test('with the video, it is the storyline on V1 and the dub hangs from it; the original sound is a guide track, turned off', () => {
  const dir = path.join(os.tmpdir(), 'Dubs', 'Talk');
  const video = { file: path.join(dir, 'Talk - original.mp4'), duration: 8, start: 0, hasVideo: true, hasAudio: true, width: 1280, height: 720, rate: '25', sampleRate: 48000, channels: 2 };
  const out = buildFcpxml({
    title: 'Talk',
    fps: '25',
    startTimecode: '01:00:00:00',
    tracks: [{ name: 'Dub', file: path.join(dir, 'Talk - dub.wav'), duration: 10, sampleRate: 48000, channels: 1, lines: [{ start: 1, end: 3, name: '1 a' }, { start: 8.5, end: 9.5, name: '2 b' }] }],
    video,
    guide: video,
  });
  assert.match(out, /<format id="r1" name="DHVANI 720p25" frameDuration="1\/25s" width="1280" height="720"\/>/);
  assert.equal((out.match(/<asset id="s1"/g) || []).length, 1, 'one asset for picture and sound');
  assert.match(out, /<asset id="s1" name="Talk - original.mp4" start="0s" duration="200\/25s" hasVideo="1" format="r1" hasAudio="1"/);
  assert.match(out, /<asset-clip ref="s1" name="Talk - original.mp4" offset="90000\/25s" start="0s" duration="200\/25s" srcEnable="video">/);
  // The first line hangs from the video, in the video's own time (its first frame is 0).
  assert.match(out, /<asset-clip ref="a1" lane="-1" name="1 a" offset="0s" start="90000\/25s" duration="144\/25s"/);
  // The dub runs past the video's end: a gap carries it, in timeline time.
  assert.match(out, /<gap name="Gap" offset="90200\/25s" start="90200\/25s" duration="50\/25s">/);
  assert.match(out, /<asset-clip ref="a1" lane="-1" name="2 b" offset="144\/25s" start="90144\/25s" duration="106\/25s"/, 'starts inside the video, so hangs from it');
  assert.match(out, /<asset-clip ref="s1" lane="-2" name="Original \(guide\)" offset="0s" start="0s" duration="200\/25s" srcEnable="audio" enabled="0"/);
  assert.match(out, /<sequence format="r1" duration="250\/25s"/);
});

test('a bad start timecode is refused, not guessed', () => {
  assert.throws(() => buildFcpxml({ title: 'x', fps: '25', startTimecode: 'soon', tracks: [] }), /not a timecode/);
});

test('file names keep the words and lose only what Windows refuses', () => {
  assert.equal(safeFileName('Sadhguru: Q&A / part 2.'), 'Sadhguru_ Q&A _ part 2');
  assert.equal(safeFileName('  '), 'DHVANI dub');
  assert.equal(safeFileName('সাধগুরু কথা'), 'সাধগুরু কথা');
});

const wavOf = (samples, sampleRate = 48000) => pcmToWav(Buffer.from(Int16Array.from(samples).buffer), { sampleRate, channels: 1, bitsPerSample: 16 });

const through = async (input, opts, chunkSize = 7) => {
  const pieces = [];
  for (let i = 0; i < input.length; i += chunkSize) pieces.push(input.subarray(i, i + chunkSize));
  let seen;
  const out = await buffer(Readable.from(pieces).pipe(withBextTimecode({ ...opts, onLayout: (l) => (seen = l) })));
  return { out, seen };
};

test('the bext chunk says where the file starts and every sample goes through as it was', async () => {
  const samples = Array.from({ length: 4800 }, (_, i) => ((i * 37) % 2000) - 1000);
  const wav = wavOf(samples);
  const { out, seen } = await through(wav, { timeReferenceSeconds: 3600, description: 'Talk dub' });
  assert.equal(seen.format.sampleRate, 48000);
  const layout = wavLayout(out);
  assert.equal(layout.hasBext, true);
  assert.equal(out.readUInt32LE(4), out.length - 8, 'RIFF size grown with the chunk');
  const bextAt = out.indexOf('bext');
  assert.equal(out.readUInt32LE(bextAt + 8 + 338), 3600 * 48000);
  assert.equal(out.toString('latin1', bextAt + 8 + 256, bextAt + 8 + 262), 'DHVANI');
  const origData = wav.subarray(wavLayout(wav).dataAt);
  assert.ok(out.subarray(layout.dataAt).equals(origData), 'audio bytes identical');
  assert.equal(wavDuration(layout), 0.1);
});

test('anything that is not a WAV passes through untouched', async () => {
  const mp3 = Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000 fake mp3 frames here', 'latin1');
  const { out, seen } = await through(mp3, { timeReferenceSeconds: 3600 });
  assert.ok(out.equals(mp3));
  assert.equal(seen, null);
});

test('a WAV that already has a bext keeps its own', async () => {
  const once = (await through(wavOf([1, 2, 3, 4]), { timeReferenceSeconds: 10 })).out;
  const twice = (await through(once, { timeReferenceSeconds: 99 })).out;
  assert.ok(twice.equals(once));
});

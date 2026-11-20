import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { pcmToWav } from './wav.js';
import {
  buildFcpxml,
  fcpTime,
  partitionClips,
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
  const out = buildFcpxml({
    title: 'Talk & dub',
    fps: '25',
    startTimecode: '01:00:00:00',
    tracks: [
      { name: 'Speaker 1', file: 'D:\\Dubs\\Talk\\Talk - Speaker 1.wav', duration: 10, sampleRate: 48000, channels: 1, lines: [{ start: 1, end: 3, name: '1 Namaste', note: 'Line 1: <late>' }] },
      { name: 'Speaker 2', file: 'D:\\Dubs\\Talk\\Talk - Speaker 2.wav', duration: 10, sampleRate: 48000, channels: 1, lines: [{ start: 4, end: 6, name: '2 Haan' }] },
    ],
  });
  assert.match(out, /<fcpxml version="1\.9">/);
  assert.match(out, /tcStart="90000\/25s"/);
  assert.match(out, /<project name="Talk &amp; dub">/);
  assert.match(out, /lane="-1" name="1 Namaste" offset="90000\/25s" start="90000\/25s" duration="250\/25s"/);
  assert.match(out, /lane="-2" name="2 Haan"/);
  assert.match(out, /<marker start="90025\/25s" duration="1\/25s" value="Line 1: &lt;late&gt;"\/>/);
  assert.match(out, /src="file:\/\/\/D:\/Dubs\/Talk\/Talk%20-%20Speaker%201\.wav"/);
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

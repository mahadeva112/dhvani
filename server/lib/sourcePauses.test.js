import test from 'node:test';
import assert from 'node:assert/strict';
import { sourcePausesOf, pausePositions, pauseAllowances, unpausedMarks, SOURCE_PAUSE_SECONDS } from './sourcePauses.js';
import { previewSync } from './syncPreview.js';
import { shortenPauses } from './syncRender.js';
import { runSync, clearClipCache } from './syncDub.js';

const RATE = 8000;
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.01, `${message ?? ''} ${actual} ≠ ${expected}`);

/** Sine bursts of `words` seconds, separated by the silences in `gaps`, with `lead` and `tail` of silence. */
const speech = ({ lead = 0.2, words, gaps, tail = 0.2 }) => {
  const total = lead + words.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0) + tail;
  const samples = new Float32Array(Math.round(total * RATE));
  let at = lead;
  words.forEach((length, n) => {
    const a = Math.round(at * RATE);
    const b = a + Math.round(length * RATE);
    for (let i = a; i < b; i++) samples[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE);
    at += length + (gaps[n] ?? 0);
  });
  return samples;
};

test('the original has no pauses to match without word timestamps', () => {
  assert.equal(sourcePausesOf([{ id: 1, words: [] }]), null);
  assert.equal(sourcePausesOf([{ id: 1, words: [{ text: 'a', start: 0, end: 1 }] }, { id: 2 }]), null);
});

test("the original's pauses are the gaps between its words, spacing and sounds aside", () => {
  const pauses = sourcePausesOf([
    {
      words: [
        { text: 'one', start: 0, end: 1 },
        { text: ' ', start: 1, end: 1.5 },
        { text: 'two', start: 1.5, end: 2 },
        { text: '(laughs)', start: 2.02, end: 2.6 },
        { text: 'three', start: 2.05, end: 3 },
      ],
    },
    { words: [{ text: 'four', start: 3 + SOURCE_PAUSE_SECONDS / 2, end: 4 }] },
  ]);
  // Only the half-second gap after "one" is a pause; the laugh and the short gap before "four" are not.
  assert.equal(pauses.length, 1);
  near(pauses[0].length, 0.5);
  // One second of talking before it, out of 3.5.
  near(pauses[0].at, 1 / 3.5);
});

test('a pause the original lacks does not push the later ones out of place', () => {
  // A dub that pauses a whole second at 25% of its talking time still has its 75% pause at 75%.
  const at = pausePositions([{ start: 1, end: 2 }, { start: 4, end: 4.3 }], 0, 5.3);
  near(at[0], 0.25);
  near(at[1], 0.75);
});

test('a dub pause keeps the length of the original pause it matches, and a word gap where there is none', () => {
  const allowed = pauseAllowances(
    [{ at: 0.3, length: 0.8 }, { at: 0.5, length: 0.9 }, { at: 0.9, length: 0.1 }],
    [{ at: 0.33, length: 0.4 }],
    { keep: 0.15 }
  );
  near(allowed[0], 0.4, 'matched');
  near(allowed[1], 0.15, 'nothing left to match: the closest pair took the original pause');
  near(allowed[2], 0.1, 'never more than the pause has');
  // Too far from any original pause to be one.
  near(pauseAllowances([{ at: 0.6, length: 0.8 }], [{ at: 0.3, length: 0.5 }], { keep: 0.15 })[0], 0.15);
});

test('shortenPauses cuts a pause the original lacks even when the line fits, and only silence', () => {
  // Three words; the dub pauses 0.8 s after the first and 0.6 s after the second.
  const samples = speech({ words: [1, 1, 1], gaps: [0.8, 0.6] });
  const source = { lead: 0.2, speech: 4.4, keep: 0.15, pauses: [{ at: 2 / 3, length: 0.3 }] };
  const { samples: out, removed, matched, cuts } = shortenPauses(samples, RATE, 0, { source });
  near(matched, 0.65 + 0.3, 'the first pause down to 0.15 s, the second down to the original 0.3 s');
  near(removed, matched);
  assert.equal(cuts.length, 2);
  // The words are all there, sample for sample.
  const loud = (array) => array.reduce((n, x) => n + (Math.abs(x) > 0.001 ? 1 : 0), 0);
  assert.equal(loud(out), loud(samples));
  // With nothing to match against, a line that fits is left alone.
  assert.equal(shortenPauses(samples, RATE, 0).removed, 0);
});

test('a line that still runs long after the match gives up more of its pauses as before', () => {
  const samples = speech({ words: [1, 1], gaps: [1] });
  const source = { lead: 0.2, speech: 3, keep: 0.15, pauses: [{ at: 0.5, length: 1 }] };
  // The original pauses as long as the dub: nothing to match away, so only the overflow is taken.
  const { removed, matched } = shortenPauses(samples, RATE, 0.3, { source, minPause: 0.25, maxTake: 0.4 });
  near(matched, 0);
  near(removed, 0.3);
});

test('Sync takes out a pause the original speaker never made, and reports it', async () => {
  clearClipCache();
  const words = (start, end, n) => Array.from({ length: n }, (_, k) => ({ text: `w${k}`, start: start + ((end - start) * k) / n, end: start + ((end - start) * (k + 1)) / n }));
  const segments = [
    { id: 1, startTime: 1, endTime: 4, textTarget: 'one line.', textSource: 'src', words: words(1, 4, 6) },
    { id: 2, startTime: 6, endTime: 7, textTarget: 'two.', textSource: 'src', words: words(6, 7, 2) },
    { id: 3, startTime: 9, endTime: 10, textTarget: 'three.', textSource: 'src' },
  ];
  const deps = {
    // Line one pauses a whole second in the middle; the original runs straight through.
    voiceLines: async (lines) => lines.map((line) => (line.text.startsWith('one') ? speech({ words: [1.2, 1.2], gaps: [1] }) : speech({ words: [0.6], gaps: [] }))),
    decode: async (samples) => samples,
    encode: async (samples) => ({ buffer: Buffer.from(new Uint8Array(samples.buffer)), contentType: 'audio/test' }),
  };
  const voice = { voiceId: 'v', modelId: 'm', outputFormat: 'pcm_8000' };
  const { report, bank } = await runSync({ segments, sourceDuration: 12, sampleRate: RATE, voice, join: { removeBreaths: false, chunkSync: false } }, deps);
  near(report.units[0].sourcePauseTrimmed, 0.85);
  near(report.units[0].speech, 2.55);
  assert.equal(report.units[1].sourcePauseTrimmed, 0);
  assert.equal(report.units[2].sourcePauseTrimmed, null, 'no word timestamps: not checked');
  assert.equal(report.summary.sourcePausesUnknown, 1);
  assert.equal(bank.lines[0].cuts.length, 1);
  // Turned off, the pause stays.
  clearClipCache();
  const off = await runSync({ segments, sourceDuration: 12, sampleRate: RATE, voice, join: { removeBreaths: false, matchSourcePauses: false } }, deps);
  assert.equal(off.report.units[0].pauseTrimmed, 0);
  assert.equal(off.report.units[0].sourcePauseTrimmed, null);
});

test('a comma the original speaker talks straight through is flagged, one where they pause is not', () => {
  // The original pauses halfway through; the dub has a comma there and another near the start.
  const source = [{ at: 0.5, length: 0.4 }];
  const marks = unpausedMarks('aaaa, bbbbbbbbbbbbbb, cccccccccccccccccc.', source);
  assert.deepEqual(marks, [{ mark: ',', after: 'aaaa' }]);
  // The mark that ends the line is no pause inside it, and a decimal point is no mark.
  assert.deepEqual(unpausedMarks('it costs 3.5 rupees.', []), []);
  // Without the original's word timestamps there is nothing to compare with.
  assert.deepEqual(unpausedMarks('aaaa, bbbb.', null), []);
});

test('the Sync fit estimate lists the marks the original runs through', () => {
  const words = [{ text: 'a', start: 0, end: 1 }, { text: 'b', start: 1.02, end: 2 }];
  const preview = previewSync({ segments: [{ id: 1, startTime: 0, endTime: 2, textTarget: 'আমি, তুমি আর সে।', words }], charsPerSecond: 10, sourceDuration: 3 });
  assert.deepEqual(preview.units[0].unpausedMarks, [{ mark: ',', after: 'আমি' }]);
});

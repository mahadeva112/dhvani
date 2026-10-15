import test from 'node:test';
import assert from 'node:assert/strict';
import { splitChunks, wordKinds, pauseFloor, chunkTargets } from './chunkSync.js';
import { runSync, clearClipCache } from './syncDub.js';
import { checkParts, lineArrays, renderEdits } from './syncEdit.js';

const RATE = 8000;
const tone = (samples, from, to, level = 0.3) => {
  for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) samples[i] = level * Math.sin((2 * Math.PI * 220 * i) / RATE);
};
const sec = (chunks) => chunks.map(({ from, to }) => [+(from / RATE).toFixed(3), +(to / RATE).toFixed(3)]);

test('a line is split where it goes quiet, as REAPER Dynamic split cuts it, with its pads', () => {
  const samples = new Float32Array(3 * RATE);
  tone(samples, 0.2, 0.8);
  tone(samples, 1.0, 1.5); // 200 ms of silence before: a split
  tone(samples, 1.6, 2.2); // 100 ms: under the 150 ms minimum, no split
  const chunks = splitChunks(samples, RATE, {});
  assert.equal(chunks.length, 2);
  const [[a0, a1], [b0, b1]] = sec(chunks);
  assert.ok(Math.abs(a0 - 0.19) < 0.006 && Math.abs(a1 - 0.82) < 0.006, `10 ms before, 20 ms after: ${a0}-${a1}`);
  assert.ok(Math.abs(b0 - 0.99) < 0.006 && Math.abs(b1 - 2.22) < 0.006, `${b0}-${b1}`);

  // Silence only: one chunk, the whole line.
  assert.deepEqual(splitChunks(new Float32Array(RATE), RATE, {}), [{ from: 0, to: RATE }]);
});

test("a word's soft start and dying sound stay in its chunk, down to the close level", () => {
  const samples = new Float32Array(2 * RATE);
  // A soft "s" at about -48 dB for 60 ms: under the -40 dB open level, over the -55 dB close level.
  tone(samples, 0.44, 0.5, 0.004);
  tone(samples, 0.5, 1.0);
  // The word dies away at about -50 dB for 80 ms.
  tone(samples, 1.0, 1.08, 0.003);
  const [chunk] = splitChunks(samples, RATE, {});
  assert.ok(chunk.from / RATE <= 0.44 - 0.009, `the soft start is kept, from ${chunk.from / RATE}`);
  assert.ok(chunk.to / RATE >= 1.08 + 0.019, `the dying sound is kept, to ${chunk.to / RATE}`);
});

test('a split is never made inside a word forced alignment hears, and a short slice is not cut out alone', () => {
  const samples = new Float32Array(3 * RATE);
  tone(samples, 0.2, 0.8);
  tone(samples, 1.2, 1.8);
  // Alignment hears one word over both sounds (a long held vowel, say): no split there.
  assert.equal(splitChunks(samples, RATE, { protect: [{ start: 0.2 * RATE, end: 1.8 * RATE }] }).length, 1);
  assert.equal(splitChunks(samples, RATE, { protect: [{ start: 0.2 * RATE, end: 0.8 * RATE }, { start: 1.2 * RATE, end: 1.8 * RATE }] }).length, 2);

  // A 50 ms click on its own is under the 100 ms minimum slice: it joins its neighbour.
  const clicky = new Float32Array(3 * RATE);
  tone(clicky, 0.2, 0.8);
  tone(clicky, 1.2, 1.25);
  tone(clicky, 1.6, 2.2);
  assert.equal(splitChunks(clicky, RATE, {}).length, 2);
});

test('pauses are read from the script: after a word, a comma, or a sentence end', () => {
  const words = ['आज', 'हम', 'चलेंगे', 'लेकिन', 'धीरे', 'ठीक', 'है'].map((text) => ({ text }));
  assert.deepEqual(wordKinds('आज हम चलेंगे, लेकिन धीरे। ठीक है?', words), ['word', 'word', 'comma', 'word', 'stop', 'word', 'stop']);
  // Alignment that splits a word in two still finds the punctuation at its end.
  assert.deepEqual(wordKinds('Yes, go.', [{ text: 'Ye' }, { text: 's' }, { text: 'go' }]), ['word', 'comma', 'stop']);
});

test('pauses shrink in punctuation order: between words, then at commas, sentence ends last', () => {
  const gaps = { gapShare: 0.5, wordGap: 0.12, commaGap: 0.18, stopGap: 0.25, maxGap: 1 };
  // Tier 0: only a pause between words shrinks; a comma and a sentence end keep theirs.
  assert.equal(pauseFloor('word', 0.8, 0, gaps), 0.4);
  assert.equal(pauseFloor('comma', 0.8, 0, gaps), 0.8);
  assert.equal(pauseFloor('stop', 0.8, 0, gaps), 0.8);
  assert.equal(pauseFloor('comma', 0.8, 1, gaps), 0.4);
  assert.equal(pauseFloor('stop', 0.8, 1, gaps), 0.8);
  assert.equal(pauseFloor('stop', 0.8, 2, gaps), 0.4);
  // Each kind's own floor, and never more than the pause there was.
  assert.equal(pauseFloor('stop', 0.3, 2, gaps), 0.25);
  assert.equal(pauseFloor('word', 0.2, 2, gaps), 0.12);
  assert.equal(pauseFloor('stop', 0.1, 2, gaps), 0.1);
  assert.equal(pauseFloor('word', 3, 2, gaps), 1, 'no chunk waits more than maxGap');
});

test("each chunk's target is the same share of its cue's original speech, with the original's pauses skipped", () => {
  const cues = [
    { startTime: 1, endTime: 3, textTarget: 'aaaa bbbb', words: [{ text: 'A', start: 1, end: 1.5 }, { text: 'B', start: 2.5, end: 3 }] },
    { startTime: 5, endTime: 6, textTarget: 'cccc', words: [{ text: 'C', start: 5, end: 6 }] },
  ];
  const words = [{ text: 'aaaa', start: 0.1, end: 0.5 }, { text: 'bbbb', start: 1.2, end: 1.6 }, { text: 'cccc', start: 2.4, end: 2.8 }];
  // Halfway through cue 1's letters is the start of its second spoken stretch, past the 1 s pause.
  assert.deepEqual(chunkTargets({ onsets: [0.1, 1.2, 2.4], words, cues, lead: 0.1, speech: 2.7 }), [1, 2.5, 5]);
});

// ---- In a sync ----

const cue = (id, startTime, endTime, text, words) => ({ id, startTime, endTime, duration: endTime - startTime, textTarget: text, textSource: `src ${id}`, words });
const voice = { voiceId: 'v', modelId: 'm', outputFormat: 'pcm_8000' };

/** A voice that reads each word as 0.08 s a letter, with `pause` s after each word and after the line. */
const voiceOf = (pause) => (text) => {
  const words = text.replace(/[.।]$/u, '').split(' ');
  const length = 0.15 + words.reduce((sum, w) => sum + w.replace(/[^a-z]/g, '').length * 0.08 + pause, 0);
  const samples = new Float32Array(Math.round(length * RATE));
  let at = 0.15;
  for (const w of words) {
    const seconds = w.replace(/[^a-z]/g, '').length * 0.08;
    tone(samples, at, at + seconds);
    at += seconds + pause;
  }
  return samples;
};

/** Forced alignment for the fake voice: each stretch of sound is the next word. */
const alignOf = (asked = []) => async ({ samples, text, sampleRate }) => {
  asked.push(text);
  const hop = Math.round(0.01 * sampleRate);
  const regions = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let peak = 0;
    for (let j = i; j < i + hop; j++) peak = Math.max(peak, Math.abs(samples[j]));
    const last = regions.at(-1);
    if (peak > 0.01) {
      if (last && i - last.end <= 3 * hop) last.end = i + hop;
      else regions.push({ start: i, end: i + hop });
    }
  }
  return { words: text.split(/\s+/).map((word, n) => ({ text: word, start: regions[n].start / sampleRate, end: regions[n].end / sampleRate })) };
};

const deps = (pause, extra = {}) => ({
  voiceLines: async (lines, { onLine }) =>
    lines.map((line, n) => {
      onLine(n + 1);
      return voiceOf(pause)(line.text);
    }),
  decode: async (samples) => samples,
  encode: async (samples) => ({ buffer: Buffer.from(new Uint8Array(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength))), contentType: 'audio/test' }),
  ...extra,
});

const asFloat = (buffer) => new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

/**
 * One cue whose speaker says three words with short pauses, where the voice
 * pauses 0.7 s after each: placed whole it runs long and every line after it
 * starts late; as chunks, each word lands on the original's.
 */
const SEGMENTS = [
  cue(1, 1, 3.4, 'aaaaaaa bbbbbbb ccccccc', [
    { text: 'A', start: 1, end: 1.56 },
    { text: 'B', start: 1.92, end: 2.48 },
    { text: 'C', start: 2.84, end: 3.4 },
  ]),
  cue(2, 3.9, 4.5, 'ddddddd', [{ text: 'D', start: 3.9, end: 4.46 }]),
];

test('Chunk sync places each chunk on the original where a whole line would run long and push the next one late', async () => {
  clearClipCache();
  const whole = await runSync({ segments: SEGMENTS, sourceDuration: 6, sampleRate: RATE, voice, join: { chunkSync: false, matchSourcePauses: false, shortenPauses: false, tightenSilences: false } }, deps(0.9, { align: alignOf() }));
  assert.ok(whole.report.units[1].offset > 0.5, `placed whole, the next line starts ${whole.report.units[1].offset} s late`);

  clearClipCache();
  const asked = [];
  const { report, bank } = await runSync({ segments: SEGMENTS, sourceDuration: 6, sampleRate: RATE, voice }, deps(0.9, { align: alignOf(asked) }));
  assert.equal(report.join.chunkSync, true, 'Chunk sync is the default');
  assert.deepEqual(asked, ['aaaaaaa bbbbbbb ccccccc', 'ddddddd'], "every line's words are timed once");
  assert.equal(report.units[0].chunks, 3);
  assert.equal(bank.lines[0].chunks.length, 3);
  // A pause may shrink to half what the voice left (0.44 s, where the original pauses 0.36 s): the little left over is shared out.
  for (const unit of report.units) assert.ok(Math.abs(unit.offset) <= report.tolerance, `line ${unit.key} off by ${unit.offset}`);
  assert.equal(report.summary.inSync, 2);
  assert.equal(report.summary.overlaps, 0);
  // The second and third words land on the original's too.
  const [, b, c] = bank.lines[0].chunks;
  assert.ok(Math.abs(b.startSample / RATE + 0.01 - 1.92) <= report.tolerance, `word 2 at ${b.startSample / RATE + 0.01}`);
  assert.ok(Math.abs(c.startSample / RATE + 0.01 - 2.84) <= report.tolerance, `word 3 at ${c.startSample / RATE + 0.01}`);
});

test("rendering the bank's chunks with no edits is the synced dub, sample for sample", async () => {
  clearClipCache();
  const { buffer, bank } = await runSync({ segments: SEGMENTS, sourceDuration: 6, sampleRate: RATE, voice }, deps(0.7, { align: alignOf() }));
  const parts = bank.lines.flatMap((line, index) => line.chunks.map((chunk) => ({ line: index, from: chunk.from, to: chunk.to, startSample: chunk.startSample, rate: 1, gainDb: 0, fadeIn: 0, fadeOut: 0 })));
  const { track } = await renderEdits({ bank, arrays: lineArrays(bank), parts: checkParts(parts, bank), sourceDuration: 6 });
  assert.deepEqual(track, asFloat(buffer));
});

test('without word timing a line is not split blind: it stays whole, less the silence around it, and says why', async () => {
  clearClipCache();
  const { report, bank } = await runSync(
    { segments: SEGMENTS, sourceDuration: 6, sampleRate: RATE, voice },
    deps(0.7, { align: async () => { throw new Error('No ElevenLabs key.'); } })
  );
  assert.equal(report.units[0].chunks, 1);
  assert.equal(report.units[0].cutCheckError, 'No ElevenLabs key.');
  assert.ok(bank.lines[0].chunks[0].from > 0, 'the silence before the first word is left out');

  // With the check off, it is split as REAPER would, without asking.
  clearClipCache();
  const blind = await runSync({ segments: SEGMENTS, sourceDuration: 6, sampleRate: RATE, voice, join: { checkCutWords: false } }, deps(0.7));
  assert.equal(blind.report.units[0].chunks, 3);
});

test('a pause between words shrinks before a sentence end does', async () => {
  // The voice pauses 0.7 s after each word. The original pauses 0.5 s after the sentence end and 0.18 s between words.
  const segments = [
    cue(1, 1, 3.4, 'aaaaaaa. bbbbbbb ccccccc', [
      { text: 'A', start: 1, end: 1.56 },
      { text: 'B', start: 2.06, end: 2.62 },
      { text: 'C', start: 2.8, end: 3.36 },
    ]),
  ];
  const pause = (x, y) => (y.startSample - (x.startSample + (x.to - x.from))) / RATE;
  const sync = async (punctuationPriority) => {
    clearClipCache();
    const { bank } = await runSync({ segments, sourceDuration: 5, sampleRate: RATE, voice, join: { chunkGapShare: 0, punctuationPriority } }, deps(0.7, { align: alignOf() }));
    const [a, b, c] = bank.lines[0].chunks;
    return { stop: pause(a, b), word: pause(b, c) };
  };
  const first = await sync(true);
  assert.ok(first.stop > 0.6, `the sentence end keeps its pause while shrinking the word gap is enough: ${first.stop.toFixed(2)} s`);
  assert.ok(first.word < 0.2, `the pause between words shrinks: ${first.word.toFixed(2)} s`);
  const any = await sync(false);
  assert.ok(any.stop < first.stop - 0.05, `without the order, the sentence end gives up some of its pause too: ${any.stop.toFixed(2)} s`);
});

// ---- Fit by voice speed ----

/** A voice whose words and pauses take 1/speedScale as long when it reads faster; `cutOffAbove` stops a faster read mid-word. */
const speedDeps = ({ cutOffAbove = Infinity } = {}) => {
  const asked = [];
  return {
    asked,
    deps: deps(0.3, {
      align: alignOf(),
      voiceLines: async (lines, { onLine, voice: v }) =>
        lines.map((line, n) => {
          onLine(n + 1);
          const speed = v.speedScale ?? 1;
          asked.push({ text: line.text, speed });
          const words = line.text.replace(/[.।]$/u, '').split(' ');
          const length = 0.15 + words.reduce((sum, w) => sum + (w.length * 0.08 + 0.3) / speed, 0);
          const samples = new Float32Array(Math.round(length * RATE));
          let at = 0.15;
          for (const w of words) {
            const seconds = (w.length * 0.08) / speed;
            tone(samples, at, at + seconds);
            at += seconds + 0.3 / speed;
          }
          // Stopped mid-word: loud right to the last sample.
          if (speed > cutOffAbove) tone(samples, length - 0.2, length);
          return samples;
        }),
    }),
  };
};

/** 2.24 s of words in a 1.9 s slot: too long with every pause gone. */
const LONG = [
  cue(1, 1, 2.9, 'aaaaaaa bbbbbbb ccccccc dddddd', [{ text: 'A', start: 1, end: 2.9 }]),
  cue(2, 3.4, 4, 'eeeeeee', [{ text: 'E', start: 3.4, end: 3.96 }]),
];

test('a line too long with every pause shrunk is voiced again, read faster by the voice, and then fits', async () => {
  clearClipCache();
  const { asked, deps: d } = speedDeps();
  const { report } = await runSync({ segments: LONG, sourceDuration: 5, sampleRate: RATE, voice }, d);
  const fitted = asked.filter((a) => a.speed !== 1);
  assert.equal(fitted.length, 1, 'only the line too long is voiced again');
  assert.equal(fitted[0].text.replace(/[.।]$/u, ''), 'aaaaaaa bbbbbbb ccccccc dddddd');
  assert.ok(fitted[0].speed > 1.02 && fitted[0].speed <= 1.15, `read at ${fitted[0].speed}×`);
  assert.equal(report.units[0].speedFit, fitted[0].speed);
  assert.ok(!report.units[1].speedFit, 'the line that fits keeps its take');
  assert.equal(report.summary.speedFitted, 1);
  assert.ok(Math.abs(report.units[1].offset) <= report.tolerance, `the next line starts on time: ${report.units[1].offset}`);
});

test('Fit by voice speed never goes past its limit, keeps a take that finishes its words, and can be turned off', async () => {
  clearClipCache();
  const capped = speedDeps();
  await runSync({ segments: LONG, sourceDuration: 5, sampleRate: RATE, voice, join: { maxVoiceSpeed: 1.05 } }, capped.deps);
  assert.ok(capped.asked.every((a) => a.speed <= 1.05));

  clearClipCache();
  const cut = speedDeps({ cutOffAbove: 1 });
  const { report } = await runSync({ segments: LONG, sourceDuration: 5, sampleRate: RATE, voice }, cut.deps);
  assert.ok(cut.asked.some((a) => a.speed > 1), 'a faster read was tried');
  assert.ok(!report.units[0].speedFit, 'one that stops mid-word is not used');
  assert.equal(report.units[0].cutOff, false, 'the first take stays');

  clearClipCache();
  const off = speedDeps();
  const plain = await runSync({ segments: LONG, sourceDuration: 5, sampleRate: RATE, voice, join: { speedFit: false } }, off.deps);
  assert.ok(off.asked.every((a) => a.speed === 1));
  assert.equal(plain.report.units[0].exceeded, true, 'without it the line is flagged too long');
});

test('a voice whose model ignores speed is not voiced again for nothing, and the line says why', async () => {
  clearClipCache();
  const { asked, deps: d } = speedDeps();
  const { report } = await runSync({ segments: LONG, sourceDuration: 5, sampleRate: RATE, voice: { ...voice, modelId: 'eleven_v4' } }, d);
  assert.ok(asked.every((a) => a.speed === 1), 'no faster take is asked for');
  assert.equal(report.units[0].speedFitUnsupported, true);
  assert.equal(report.summary.speedFitUnsupported, 1);
});

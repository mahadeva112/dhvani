import test from 'node:test';
import assert from 'node:assert/strict';
import { splitChunks, wordKinds, pauseFloor, chunkTargets, linePauses, joinSpokenBlocks } from './chunkSync.js';
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
  // Match source pauses is off: it would cut the sentence end's pause to the original's 0.5 s before placing.
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
    const { bank } = await runSync({ segments, sourceDuration: 5, sampleRate: RATE, voice, join: { chunkGapShare: 0, punctuationPriority, matchSourcePauses: false } }, deps(0.7, { align: alignOf() }));
    const [a, b, c] = bank.lines[0].chunks;
    return { stop: pause(a, b), word: pause(b, c) };
  };
  const first = await sync(true);
  assert.ok(first.stop > 0.6, `the sentence end keeps its pause while shrinking the word gap is enough: ${first.stop.toFixed(2)} s`);
  assert.ok(first.word < 0.2, `the pause between words shrinks: ${first.word.toFixed(2)} s`);
  const any = await sync(false);
  assert.ok(any.stop < first.stop - 0.05, `without the order, the sentence end gives up some of its pause too: ${any.stop.toFixed(2)} s`);
});

// ---- Chunks said in one go ----

test("the original's pauses inside a line are the gaps in its speech, between its cues as well", () => {
  const cues = [
    { startTime: 1, endTime: 2, words: [{ text: 'a', start: 1, end: 1.4 }, { text: 'b', start: 1.45, end: 2 }] },
    { startTime: 2.5, endTime: 3, words: [{ text: 'c', start: 2.5, end: 3 }] },
  ];
  // The 50 ms between "a" and "b" is a word boundary; the half second before the next cue is a pause.
  assert.deepEqual(linePauses(cues), [[2, 2.5]]);
});

test('blocks the original says in one go are joined at the least pause their punctuation allows', () => {
  const block = (target, pauseBefore, kindBefore = 'word') => ({ length: 0.5, pauseBefore, kindBefore, chunks: [{ at: 0, target }] });
  const floorOf = (kind) => (kind === 'stop' ? 0.25 : 0.12);
  const blocks = [block(1, 0), block(2, 0.6), block(3, 0.6, 'stop'), block(5, 0.6)];
  // The original pauses between 3.5 s and 4.5 s: the last block waits for its own word.
  const joined = joinSpokenBlocks(blocks, [[3.5, 4.5]], floorOf);
  assert.equal(joined.length, 2);
  assert.deepEqual(joined[0].chunks.map((chunk) => +chunk.at.toFixed(2)), [0, 0.62, 1.37]);
  assert.deepEqual(joined[0].chunks.map((chunk) => Boolean(chunk.follows)), [false, true, true]);
  assert.ok(Math.abs(joined[0].length - 1.87) < 1e-9);
  assert.equal(joined[1], blocks[3]);
  // A pause the voice left shorter than the floor stays as short as it was.
  assert.ok(Math.abs(joinSpokenBlocks([block(1, 0), block(2, 0.05)], [], floorOf)[0].chunks[1].at - 0.55) < 1e-9);
});

/** The original reads three words slowly and in one go; the voice pauses half a second after each. */
const SLOW = (pauseBeforeC = 0) => [
  cue(1, 1, 3.4 + pauseBeforeC, 'aaaaaaa bbbbbbb ccccccc', [
    { text: 'A', start: 1, end: 1.7 },
    { text: 'B', start: 1.75, end: 2.5 },
    { text: 'C', start: 2.55 + pauseBeforeC, end: 3.4 + pauseBeforeC },
  ]),
];
const slowSync = async (segments, join) => {
  clearClipCache();
  const { bank } = await runSync({ segments, sourceDuration: 6, sampleRate: RATE, voice, join: { matchSourcePauses: false, ...join } }, deps(0.5, { align: alignOf() }));
  const chunks = bank.lines[0].chunks;
  return chunks.slice(1).map((chunk, n) => (chunk.startSample - (chunks[n].startSample + chunks[n].to - chunks[n].from)) / RATE);
};

test('chunks the original says in one go play back to back, and wait again where the original pauses', async () => {
  const apart = await slowSync(SLOW(), { joinSpokenChunks: false });
  assert.ok(apart.every((gap) => gap > 0.2), `each chunk waits for its own word: ${apart.map((g) => g.toFixed(2))}`);
  const joined = await slowSync(SLOW(), {});
  // The shortest pause between words, 0.12 s, between one chunk's pad and the next.
  assert.ok(joined.every((gap) => Math.abs(gap - 0.12) < 0.005), `back to back: ${joined.map((g) => g.toFixed(2))}`);
  const paused = await slowSync(SLOW(0.8), {});
  assert.ok(Math.abs(paused[0] - 0.12) < 0.005, `said in one go: ${paused[0].toFixed(2)}`);
  assert.ok(paused[1] > 0.4, `the original pauses before the last word, and so does the dub: ${paused[1].toFixed(2)}`);
});

test('with Chunk sync, a pause on room tone the original never made is cut inside its chunk', async () => {
  clearClipCache();
  // The voice pauses 0.6 s on room tone at about -50 dB: louder than the split's close level, so no split there.
  const roomy = async (lines, { onLine }) =>
    lines.map((line, n) => {
      onLine(n + 1);
      const samples = new Float32Array(Math.round(2.15 * RATE));
      tone(samples, 0.15, 0.71);
      let seed = 3;
      for (let i = Math.round(0.71 * RATE); i < Math.round(1.31 * RATE); i++) {
        seed = (seed * 16807) % 2147483647;
        samples[i] = ((seed / 2147483647) * 2 - 1) * 0.003;
      }
      tone(samples, 1.31, 1.87);
      return samples;
    });
  const segments = [cue(1, 1, 2.2, 'aaaaaaa bbbbbbb', [{ text: 'A', start: 1, end: 1.6 }, { text: 'B', start: 1.62, end: 2.2 }])];
  const { report } = await runSync({ segments, sourceDuration: 4, sampleRate: RATE, voice, join: { removeBreaths: false } }, { ...deps(0), voiceLines: roomy, align: alignOf() });
  assert.equal(report.join.chunkSync, true);
  assert.ok(Math.abs(report.units[0].sourcePauseTrimmed - 0.45) < 0.02, `cut to 0.15 s: ${report.units[0].sourcePauseTrimmed}`);
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
  const { report } = await runSync({ segments: LONG, sourceDuration: 5, sampleRate: RATE, voice, join: { speedFit: 'auto', bestTakes: 'off' } }, d);
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
  await runSync({ segments: LONG, sourceDuration: 5, sampleRate: RATE, voice, join: { maxVoiceSpeed: 1.05, speedFit: 'auto', bestTakes: 'off' } }, capped.deps);
  assert.ok(capped.asked.every((a) => a.speed <= 1.05));

  clearClipCache();
  const cut = speedDeps({ cutOffAbove: 1 });
  const { report } = await runSync({ segments: LONG, sourceDuration: 5, sampleRate: RATE, voice, join: { speedFit: 'auto', bestTakes: 'off' } }, cut.deps);
  assert.ok(cut.asked.some((a) => a.speed > 1), 'a faster read was tried');
  assert.ok(!report.units[0].speedFit, 'one that stops mid-word is not used');
  assert.equal(report.units[0].cutOff, false, 'the first take stays');

  clearClipCache();
  const off = speedDeps();
  const plain = await runSync({ segments: LONG, sourceDuration: 5, sampleRate: RATE, voice, join: { speedFit: 'off', bestTakes: 'off' } }, off.deps);
  assert.ok(off.asked.every((a) => a.speed === 1));
  assert.equal(plain.report.units[0].exceeded, true, 'without it the line is flagged too long');
});

test('a voice whose model reads no faster either way is not voiced again for nothing, and the line says why', async () => {
  clearClipCache();
  const { asked, deps: d } = speedDeps();
  const { report } = await runSync({ segments: LONG, sourceDuration: 5, sampleRate: RATE, voice: { ...voice, modelId: 'eleven_monolingual_v1' }, join: { bestTakes: 'off', speedFit: 'auto' } }, d);
  assert.ok(asked.every((a) => a.speed === 1), 'no faster take is asked for');
  assert.equal(report.units[0].speedFitUnsupported, true);
  assert.equal(report.summary.speedFitUnsupported, 1);
});

// ---- The dub ends with the original ----

const plainVoice = async (lines, { onLine }) =>
  lines.map((line, n) => {
    onLine(n + 1);
    const seconds = line.text.replace(/[.।]$/u, '').length * 0.08;
    const samples = new Float32Array(Math.round((seconds + 0.3) * RATE));
    tone(samples, 0.15, 0.15 + seconds);
    return samples;
  });
const endDeps = { ...deps(0.3), voiceLines: plainVoice };
/** A dub too long for the video: placed freely, its last line ends half a second past the original's end. */
const TOO_LONG = [cue(1, 0.5, 1.7, 'a'.repeat(20)), cue(2, 2, 3.2, 'b'.repeat(20)), cue(3, 3.5, 4.7, 'c'.repeat(20)), cue(4, 5.6, 6.8, 'd'.repeat(20))];
const endOf = (bank) => Math.max(...bank.lines.flatMap((line) => line.chunks.map((chunk) => (chunk.startSample + chunk.to - chunk.from) / RATE)));
const endSync = (join) => {
  clearClipCache();
  return runSync({ segments: TOO_LONG, sourceDuration: 7, sampleRate: RATE, voice, join: { checkCutWords: false, speedFit: false, ...join } }, endDeps);
};

test('with Must end by, a long dub shares its extra time across its lines instead of running past the end', async () => {
  const free = await endSync({ endByVideo: false });
  assert.ok(endOf(free.bank) > 7.3, `placed freely it ends at ${endOf(free.bank)}`);

  const ends = await endSync({ endByVideo: true, endSlack: 0.2 });
  assert.ok(endOf(ends.bank) <= 7.2 + 1 / RATE, `it ends by 7.2 s: ${endOf(ends.bank)}`);
  assert.ok(ends.report.units[0].offset < free.report.units[0].offset - 0.1, 'the lines before start earlier to make the room');
  assert.equal(ends.report.units.at(-1).timingConflict, null);

  // Too long to end in time at all: it ends as soon as it can, and the last line says so.
  const late = await endSync({ endByVideo: true, endSlack: 0 });
  assert.match(late.report.units.at(-1).timingConflict, /past the original's end/);
  assert.ok(late.report.summary.endsPastVideo > 0);
});

// ---- Best of 3 takes, Ask and Auto ----

/**
 * A voice whose takes differ by seed: each seed reads a little faster or
 * slower (as real takes do), `pitchOf(seed)` can move a take's voice, and a
 * pace direction reads it 12% faster.
 */
const takeDeps = ({ pitchOf = () => 220 } = {}) => {
  const asked = [];
  return {
    asked,
    deps: deps(0.3, {
      align: alignOf(),
      voiceLines: async (lines, { onLine, voice: v }) =>
        lines.map((line, n) => {
          onLine(n + 1);
          const seed = line.seed ?? 0;
          const paced = /^\[calm, fast\] /.test(line.text);
          const text = line.text.replace(/^\[[^\]]+\] /, '').replace(/[.।]$/u, '');
          asked.push({ text, seed, speed: v.speedScale ?? 1, paced, tags: Boolean(v.performanceTags) });
          const pace = (v.speedScale ?? 1) * (paced ? 1.12 : 1) * (1 + (seed % 7) * 0.02);
          const pitch = pitchOf(seed);
          const words = text.split(' ');
          const length = 0.15 + words.reduce((sum, w) => sum + (w.length * 0.08 + 0.3) / pace, 0);
          const samples = new Float32Array(Math.round(length * RATE));
          let at = 0.15;
          for (const w of words) {
            const seconds = (w.length * 0.08) / pace;
            for (let i = Math.round(at * RATE); i < Math.round((at + seconds) * RATE); i++) samples[i] = 0.3 * Math.sin((2 * Math.PI * pitch * i) / RATE);
            at += seconds + 0.3 / pace;
          }
          return samples;
        }),
    }),
  };
};
const takeSync = (d, params = {}) => {
  clearClipCache();
  return runSync({ segments: LONG, sourceDuration: 5, sampleRate: RATE, voice: { ...voice, seed: 1 }, ...params }, d);
};

test('Ask offers the best of 3 takes beside the one in the dub; Use puts it in, cached, and Keep stops asking', async () => {
  const first = takeDeps();
  const asked = await takeSync(first.deps, { join: { bestTakes: 'ask', speedFit: 'off' } });
  const fitted = asked.report.units[0].takeFit;
  assert.equal(fitted.kind, 'take');
  assert.equal(fitted.used, false, 'Ask keeps the dub as it was');
  assert.ok(fitted.saved > 0);
  assert.equal(asked.offers.length, 1, 'the offered take comes back to listen to');
  assert.equal(asked.offers[0].key, asked.report.units[0].key);
  assert.equal(asked.report.summary.takesOffered, 1);
  assert.equal(first.asked.filter((a) => a.text.startsWith('aaaa')).length, 3, 'three takes of the long line');

  // Use: the next sync voices the line with the chosen take, from the cache, and offers nothing more.
  const before = first.asked.length;
  const takeChoices = { [asked.report.units[0].key]: { ...fitted.choice, text: asked.report.units[0].text } };
  const used = await runSync({ segments: LONG, sourceDuration: 5, sampleRate: RATE, voice: { ...voice, seed: 1 }, join: { bestTakes: 'ask', speedFit: 'off' }, takeChoices }, first.deps);
  assert.equal(used.report.units[0].takeChosen, true);
  assert.equal(used.report.units[0].takeFit, undefined);
  assert.ok(first.asked.length - before <= 1, 'the chosen take was voiced before');
  assert.ok(used.report.units[0].exceededBy < asked.report.units[0].exceededBy);

  // Keep: the line is not tried again.
  const kept = takeDeps();
  const again = await takeSync(kept.deps, { join: { bestTakes: 'ask', speedFit: 'off' }, declinedTakes: [asked.report.units[0].key] });
  assert.equal(again.report.units[0].takeFit, undefined);
  assert.equal(kept.asked.filter((a) => a.text.startsWith('aaaa')).length, 1);
});

test('Auto uses the shortest new take at once, and Review can tell which', async () => {
  const { deps: d } = takeDeps();
  const { report, offers } = await takeSync(d, { join: { bestTakes: 'auto', speedFit: 'off' } });
  assert.equal(report.units[0].takeFit.used, true);
  assert.equal(offers.length, 0);
  assert.equal(report.summary.takesUsed, 1);
});

test('Eleven v4 reads a long line faster with a calm pace direction, as speed does nothing on it', async () => {
  const { asked, deps: d } = takeDeps();
  const { report } = await takeSync(d, { voice: { ...voice, seed: 1, modelId: 'eleven_v4' }, join: { bestTakes: 'off', speedFit: 'auto' } });
  const paced = asked.filter((a) => a.paced);
  assert.equal(paced.length, 1);
  assert.equal(paced[0].speed, 1, 'no speed is sent to v4');
  assert.equal(paced[0].tags, true, 'the direction reaches the voice');
  assert.equal(report.units[0].takeFit.pace, '[calm, fast]');
  assert.equal(report.units[0].takeFit.used, true);
});

test('a new take whose voice sits higher or lower is not used, and the line says why', async () => {
  // Every take but the first comes out a fifth higher.
  const { deps: d } = takeDeps({ pitchOf: (seed) => (seed === 1 ? 220 : 270) });
  const { report, offers } = await takeSync(d, { join: { bestTakes: 'auto', speedFit: 'off' } });
  assert.equal(report.units[0].takeFit, undefined);
  assert.match(report.units[0].takeRejected, /higher than the take it would replace/);
  assert.ok(offers.some((offer) => offer.rejected && offer.key === report.units[0].key), 'the take turned down comes back to listen to anyway');
});

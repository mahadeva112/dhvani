import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCuesFromWords,
  serializeSrt,
  parseSrt,
  retextCues,
  assertTimingsPreserved,
  formatSrtTimestamp,
  filterSpokenWords,
} from './srt.js';

/** A short ElevenLabs-shaped word list with a deliberate 1.2s silence gap. */
const words = [
  { text: 'The', start: 0.12, end: 0.31, type: 'word' },
  { text: ' ', start: 0.31, end: 0.34, type: 'spacing' },
  { text: 'mind', start: 0.34, end: 0.72, type: 'word' },
  { text: 'is', start: 0.75, end: 0.9, type: 'word' },
  { text: 'restless.', start: 0.93, end: 1.64, type: 'word' },
  { text: '(pause)', start: 1.64, end: 2.84, type: 'audio_event' },
  { text: 'But', start: 2.84, end: 3.05, type: 'word' },
  { text: 'you', start: 3.08, end: 3.26, type: 'word' },
  { text: 'can', start: 3.29, end: 3.51, type: 'word' },
  { text: 'watch', start: 3.54, end: 3.92, type: 'word' },
  { text: 'it.', start: 3.95, end: 4.4, type: 'word' },
];

test('spacing and audio-event tokens never influence timing or text', () => {
  const spoken = filterSpokenWords(words);
  assert.equal(spoken.length, 9);
  assert.ok(!spoken.some((word) => word.text === '(pause)' || word.text.trim() === ''));
});

test('cue boundaries come verbatim from ElevenLabs word timestamps', () => {
  const cues = buildCuesFromWords(words);

  assert.equal(cues.length, 2, 'the 1.2s silence should force a cue break');
  assert.equal(cues[0].startTime, 0.12, 'first cue starts at the first measured word');
  assert.equal(cues[0].endTime, 1.64, 'first cue ends at the last measured word in it');
  assert.equal(cues[1].startTime, 2.84);
  assert.equal(cues[1].endTime, 4.4, 'last cue ends at the final measured word');

  // Every cue edge must equal some measured word edge.
  const starts = new Set(filterSpokenWords(words).map((word) => word.start));
  const ends = new Set(filterSpokenWords(words).map((word) => word.end));
  for (const cue of cues) {
    assert.ok(starts.has(cue.startTime), `cue start ${cue.startTime} is a measured word start`);
    assert.ok(ends.has(cue.endTime), `cue end ${cue.endTime} is a measured word end`);
  }
});

test('translation replaces text and leaves every timestamp untouched', () => {
  const sourceCues = buildCuesFromWords(words);

  const translations = new Map(sourceCues.map((cue) => [String(cue.id), `[bn] ${cue.text}`]));
  const translatedCues = retextCues(sourceCues, translations, 'translatedText');

  assert.doesNotThrow(() => assertTimingsPreserved(sourceCues, translatedCues));

  for (let i = 0; i < sourceCues.length; i += 1) {
    assert.equal(translatedCues[i].startTime, sourceCues[i].startTime);
    assert.equal(translatedCues[i].endTime, sourceCues[i].endTime);
    assert.notEqual(translatedCues[i].translatedText, sourceCues[i].text);
  }

  // The two SRTs must differ only in their text lines.
  const timingsOf = (srt) => srt.split('\n').filter((line) => line.includes('-->'));
  assert.deepEqual(
    timingsOf(serializeSrt(translatedCues, { field: 'translatedText' })),
    timingsOf(serializeSrt(sourceCues, { field: 'text' }))
  );
});

test('the integrity check rejects a shifted or dropped cue', () => {
  const sourceCues = buildCuesFromWords(words);

  const shifted = sourceCues.map((cue, i) => (i === 0 ? { ...cue, startTime: cue.startTime + 0.5 } : cue));
  assert.throws(() => assertTimingsPreserved(sourceCues, shifted), /timestamps were modified/);

  assert.throws(() => assertTimingsPreserved(sourceCues, sourceCues.slice(1)), /source cues but/);
});

test('SRT timecodes are formatted to the standard', () => {
  assert.equal(formatSrtTimestamp(0), '00:00:00,000');
  assert.equal(formatSrtTimestamp(1.64), '00:00:01,640');
  assert.equal(formatSrtTimestamp(3671.5), '01:01:11,500');
  assert.equal(formatSrtTimestamp(-4), '00:00:00,000');
});

test('SRT round-trips through the parser without timing drift', () => {
  const cues = buildCuesFromWords(words);
  const srt = serializeSrt(cues, { field: 'text' });
  const reparsed = parseSrt(srt);

  assert.equal(reparsed.length, cues.length);
  for (let i = 0; i < cues.length; i += 1) {
    assert.equal(reparsed[i].startTime, cues[i].startTime);
    assert.equal(reparsed[i].endTime, cues[i].endTime);
  }
});

test('cue numbering is sequential and gapless', () => {
  const cues = buildCuesFromWords(words);
  const indices = serializeSrt(cues, { field: 'text' })
    .trim()
    .split('\n\n')
    .map((block) => Number(block.split('\n')[0]));

  assert.deepEqual(indices, [1, 2]);
});

test('a long run of words is split by the length limits, still on word edges', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({
    text: `word${i}`,
    start: i * 0.3,
    end: i * 0.3 + 0.25,
    type: 'word',
  }));

  const cues = buildCuesFromWords(many);
  assert.ok(cues.length > 1, 'limits should force multiple cues');

  for (const cue of cues) {
    assert.ok(cue.endTime - cue.startTime <= 6.001, 'no cue exceeds the duration limit');
    assert.ok(cue.words.length > 0);
    assert.equal(cue.startTime, cue.words[0].start);
    assert.equal(cue.endTime, cue.words[cue.words.length - 1].end);
  }

  // No cue may overlap the next one.
  for (let i = 1; i < cues.length; i += 1) {
    assert.ok(cues[i].startTime >= cues[i - 1].endTime, 'cues must not overlap');
  }
});

test('empty or unusable input yields no cues rather than fabricated ones', () => {
  assert.deepEqual(buildCuesFromWords([]), []);
  assert.deepEqual(buildCuesFromWords([{ text: ' ', start: 0, end: 1, type: 'spacing' }]), []);
});

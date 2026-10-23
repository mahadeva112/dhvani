import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScriptFile, readDhvaniScript, mapScriptToCues, splitOverCues } from './scriptShare.ts';
import type { ScriptFile } from './scriptShare.ts';
import type { AudioSegment } from '../types';

const seg = (id: number, startTime: number, endTime: number, textSource = '', textTarget = ''): AudioSegment => ({
  id,
  startTime,
  endTime,
  duration: endTime - startTime,
  textSource,
  textTarget,
});

const fileOf = (cues: [number, number, string][], duration?: number): ScriptFile => ({
  kind: 'dhvani-script',
  version: 1,
  targetLanguage: 'Bengali',
  exportedAt: '',
  sourceFile: duration ? { duration } : {},
  cues: cues.map(([start, end, target]) => ({ start, end, source: '', target })),
});

test('a saved script file reads back as it was written', () => {
  const segments = [
    { ...seg(1, 0, 2.5, 'Hello there', 'নমস্কার'), speaker: 'Host' },
    { ...seg(2, 2.5, 5, 'How are you', 'কেমন আছেন'), speaker: 'Guest' },
  ];
  const file = buildScriptFile(segments, { targetLanguage: 'Bengali', sourceLanguage: 'English', audioDuration: 5 });
  const read = readDhvaniScript(JSON.stringify(file, null, 2));
  assert.equal(read?.kind, 'cues');
  if (read?.kind !== 'cues') return;
  assert.deepEqual(read.file.cues, file.cues);
  assert.equal(read.file.sourceFile?.duration, 5);
  assert.equal(read.file.targetLanguage, 'Bengali');
});

test('the old JSON export is read too', () => {
  const old = { language: 'Hindi', segments: [{ startTime: 1, endTime: 2, sourceText: 'Hi', targetText: 'नमस्ते' }] };
  const read = readDhvaniScript(JSON.stringify(old));
  assert.equal(read?.kind, 'cues');
  if (read?.kind !== 'cues') return;
  assert.deepEqual(read.file.cues[0], { start: 1, end: 2, speaker: undefined, source: 'Hi', target: 'नमस्ते' });
});

test('a pasted timecoded export keeps its times and drops the scaffolding', () => {
  const pasted = [
    '====================================================',
    'DHVANI DUB - TALK.MP4 - BROADCAST CUE SCRIPT',
    'Language: Bengali',
    'Total Cues: 2 | Duration: 0m 5s',
    '====================================================',
    '',
    'CUE #1 [00:00:00,000 ➔ 00:00:02,500] (2.50s)',
    'Speaker 1: নমস্কার, সবাই',
    '',
    '----------------------------------------------------',
    '',
    'CUE #2 [00:00:02,500 ➔ 00:00:05,040] (2.54s)',
    'Speaker: (No translation)',
  ].join('\n');
  const read = readDhvaniScript(pasted);
  assert.equal(read?.kind, 'cues');
  if (read?.kind !== 'cues') return;
  assert.equal(read.coarse, false);
  assert.deepEqual(
    read.file.cues.map((c) => [c.start, c.end, c.speaker, c.target]),
    [
      [0, 2.5, 'Speaker 1', 'নমস্কার, সবাই'],
      [2.5, 5.04, 'Speaker', ''],
    ]
  );
});

test('a pasted bilingual export gives the target line, not the original', () => {
  const pasted = [
    '====================================================',
    'X - BILINGUAL DUBBING SCRIPT',
    'Target Language: Bengali',
    'Total Cues: 1 | Duration: 0m 3s',
    '====================================================',
    '',
    '[#1 | 01:02 - 01:05] Guest',
    'ORIGINAL: Time: it is everything',
    'BENGALI: সময়ই সব',
  ].join('\n');
  const read = readDhvaniScript(pasted);
  assert.equal(read?.kind, 'cues');
  if (read?.kind !== 'cues') return;
  assert.equal(read.coarse, true);
  assert.deepEqual(read.file.cues[0], { start: 62, end: 65, speaker: 'Guest', source: 'Time: it is everything', target: 'সময়ই সব' });
});

test('a pasted dialogue export gives one line per cue without speaker tags', () => {
  const pasted = [
    '====================================================',
    'DHVANI AI DUBBING STUDIO',
    'Target Language: Bengali',
    'Total Cues: 2 | Duration: 0m 5s',
    '====================================================',
    '',
    '[Speaker 1] নমস্কার',
    '',
    '[Speaker 2] কেমন আছেন',
  ].join('\n');
  assert.deepEqual(readDhvaniScript(pasted), { kind: 'lines', lines: ['নমস্কার', 'কেমন আছেন'] });
});

test('an ordinary script is not taken for a Dhvani one', () => {
  assert.equal(readDhvaniScript('[হাসি] নমস্কার সবাই।\nআজ আমরা কথা বলব।'), null);
  assert.equal(readDhvaniScript('{ not json'), null);
});

test('the same cues get their lines back one for one', () => {
  const segments = [seg(1, 0, 2.5), seg(2, 2.6, 5)];
  const map = mapScriptToCues(fileOf([[0, 2.5, 'এক'], [2.62, 5.01, 'দুই']]), segments);
  assert.equal(map.match, 'same');
  assert.deepEqual(map.texts, ['এক', 'দুই']);
  assert.deepEqual(map.windows, []);
});

test('lines inside one cue join it whole when this transcript has fewer cues', () => {
  const segments = [seg(1, 0, 5), seg(2, 5, 9)];
  const map = mapScriptToCues(fileOf([[0, 2.4, 'এক'], [2.5, 4.9, 'দুই'], [5.1, 9, 'তিন']]), segments);
  assert.equal(map.match, 'timed');
  assert.deepEqual(map.texts, ['এক দুই', 'তিন']);
  assert.deepEqual(map.estimated, [false, false]);
  assert.deepEqual(map.windows, []);
});

test('a line over several cues is split by length and returned to place by meaning', () => {
  const segments = [seg(1, 0, 2), seg(2, 2, 4), seg(3, 4, 6)];
  const map = mapScriptToCues(fileOf([[0, 4, 'এক দুই তিন চার'], [4, 6, 'পাঁচ']]), segments);
  assert.deepEqual(map.texts, ['এক দুই', 'তিন চার', 'পাঁচ']);
  assert.deepEqual(map.estimated, [true, true, false]);
  assert.deepEqual(map.windows, [{ cues: [0, 1], text: 'এক দুই তিন চার', kind: 'split' }]);
});

/** A file saved from these cues: their English and times, with the given targets. */
const savedFrom = (segments: AudioSegment[], targets: string[], shift = 0): ScriptFile => ({
  ...buildScriptFile(segments, { targetLanguage: 'Hindi' }),
  cues: segments.map((s, i) => ({ start: s.startTime + shift, end: s.endTime + shift, source: s.textSource || '', target: targets[i] })),
});

test('the same cues, proven by their English, map one to one, zero-length cues included', () => {
  const segments = [
    seg(1, 0, 2, 'When you sit,'),
    seg(2, 2, 2, 'just'),
    seg(3, 2, 4, 'close your eyes.'),
    seg(4, 4, 4, 'Breathe.'),
  ];
  const targets = ['जब आप बैठें,', 'बस', 'आँखें बंद करें।', 'साँस लें…'];
  // Times saved a second late, as from a re-timed transcript: the English still matches.
  const map = mapScriptToCues(savedFrom(segments, targets, 1), segments);
  assert.equal(map.match, 'same');
  assert.equal(map.identity, 'text');
  assert.deepEqual(map.texts, targets);
  assert.deepEqual(map.windows, []);
  assert.deepEqual(map.zeroLength, [1, 3]);
});

test('as many cues with the same times but other English are not taken for the same cues', () => {
  const segments = [seg(1, 0, 2, 'Good morning everyone.'), seg(2, 2, 4, 'Today we talk about sleep.')];
  const file = savedFrom([seg(1, 0, 2, 'Welcome to the program.'), seg(2, 2, 4, 'Let us begin with a story.')], ['स्वागत है।', 'कहानी से शुरू करें।']);
  const map = mapScriptToCues(file, segments);
  assert.equal(map.match, 'timed');
  assert.equal(map.sourceDiffers, true);
  assert.equal(map.identity, undefined);
});

test('an older file with no English is matched by its times only', () => {
  const segments = [seg(1, 0, 2.5, 'Hello'), seg(2, 2.6, 5, 'there')];
  const map = mapScriptToCues(fileOf([[0, 2.5, 'এক'], [2.62, 5.01, 'দুই']]), segments);
  assert.equal(map.match, 'same');
  assert.equal(map.identity, 'time');
});

test('a passage the file holds in one cue, beside empty cues with English, is returned to spread by meaning', () => {
  const segments = [
    seg(1, 0, 2, 'This is the first thing.'),
    seg(2, 2, 4, 'Look at how the mind works.'),
    seg(3, 4, 6, 'It keeps running all day long.'),
    seg(4, 6, 8, 'Even in sleep it does not stop.'),
    seg(5, 8, 10, 'That is the last thing.'),
  ];
  const paragraph = 'देखिए मन कैसे काम करता है। यह दिन भर दौड़ता रहता है, रुकता नहीं। नींद में भी यह बिल्कुल नहीं रुकता, लगातार चलता ही रहता है।';
  const targets = ['यह पहली बात है।', paragraph, '', '', 'यह आख़िरी बात है।'];
  const map = mapScriptToCues(savedFrom(segments, targets), segments);
  assert.equal(map.match, 'same');
  // Nothing is moved yet: the passage stays where the file has it until it is placed by meaning.
  assert.deepEqual(map.texts, targets);
  assert.deepEqual(map.windows, [{ cues: [1, 2, 3], text: paragraph, kind: 'collapsed' }]);
});

test('a cue the file has no line for stays empty when its neighbours are ordinary', () => {
  const segments = [seg(1, 0, 2, 'One thing.'), seg(2, 2, 4, 'Another thing.'), seg(3, 4, 6, 'A third thing.')];
  const targets = ['एक बात।', '', 'तीसरी बात।'];
  const map = mapScriptToCues(savedFrom(segments, targets), segments);
  assert.deepEqual(map.texts, targets);
  assert.deepEqual(map.windows, []);
});

test('a zero-length cue inside a timed line is linked to it instead of losing its text', () => {
  const segments = [seg(1, 0, 2, 'Sit'), seg(2, 2, 2, 'and'), seg(3, 2, 4, 'rest')];
  // The file was cut differently: one line over the first two cues, then one more.
  const file = fileOf([[0, 2, 'बैठिए और'], [2.01, 4, 'आराम कीजिए']]);
  const map = mapScriptToCues(file, segments);
  assert.equal(map.match, 'timed');
  assert.deepEqual(map.zeroLength, [1]);
  assert.ok(map.windows.some((w) => w.cues.includes(1)), 'the zero-length cue is placed by meaning with its line');
  assert.equal(map.texts.join(' ').split(/\s+/).filter(Boolean).join(' '), 'बैठिए और आराम कीजिए');
});

test('a small timing slip at a cue edge does not pull a line into the next cue', () => {
  const segments = [seg(1, 0, 3), seg(2, 3, 6)];
  const map = mapScriptToCues(fileOf([[0, 3.08, 'এক'], [3.05, 6, 'দুই'], [6.2, 6.3, 'শেষ']]), segments);
  assert.deepEqual(map.texts, ['এক', 'দুই শেষ']);
  assert.deepEqual(map.windows, []);
});

test('every word of the file lands, in order', () => {
  const segments = [seg(1, 0, 1.5), seg(2, 1.5, 2), seg(3, 2, 4.5), seg(4, 4.5, 8), seg(5, 8, 9)];
  const file = fileOf([[0.1, 2.2, 'ক খ গ'], [2.3, 4.4, 'ঘ ঙ'], [4.6, 6, 'চ'], [6.1, 8.9, 'ছ জ ঝ ঞ']]);
  const map = mapScriptToCues(file, segments);
  assert.equal(map.texts.join(' ').split(/\s+/).filter(Boolean).join(' '), 'ক খ গ ঘ ঙ চ ছ জ ঝ ঞ');
});

test('audio of another length is reported', () => {
  const map = mapScriptToCues(fileOf([[0, 1, 'এক']], 120), [seg(1, 0, 1)], { audioDuration: 90 });
  assert.deepEqual(map.audioMismatch, { file: 120, here: 90 });
  assert.equal(mapScriptToCues(fileOf([[0, 1, 'এক']], 120.4), [seg(1, 0, 1)], { audioDuration: 120 }).audioMismatch, null);
});

test('splitting over cues keeps every word and follows their lengths', () => {
  assert.deepEqual(splitOverCues('a b c d', [1, 1]), ['a b', 'c d']);
  assert.deepEqual(splitOverCues('a b c d', [3, 1]), ['a b c', 'd']);
  assert.deepEqual(splitOverCues('', [1, 1]), ['', '']);
});

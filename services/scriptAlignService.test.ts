import test from 'node:test';
import assert from 'node:assert/strict';
import { splitByLines } from './scriptAlignService.ts';
import type { AudioSegment } from '../types';

const segmentsOf = (english: string[]) =>
  english.map((text, i) => ({ id: i, textSource: text, startTime: i, endTime: i + 1 }) as unknown as AudioSegment);

const english = [
  'When you sit here,',
  'if you are simply aware of your breath,',
  'slowly the mind settles.',
  'This is not a practice,',
  'it is just paying attention to what is here.',
  'Nothing more than that.',
];
const bengali = [
  'আপনি যখন এখানে বসেন,',
  'শুধু নিজের শ্বাসের প্রতি সচেতন থাকলে,',
  'ধীরে ধীরে মন শান্ত হয়ে যায়।',
  'এটা কোনো অভ্যাস নয়,',
  'এটা শুধু এখানে যা আছে তার প্রতি মনোযোগ দেওয়া।',
  'এর বেশি কিছু নয়।',
];

test('as many lines as cues go one to one, with no flags', () => {
  const split = splitByLines(bengali.join('\n'), segmentsOf(english));
  assert.deepEqual(split.texts, bengali);
  assert.equal(split.estimated, undefined);
  assert.equal(split.note, undefined);
});

test('a line missing from the script only moves the cues next to the gap', () => {
  const pasted = bengali.filter((_, i) => i !== 3);
  const split = splitByLines(pasted.join('\n'), segmentsOf(english));
  // Lines after the gap still land on their own cues.
  assert.equal(split.texts[4], bengali[4]);
  assert.equal(split.texts[5], bengali[5]);
  assert.deepEqual(split.texts.slice(0, 2), bengali.slice(0, 2));
  // Only the cues around the gap are flagged.
  const flagged = split.estimated?.flatMap((e, i) => (e ? [i] : [])) ?? [];
  assert.ok(flagged.includes(3));
  assert.ok(flagged.every((i) => i === 2 || i === 3));
  assert.match(split.note ?? '', /5 lines for 6 cues/);
});

test('a line broken in two is joined back onto its cue', () => {
  const pasted = [...bengali.slice(0, 1), 'শুধু নিজের শ্বাসের', 'প্রতি সচেতন থাকলে,', ...bengali.slice(2)];
  const split = splitByLines(pasted.join('\n'), segmentsOf(english));
  assert.equal(split.texts[1], 'শুধু নিজের শ্বাসের প্রতি সচেতন থাকলে,');
  assert.deepEqual(split.texts.slice(2), bengali.slice(2));
  assert.equal(split.estimated?.[1], true);
  assert.match(split.note ?? '', /Check cue 2\b/);
});

test('every word of the script is placed once, in order', () => {
  const pasted = [bengali[0], `${bengali[1]} ${bengali[2]}`, ...bengali.slice(3)];
  const split = splitByLines(pasted.join('\n'), segmentsOf(english));
  assert.equal(split.texts.filter(Boolean).join(' '), pasted.join(' '));
});

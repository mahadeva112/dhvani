import test from 'node:test';
import assert from 'node:assert/strict';
import type { AudioSegment } from '../../types';
import { buildScriptParagraphs, scriptParagraphSeconds } from './passages.ts';

/** `minutes` of talk in 5 s cues with 0.3 s gaps, a full stop on every fourth, a longer pause on every twelfth. */
const talk = (minutes: number, speakerAt?: number): AudioSegment[] => {
  const cues: AudioSegment[] = [];
  let t = 0;
  for (let i = 0; t < minutes * 60; i++) {
    const gap = i % 12 === 11 ? 1.5 : 0.3;
    cues.push({
      id: i + 1,
      startTime: t,
      endTime: t + 5,
      duration: 5,
      speaker: speakerAt !== undefined && t >= speakerAt ? 'S2' : 'S1',
      textSource: i % 4 === 3 ? `Line ${i}.` : `Line ${i}`,
    } as AudioSegment);
    t += 5 + gap;
  }
  return cues;
};
const textOf = (seg: AudioSegment) => seg.textSource || '';
const lengths = (cues: AudioSegment[]) =>
  buildScriptParagraphs(cues, textOf).map((p) => p.cues[p.cues.length - 1].endTime - p.cues[0].startTime);

test('paragraph length follows the script length, between one and three minutes', () => {
  assert.equal(scriptParagraphSeconds(talk(3)), 60);
  assert.ok(Math.abs(scriptParagraphSeconds(talk(12)) - 120) < 3);
  assert.equal(scriptParagraphSeconds(talk(40)), 180);
  assert.equal(scriptParagraphSeconds([]), 120);
});

test('every cue lands in exactly one paragraph, in order', () => {
  const cues = talk(25);
  const flat = buildScriptParagraphs(cues, textOf).flatMap((p) => p.cues.map((c) => c.id));
  assert.deepEqual(flat, cues.map((c) => c.id));
});

test('paragraphs stay within 70-140% of the target, the last one too', () => {
  for (const minutes of [6, 12, 25, 60]) {
    const target = scriptParagraphSeconds(talk(minutes));
    for (const len of lengths(talk(minutes))) {
      assert.ok(len >= target * 0.7 - 6 && len <= target * 1.4, `${minutes} min: ${len.toFixed(0)} s against ${target.toFixed(0)} s`);
    }
  }
});

test('a paragraph ends at the longer pause or a sentence end, not mid-sentence', () => {
  const cues = talk(25);
  for (const p of buildScriptParagraphs(cues, textOf).slice(0, -1)) {
    const last = p.cues[p.cues.length - 1];
    const i = cues.indexOf(last);
    const gap = cues[i + 1].startTime - last.endTime;
    assert.ok(gap > 1 || /\.$/.test(textOf(last)), `paragraph ${p.index + 1} ends on "${textOf(last)}"`);
  }
});

test('a speaker change inside the window is where the paragraph ends', () => {
  const cues = talk(20, 150);
  const paragraphs = buildScriptParagraphs(cues, textOf);
  const firstS2 = cues.find((c) => c.speaker === 'S2')!;
  assert.ok(paragraphs.some((p) => p.cues[0].id === firstS2.id));
});

test('a short script is one paragraph, and unknown times still end paragraphs', () => {
  assert.equal(buildScriptParagraphs(talk(1), textOf).length, 1);
  const unknown = talk(10).map((c) => ({ ...c, startTime: NaN, endTime: NaN }));
  const paragraphs = buildScriptParagraphs(unknown, textOf);
  assert.ok(paragraphs.length > 1);
  assert.equal(paragraphs.flatMap((p) => p.cues).length, unknown.length);
});

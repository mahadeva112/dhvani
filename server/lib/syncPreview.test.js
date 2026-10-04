import test from 'node:test';
import assert from 'node:assert/strict';
import { previewSync, TIGHT_SHARE } from './syncPreview.js';
import { buildRewritePrompt, buildLengthenPrompt, acceptLengthen } from './syncRewrite.js';

const cue = (id, startTime, endTime, text, extra = {}) => ({ id, startTime, endTime, duration: endTime - startTime, textTarget: text, textSource: `src ${id}`, ...extra });

test('each line gets the slot Sync gives it: to the next phrase, less a breath', () => {
  // 10 characters at 10 chars/s = 1 s of speech.
  const { units } = previewSync({ segments: [cue(1, 0, 1, 'aaaaaaaaaa'), cue(2, 3, 4, 'bbbbbbbbbb')], charsPerSecond: 10, sourceDuration: 5 });
  assert.equal(units.length, 2);
  // The source pause after line 1 is 2 s; Sync keeps 0.6 s of it (30%, at most 0.6 s).
  assert.ok(Math.abs(units[0].slot - 2.4) < 1e-9);
  assert.ok(Math.abs(units[0].estimate - 1) < 1e-9);
  assert.equal(units[0].status, 'fits');
  // The last line runs to the end of the source, plus half a second.
  assert.ok(Math.abs(units[1].slot - 2.5) < 1e-9);
  assert.equal(units[0].key, '1');
});

test('cues spoken as one phrase are previewed as one line, as Sync voices them', () => {
  const { units } = previewSync({ segments: [cue(1, 0, 1, 'one'), cue(2, 1.1, 2, 'two'), cue(3, 4, 5, 'three')], charsPerSecond: 10 });
  assert.deepEqual(units.map((u) => u.cueIds), [[1, 2], [3]]);
  assert.equal(units[0].text, 'one two');
});

test('lines are fits, tight or long by the precision chosen', () => {
  // Slot of line 1: 0 -> 2, less the 0.3 s kept from a 1 s pause = 1.7 s.
  const segments = (chars) => [cue(1, 0, 1, 'x'.repeat(chars)), cue(2, 2, 3, 'yy')];
  const at = (chars, precision) => previewSync({ segments: segments(chars), charsPerSecond: 10, precision }).units[0].status;
  assert.equal(at(10, 'phrase'), 'fits'); // 1.0 s
  assert.equal(at(Math.ceil(1.7 * TIGHT_SHARE * 10) + 1, 'phrase'), 'tight');
  assert.equal(at(19, 'phrase'), 'tight'); // 1.9 s: 0.2 s over, inside phrase's 0.3 s allowance
  assert.equal(at(19, 'lipsync'), 'long'); // lip-sync allows only 0.15 s
  assert.equal(at(22, 'phrase'), 'long'); // 2.2 s: 0.5 s over
});

test('a long line gets a target length that fits its slot, with the same margin as Sync', () => {
  const { units, summary } = previewSync({ segments: [cue(1, 0, 1, 'x'.repeat(40)), cue(2, 2, 3, 'yy')], charsPerSecond: 10 });
  assert.equal(units[0].status, 'long');
  // 40 chars take 4 s; the slot is 1.7 s, so aim for 40 * 1.7 / 4 * 0.92 = 15.64 -> 15.
  assert.equal(units[0].targetChars, 15);
  assert.equal(summary.long, 1);
  assert.ok(Math.abs(summary.maxOverflow - 2.3) < 1e-9);
});

test('the preview takes the gaps and grouping Sync is asked to use', () => {
  const segments = [cue(1, 0, 1, 'x'.repeat(10)), cue(2, 2, 3, 'yy')];
  const { units } = previewSync({ segments, charsPerSecond: 10, join: { minGap: 0.08, gapShare: 0.3 } });
  assert.ok(Math.abs(units[0].slot - 1.7) < 1e-9);
});

test('cues with no translated words are left out, and a silly rate is clamped', () => {
  const { units, charsPerSecond } = previewSync({ segments: [cue(1, 0, 1, '...'), cue(2, 2, 3, 'hello')], charsPerSecond: 1000 });
  assert.equal(units.length, 1);
  assert.equal(charsPerSecond, 40);
});

test('a second try at a shorter line lists the earlier ones to differ from', () => {
  const prompt = buildRewritePrompt({ text: 'a long line', language: 'Hindi', targetChars: 8, avoid: ['short one'] });
  assert.match(prompt, /already offered/);
  assert.match(prompt, /- short one/);
  assert.doesNotMatch(buildRewritePrompt({ text: 'a long line', targetChars: 8 }), /already offered/);
});

test('a line that ends well before the original speaker stops is short, and aims to fill the speech', () => {
  // The speaker talks for 3 s; 10 chars at 10 chars/s is 1 s, under 60% and 2 s left silent.
  const { units, summary } = previewSync({ segments: [cue(1, 0, 3, 'x'.repeat(10)), cue(2, 5, 6, 'yy')], charsPerSecond: 10 });
  assert.equal(units[0].status, 'short');
  assert.ok(Math.abs(units[0].spoken - 3) < 1e-9);
  assert.ok(Math.abs(units[0].underflow - 2) < 1e-9);
  // Fill 95% of the 3 s spoken (2.85 s), well inside the 4.4 s slot: 28 chars.
  assert.equal(units[0].targetChars, 28);
  assert.equal(summary.short, 1);
  // A short line still fits its slot, so it counts there too.
  assert.equal(summary.fits, 2);
});

test('a line is not short when the gap is small, or when it is just a little quick', () => {
  const at = (chars, end) => previewSync({ segments: [cue(1, 0, end, 'x'.repeat(chars)), cue(2, end + 2, end + 3, 'yy')], charsPerSecond: 10 }).units[0];
  // 1.5 s spoken, 0.5 s said: under 60%, and 1 s silent, exactly the smallest gap that counts.
  assert.equal(at(5, 1.5).status, 'short');
  assert.equal(at(6, 1.5).status, 'fits'); // 0.9 s left silent: too small to see
  assert.equal(at(20, 3).status, 'fits'); // 2 s of 3 s: 67%
  assert.equal(at(20, 3).underflow, 0);
});

test('a fuller line never aims past the slot', () => {
  // Spoken 4 s, but the next line starts at 4.2 s: the slot (about 4.13 s) is the limit, not the speech.
  const { units } = previewSync({ segments: [cue(1, 0, 4, 'x'.repeat(10)), cue(2, 4.2, 5, 'yy')], charsPerSecond: 10 });
  assert.equal(units[0].status, 'short');
  assert.ok(units[0].targetChars <= Math.floor(units[0].slot * 10));
  assert.ok(units[0].targetChars > 10);
});

test('a fuller-line prompt asks for the same meaning, and lists earlier tries to differ from', () => {
  const prompt = buildLengthenPrompt({ text: 'short', sourceText: 'the original line', language: 'Hindi', targetChars: 20, avoid: ['a bit longer'] });
  assert.match(prompt, /about 20 characters/);
  assert.match(prompt, /Do not add any idea/);
  assert.match(prompt, /- a bit longer/);
  assert.doesNotMatch(buildLengthenPrompt({ text: 'short', targetChars: 20 }), /already offered/);
});

test('acceptLengthen rejects lines that are not longer or that run far past the target', () => {
  assert.equal(acceptLengthen('a short line', 'a short line'), null);
  assert.equal(acceptLengthen('a short line', 'short'), null);
  assert.equal(acceptLengthen('a short line', '"a short line, said in full"', 30), 'a short line, said in full');
  assert.equal(acceptLengthen('a short line', 'x'.repeat(40), 30), null); // past 1.25 x 30
});

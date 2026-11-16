import test from 'node:test';
import assert from 'node:assert/strict';
import { readBrief, briefBlock } from './translationChecks.js';
import { sentenceBatches, seamWindows, translateCueTexts } from '../providers/gemini/translation.js';

const sizes = (batches) => batches.map((batch) => batch.length);

test('batches end where a sentence ends, near the plain cut, and keep the plain cut without one', () => {
  const cues = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), text: i === 6 || i === 15 ? 'and that was the end.' : 'and so on' }));
  assert.deepEqual(sizes(sentenceBatches(cues, 8)), [7, 9, 4]);
  const plain = cues.map((cue) => ({ ...cue, text: 'and so on' }));
  assert.deepEqual(sizes(sentenceBatches(plain, 8)), [8, 8, 4]);
  // A trailing "..." is not a sentence end, and a last batch a little over the size stays whole.
  const trailing = cues.map((cue, i) => ({ ...cue, text: i === 6 ? 'and then...' : 'and so on' }));
  assert.deepEqual(sizes(sentenceBatches(trailing, 8)), [8, 8, 4]);
  assert.deepEqual(sizes(sentenceBatches(cues.slice(0, 10), 8)), [10]);
});

test('each join is read with three cues on each side, never past the middle of a neighbouring batch', () => {
  assert.deepEqual(seamWindows([0, 40, 80], 120), [
    { join: 40, from: 37, to: 43 },
    { join: 80, from: 77, to: 83 },
  ]);
  // Batches of five: the windows meet but never share a cue.
  assert.deepEqual(seamWindows([10, 0, 5], 15), [
    { join: 5, from: 2, to: 7 },
    { join: 10, from: 7, to: 12 },
  ]);
  assert.deepEqual(seamWindows([0], 15), []);
});

test("the talk's brief is read from the whole transcript and kept short", () => {
  assert.equal(readBrief({}), null);
  assert.equal(readBrief(null), null);
  const brief = readBrief({ about: ' A talk on stillness. ', tone: 'warm', address: 'আপনি, with its verb forms', extra: 'x' });
  assert.deepEqual(brief, { about: 'A talk on stillness.', tone: 'warm', address: 'আপনি, with its verb forms' });
  assert.equal(readBrief({ about: 'x'.repeat(2000) }).about.length, 500);
  assert.match(briefBlock(brief), /THE WHOLE TALK[\s\S]*Addressing the listener: আপনি[\s\S]*same form of "you"/);
  assert.equal(briefBlock(null), '');
});

/** A stand-in model for a whole full translation: glossary, translator, reviewer and seam pass. */
const wholeRun = ({ seamLine, reviewSeam = { sentences: [] } }) => {
  const prompts = [];
  let seamAsked = false;
  const generate = async ({ contents }) => {
    const prompt = contents.parts[0].text;
    prompts.push(prompt);
    let answer = { translations: [] };
    if (prompt.includes('preparing the glossary')) {
      answer = { brief: { about: 'A talk on stillness.', tone: 'warm', address: 'আপনি' }, terms: [] };
    } else if (prompt.includes('smoothing the join')) {
      seamAsked = true;
      answer = { translations: [{ id: '6', translatedText: seamLine }] };
    } else if (prompt.includes('strict reviewer')) {
      answer = seamAsked ? reviewSeam : { sentences: [] };
    } else if (prompt.includes('professional dubbing translator')) {
      const ids = [...prompt.split('INPUT CUES (JSON)')[1].matchAll(/"id": "(\d+)"/g)].map((m) => m[1]);
      answer = { translations: ids.map((id) => ({ id, translatedText: `লাইন ${id}।` })) };
    }
    return { response: { text: JSON.stringify(answer) }, modelUsed: 'fake' };
  };
  return { generate, prompts };
};

const ten = Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), startTime: i * 2, endTime: i * 2 + 2, text: `Line ${i + 1}.` }));

test('every part is told the brief, and the join between two parts is smoothed', async () => {
  const run = wholeRun({ seamLine: 'তাই লাইন ৬।' });
  const out = await translateCueTexts(ten, { targetLanguage: 'Bengali', batchSize: 5, generate: run.generate });
  const translatorPrompts = run.prompts.filter((p) => p.includes('professional dubbing translator'));
  assert.equal(translatorPrompts.length, 2);
  assert.ok(translatorPrompts.every((p) => /THE WHOLE TALK[\s\S]*Addressing the listener: আপনি/.test(p)));
  const seam = run.prompts.find((p) => p.includes('smoothing the join'));
  assert.match(seam, /"id": "6",\s*"join": true/);
  // Three cues before the join; after it only up to the middle of the five-cue part.
  assert.match(seam, /"id": "3"[\s\S]*"id": "7"/);
  assert.doesNotMatch(seam, /"id": "8"/);
  assert.equal(out.seamsFixed, 1);
  assert.equal(out.translations.get('6'), 'তাই লাইন ৬।');
  assert.deepEqual(out.brief, { about: 'A talk on stillness.', tone: 'warm', address: 'আপনি' });
});

test('a smoothed join the meaning review flags keeps its lines, and fast or one-part translations skip the pass', async () => {
  const flagged = wholeRun({ seamLine: 'অন্য কথা।', reviewSeam: { sentences: [{ ids: ['6'], problem: 'the line says something else' }] } });
  const out = await translateCueTexts(ten, { targetLanguage: 'Bengali', batchSize: 5, generate: flagged.generate });
  assert.equal(out.seamsFixed, 0);
  assert.equal(out.translations.get('6'), 'লাইন 6।');

  const fast = wholeRun({ seamLine: 'তাই লাইন ৬।' });
  await translateCueTexts(ten, { targetLanguage: 'Bengali', batchSize: 5, fast: true, generate: fast.generate });
  assert.ok(!fast.prompts.some((p) => p.includes('smoothing the join') || p.includes('preparing the glossary')));

  const one = wholeRun({ seamLine: 'তাই লাইন ৬।' });
  await translateCueTexts(ten, { targetLanguage: 'Bengali', batchSize: 40, generate: one.generate });
  assert.ok(!one.prompts.some((p) => p.includes('smoothing the join')));
});

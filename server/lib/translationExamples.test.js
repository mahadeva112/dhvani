import test from 'node:test';
import assert from 'node:assert/strict';
import { examplesBlock, EXAMPLE_LANGUAGES } from './translationExamples.js';
import { buildFixPrompt, buildMeaningFixPrompt } from './translationChecks.js';
import { translateCueTexts, writeEffort, reviewEffort } from '../providers/gemini/translation.js';
import { readFileSync } from 'node:fs';

/** The dub languages the app offers, read from the list in components/ProHeader.tsx (a component node cannot import). */
const DUB_LANGUAGES = (() => {
  const source = readFileSync(new URL('../../components/ProHeader.tsx', import.meta.url), 'utf8');
  const list = source.slice(source.indexOf('export const DEFAULT_LANGUAGES'));
  return [...list.slice(0, list.indexOf('];')).matchAll(/code: '([^']+)'/g)].map((m) => m[1]);
})();

/** Every cue-split line of a block, in order: [label, cue texts]. */
const lines = (block) =>
  block
    .split('\n')
    .filter((line) => /^(English|Not this|This): /.test(line))
    .map((line) => {
      const [label, rest] = line.split(/: (.*)/s);
      return [label, [...rest.matchAll(/"((?:[^"\\]|\\.)*)"(?: \||$)/g)].map((m) => m[1])];
    });

test('every language in the dub language list has worked examples', () => {
  assert.ok(DUB_LANGUAGES.length > 0, 'the list was read');
  for (const code of DUB_LANGUAGES) assert.ok(EXAMPLE_LANGUAGES.includes(code), code);
});

test('each example splits over as many cues as its English, and the wrong and right forms differ', () => {
  for (const language of EXAMPLE_LANGUAGES) {
    const block = examplesBlock(language);
    assert.match(block, new RegExp(`^EXAMPLES IN ${language.toUpperCase()}`));
    let english = null;
    for (const [label, cues] of lines(block)) {
      if (label === 'English') {
        english = cues;
        continue;
      }
      assert.equal(cues.length, english.length, `${language}: ${label} has ${cues.length} cue(s), the English ${english.length}`);
      assert.ok(cues.every((cue) => cue.trim()), `${language}: an empty cue`);
    }
    assert.ok(lines(block).filter(([label]) => label === 'Not this').length >= 3, language);
  }
});

test('an example adds no "and" the English does not have', () => {
  assert.doesNotMatch(examplesBlock('Hindi'), /This: "और/);
  assert.doesNotMatch(examplesBlock('Bengali'), /This: "আর/);
});

test('the Tamil examples are spoken Tamil, and say so', () => {
  const block = examplesBlock('Tamil');
  const right = lines(block).filter(([label]) => label === 'This').flatMap(([, cues]) => cues).join(' ');
  assert.match(block, /Use spoken Tamil/);
  assert.doesNotMatch(right, /நீங்கள்|உங்கள்|ால்[ ,]|ார்கள்/, 'no written forms in the right versions');
});

test('the Kannada examples are spoken Kannada, and say so', () => {
  const block = examplesBlock('Kannada');
  const right = lines(block).filter(([label]) => label === 'This').flatMap(([, cues]) => cues).join(' ');
  assert.match(block, /Use spoken Kannada/);
  assert.match(block, /ಕೆಮಿಸ್ಟ್ರಿ/, 'everyday English words stay English');
  assert.match(block, /\n4\. When a part moves[^\n]*\nEnglish: [^\n]*\nNot this: [^\n]*\nThis: /, 'the fourth example has its lesson and wrong form');
  assert.doesNotMatch(right, /ದರೆ|ತ್ತದೆ|ುತ್ತಾರೆ|ಕೊಳ್ಳು|ುವುದ/, 'no written forms in the right versions');
});

test('a language without examples gets none, and only the target language is shown', () => {
  assert.equal(examplesBlock('French'), '');
  assert.equal(examplesBlock(''), '');
  assert.doesNotMatch(examplesBlock('Tamil'), /[ऀ-ॿ]/, 'no Devanagari in the Tamil examples');
});

test('the fixes of a full translation see the same examples', () => {
  const cues = [{ id: '1', text: 'Hello.', syllables: 4 }];
  const translations = new Map([['1', 'வணக்கம்.']]);
  assert.match(buildFixPrompt({ cues, translations, issues: [], targetLanguage: 'Tamil' }), /EXAMPLES IN TAMIL/);
  assert.match(buildMeaningFixPrompt({ cues, translations, problems: [], targetLanguage: 'Tamil' }), /EXAMPLES IN TAMIL/);
  assert.doesNotMatch(buildFixPrompt({ cues, translations, issues: [], targetLanguage: 'French' }), /EXAMPLES IN/);
});

test('batches share one prompt start, with the examples in it and the batch itself at the end', async () => {
  const cues = Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), text: `Line ${i + 1}.`, startTime: i, endTime: i + 1 }));
  const calls = [];
  const generate = async ({ contents, effort }) => {
    const prompt = contents.parts[0].text;
    calls.push({ prompt, effort });
    const ids = [...prompt.split('INPUT CUES (JSON)')[1].matchAll(/"id": "(\d+)"/g)].map((m) => m[1]);
    return { response: { text: JSON.stringify({ translations: ids.map((id) => ({ id, translatedText: `வரி ${id}.` })) }) }, modelUsed: 'fake' };
  };
  await translateCueTexts(cues, { targetLanguage: 'Tamil', batchSize: 5, fast: true, generate });

  assert.equal(calls.length, 2);
  const [first, second] = calls.map(({ prompt }) => prompt);
  const start = (prompt) => prompt.slice(0, prompt.indexOf('THIS PART'));
  assert.equal(start(first), start(second), 'the same up to the batch');
  assert.match(start(first), /EXAMPLES IN TAMIL[\s\S]*HARD RULES/);
  assert.match(first, /THIS PART\nThis is part 1 of 2\./);
  assert.match(second, /THIS PART\nThis is part 2 of 2\./);
  assert.ok(first.indexOf('INPUT CUES') > first.indexOf('THIS PART'));
  assert.ok(calls.every(({ effort }) => effort === writeEffort()));
});

test('the meaning review thinks at least as much as the writing', () => {
  const order = [undefined, 'low', 'medium', 'high'];
  assert.ok(order.indexOf(reviewEffort()) >= order.indexOf(writeEffort()));
});

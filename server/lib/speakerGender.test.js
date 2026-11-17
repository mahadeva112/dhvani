import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSpeakerGenders, genderOfCue, speakerGenderRule } from './speakerGender.js';
import { buildGrammarPrompt } from './grammarCheck.js';
import { buildMeaningReviewPrompt } from './translationChecks.js';
import { translateCueTexts } from '../providers/gemini/translation.js';

test('only woman or man is kept for a speaker, by name', () => {
  assert.deepEqual(cleanSpeakerGenders({ Anita: 'woman', Host: 'man', Odd: 'female', '': 'man' }), { Anita: 'woman', Host: 'man', '': 'man' });
  assert.deepEqual(cleanSpeakerGenders(null), {});
  assert.deepEqual(cleanSpeakerGenders(['woman']), {});
  assert.equal(genderOfCue({ speaker: 'Anita' }, { Anita: 'woman' }), 'woman');
  assert.equal(genderOfCue({}, { Speaker: 'man' }), 'man');
  assert.equal(genderOfCue({ speaker: 'Raj' }, { Anita: 'woman' }), undefined);
  assert.equal(speakerGenderRule([{ id: '1' }], 'Hindi'), '');
  assert.match(speakerGenderRule([{ id: '1', speakerIs: 'woman' }], 'Hindi'), /WHO IS SPEAKING[\s\S]*feminine/);
});

/** A stand-in model for a fast translation that records what it was asked. */
const fastRun = () => {
  const prompts = [];
  const generate = async ({ contents }) => {
    const prompt = contents.parts[0].text;
    prompts.push(prompt);
    const ids = [...prompt.split('INPUT CUES (JSON)')[1].matchAll(/"id": "(\d+)"/g)].map((m) => m[1]);
    return { response: { text: JSON.stringify({ translations: ids.map((id) => ({ id, translatedText: `लाइन ${id}।` })) }) }, modelUsed: 'fake' };
  };
  return { generate, prompts };
};

const cues = [
  { id: '1', speaker: 'Anita', startTime: 0, endTime: 2, text: 'I went there last year.' },
  { id: '2', speaker: 'Raj', startTime: 2, endTime: 4, text: 'I was tired too.' },
];

test("the translator is told each speaker's gender, only for speakers who have one", async () => {
  const run = fastRun();
  await translateCueTexts(cues, { targetLanguage: 'Hindi', fast: true, speakerGenders: { Anita: 'woman' }, generate: run.generate });
  const prompt = run.prompts[0];
  assert.match(prompt, /WHO IS SPEAKING/);
  assert.match(prompt, /"id": "1",\s*"speaker": "woman"/);
  assert.doesNotMatch(prompt, /"id": "2",\s*"speaker"/);

  const none = fastRun();
  await translateCueTexts(cues, { targetLanguage: 'Hindi', fast: true, generate: none.generate });
  assert.doesNotMatch(none.prompts[0], /WHO IS SPEAKING|"speaker":/);
});

test('the meaning reviewer and the grammar check read the speaker too', () => {
  const review = buildMeaningReviewPrompt({ cues: [{ id: '1', text: 'I went.', speakerIs: 'woman' }], translations: new Map([['1', 'मैं गया।']]), targetLanguage: 'Hindi' });
  assert.match(review, /talks about themself in the wrong gender/);
  assert.match(review, /"speaker": "woman"/);
  assert.doesNotMatch(buildMeaningReviewPrompt({ cues: [{ id: '1', text: 'I went.' }], translations: new Map(), targetLanguage: 'Hindi' }), /wrong gender/);

  const grammar = buildGrammarPrompt({ lines: [{ id: '1', text: 'मैं गया', speaker: 'woman' }], language: 'Hindi' });
  assert.match(grammar, /Speaker's gender/);
  assert.match(grammar, /"speaker":"woman"/);
  assert.doesNotMatch(buildGrammarPrompt({ lines: [{ id: '1', text: 'मैं गया' }], language: 'Hindi' }), /Speaker's gender/);
});

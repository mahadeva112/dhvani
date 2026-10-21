import test from 'node:test';
import assert from 'node:assert/strict';
import { lengthUnits, cueIssues, isOutlier, mergeTerms, termsBlock, termIssues, buildFixPrompt, MAX_TERMS } from './translationChecks.js';
import { refineBatch, translateCueTexts } from '../providers/gemini/translation.js';
import { lineSyllables } from './syllables.js';

/** A Bengali line of exactly `n` syllables. */
const say = (n, end = '') => Array.from({ length: n }, () => 'কা').join(' ') + end;

test('say() makes lines of the asked length', () => {
  assert.equal(lineSyllables(say(7)), 7);
  assert.equal(lineSyllables(say(3, '।')), 3);
});

test('a tiny cue is judged together with the cue before it in the same sentence', () => {
  const cues = [
    { id: '1', text: 'Something will come and disrupt it in any kind of', syllables: 14 },
    { id: '2', text: 'situation.', syllables: 3 },
    { id: '3', text: 'So.', syllables: 2 },
    { id: '4', text: 'This is his message.', syllables: 8 },
  ];
  assert.deepEqual(lengthUnits(cues), [
    { ids: ['1', '2'], target: 17 },
    { ids: ['4'], target: 8 },
  ]);
  // The verb moved into the first cue: alone it runs 2 over, but the pair fits.
  const fits = new Map([['1', say(16)], ['2', say(1, '।')], ['3', say(1, '।')], ['4', say(8, '।')]]);
  assert.deepEqual(cueIssues(cues, fits), []);
  // Together they run long: one issue, naming both cues.
  const long = new Map([['1', say(16)], ['2', say(6, '।')], ['3', say(1, '।')], ['4', say(8, '।')]]);
  assert.deepEqual(cueIssues(cues, long), [{ id: '1', ids: ['1', '2'], kind: 'long', syllables: 22, target: 17 }]);
  const prompt = buildFixPrompt({ cues, translations: long, issues: cueIssues(cues, long), targetLanguage: 'Bengali' });
  assert.match(prompt, /ids 1, 2 together .*22 syllables, the voice has time for about 17 across them/);
});

test('a tiny cue that starts a sentence or follows an unsized cue is not judged', () => {
  const cues = [
    { id: '1', text: 'It ends here.', syllables: 8 },
    { id: '2', text: 'So,', syllables: 2 },
    { id: '3', text: 'no timing', syllables: null },
    { id: '4', text: 'yes', syllables: 2 },
  ];
  assert.deepEqual(lengthUnits(cues), [{ ids: ['1'], target: 8 }]);
  assert.deepEqual(cueIssues(cues, new Map([['1', say(8, '।')], ['2', say(6, ',')], ['3', 'x'], ['4', say(6)]])), []);
});

test('a batch is an outlier only when its extra syllables pass 15% of its budget', () => {
  const cues = [
    { id: '1', text: 'one line', syllables: 10 },
    { id: '2', text: 'another line', syllables: 10 },
  ];
  assert.equal(isOutlier(cues, new Map([['1', say(13)], ['2', say(9)]])), false); // 3 over of 20
  assert.equal(isOutlier(cues, new Map([['1', say(14)], ['2', say(10)]])), true); // 4 over of 20
  assert.equal(isOutlier([{ id: '1', text: 'x', syllables: null }], new Map([['1', say(40)]])), false);
});

test('key terms are kept once each, only when the lines really use them, and capped', () => {
  const lines = new Map([['1', 'জড়তা বসতে দিলে'], ['2', 'উচ্ছ্বাস জীবনের স্বভাব']]);
  let terms = mergeTerms([], [{ english: 'inertia', translated: 'জড়তা' }, { english: 'exuberance', translated: 'প্রাণোচ্ছ্বাস' }, { english: '', translated: 'x' }], lines);
  assert.deepEqual(terms, [{ english: 'inertia', translated: 'জড়তা' }]);
  terms = mergeTerms(terms, [{ english: 'Inertia', translated: 'উচ্ছ্বাস' }, { english: 'exuberance', translated: 'উচ্ছ্বাস' }], lines);
  assert.deepEqual(terms, [{ english: 'inertia', translated: 'জড়তা' }, { english: 'exuberance', translated: 'উচ্ছ্বাস' }]);
  assert.deepEqual(mergeTerms(terms, 'nonsense', lines), terms);
  const many = Array.from({ length: 50 }, (_, i) => ({ english: `t${i}`, translated: 'জড়তা' }));
  assert.equal(mergeTerms([], many, lines).length, MAX_TERMS);
  assert.equal(termsBlock([]), '');
  assert.match(termsBlock(terms), /KEY TERMS SO FAR[\s\S]*- inertia → জড়তা/);
});

const pair = [
  { id: '1', text: 'one line', syllables: 10 },
  { id: '2', text: 'another line', syllables: 10 },
];

test('cues still long after the first length fix go back once more, and only they', async () => {
  const prompts = [];
  const answers = [
    { sentences: [] },
    { translations: [{ id: '1', translatedText: say(16) }, { id: '2', translatedText: say(10) }] },
    { translations: [{ id: '1', translatedText: say(11) }] },
  ];
  const ask = async (prompt) => {
    prompts.push(prompt);
    return answers.shift();
  };
  const out = await refineBatch(pair, new Map([['1', say(20)], ['2', say(16)]]), { targetLanguage: 'Bengali', ask });
  assert.equal(prompts.length, 3);
  assert.match(prompts[1], /- id 1: 20 syllables[\s\S]*- id 2: 16 syllables/);
  assert.match(prompts[2], /- id 1: 16 syllables/);
  assert.doesNotMatch(prompts[2].split('CUES (JSON)')[0], /- id 2:/);
  assert.equal(out.lengthFixed, 3);
  assert.equal(lineSyllables(out.translations.get('1')), 11);
});

/** A stand-in text model that answers each kind of prompt from a script. */
const fakeModel = (onTranslate) => {
  const prompts = [];
  const generate = async ({ contents }) => {
    const prompt = contents.parts[0].text;
    prompts.push(prompt);
    let answer;
    if (prompt.includes('professional dubbing translator')) answer = onTranslate(prompt, prompts.filter((p) => p.includes('professional dubbing translator')).length);
    else if (prompt.includes('strict reviewer')) answer = { sentences: [] };
    else answer = { translations: [] }; // length fixes change nothing
    return { response: { text: typeof answer === 'string' ? answer : JSON.stringify(answer) }, modelUsed: 'fake' };
  };
  return { generate, prompts };
};

const timed = [
  { id: '1', startTime: 0, endTime: 2, text: 'If you allow inertia to set in,' },
  { id: '2', startTime: 2, endTime: 4, text: 'you allow death to come early.' },
];

test('a batch far too long after its checks is translated once more, and the better version is kept', async () => {
  const { generate, prompts } = fakeModel((prompt, call) => ({
    translations: [
      { id: '1', translatedText: say(call === 1 ? 18 : 11) },
      { id: '2', translatedText: say(10, '।') },
    ],
  }));
  const out = await translateCueTexts(timed, { targetLanguage: 'Bengali', voiceRate: 5, generate });
  assert.equal(prompts.filter((p) => p.includes('professional dubbing translator')).length, 2);
  assert.equal(out.retriedBatches, 1);
  assert.equal(lineSyllables(out.translations.get('1')), 11);

  // A retry that comes back worse is dropped.
  const worse = fakeModel((prompt, call) => ({
    translations: [
      { id: '1', translatedText: say(call === 1 ? 18 : 30) },
      { id: '2', translatedText: say(10, '।') },
    ],
  }));
  const kept = await translateCueTexts(timed, { targetLanguage: 'Bengali', voiceRate: 5, generate: worse.generate });
  assert.equal(lineSyllables(kept.translations.get('1')), 18);

  // A batch that fits is never translated twice.
  const fine = fakeModel(() => ({ translations: [{ id: '1', translatedText: say(10) }, { id: '2', translatedText: say(10, '।') }] }));
  const once = await translateCueTexts(timed, { targetLanguage: 'Bengali', voiceRate: 5, generate: fine.generate });
  assert.equal(fine.prompts.filter((p) => p.includes('professional dubbing translator')).length, 1);
  assert.equal(once.retriedBatches, 0);
});

test('later batches are told how earlier ones said the key terms', async () => {
  const cues = Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), startTime: i * 2, endTime: i * 2 + 2, text: i === 7 ? 'Inertia is settled.' : 'line' }));
  const { generate, prompts } = fakeModel((prompt) => {
    const ids = [...prompt.matchAll(/"id": "(\d+)"/g)].map((m) => m[1]);
    return {
      translations: ids.map((id) => ({ id, translatedText: id === '2' ? 'জড়তা বসে' : say(10) })),
      terms: [{ english: 'inertia', translated: 'জড়তা' }],
    };
  });
  const out = await translateCueTexts(cues, { targetLanguage: 'Bengali', voiceRate: 5, batchSize: 5, generate });
  const translatePrompts = prompts.filter((p) => p.includes('professional dubbing translator'));
  assert.equal(translatePrompts.length, 2);
  assert.doesNotMatch(translatePrompts[0], /KEY TERMS SO FAR/);
  assert.match(translatePrompts[1], /KEY TERMS SO FAR[\s\S]*- inertia → জড়তা/);
  assert.deepEqual(out.terms, [{ english: 'inertia', translated: 'জড়তা' }]);
});

test('a key term said with another word is found; its inflected forms are not', () => {
  const cues = [
    { id: '1', text: 'If you allow inertia to set in,' },
    { id: '2', text: 'Inertia is 100% settled.' },
    { id: '3', text: 'Inertial frames are another thing.' },
  ];
  const terms = [{ english: 'inertia', translated: 'ਜੜਤਾ' }];
  const lines = new Map([['1', 'ਜੇ ਤੁਸੀਂ ਆਪਣੇ ਅੰਦਰ ਸੁਸਤੀ ਆਉਣ ਦਿੰਦੇ ਹੋ,'], ['2', 'ਜੜਤਾ ਪੂਰੀ ਹੋਵੇਗੀ।'], ['3', 'ਹੋਰ ਗੱਲ']]);
  assert.deepEqual(termIssues(cues, lines, terms), [{ id: '1', kind: 'term', english: 'inertia', translated: 'ਜੜਤਾ' }]);
  const bengali = new Map([['1', 'আপনি যদি জড়তাকে ঢুকতে দেন,'], ['2', 'জড়তা পুরো।'], ['3', 'অন্য কথা']]);
  assert.deepEqual(termIssues(cues, bengali, [{ english: 'inertia', translated: 'জড়তা' }]), []);
  assert.deepEqual(termIssues(cues, lines, []), []);
});

test('refineBatch asks for the listed word where a key term was said another way', async () => {
  const cues = [
    { id: '1', text: 'If you allow inertia to set in,', syllables: 12 },
    { id: '2', text: 'inertia settles.', syllables: 6 },
  ];
  const prompts = [];
  const answers = [{ sentences: [] }, { translations: [{ id: '1', translatedText: 'ਜੇ ਤੁਸੀਂ ਅੰਦਰ ਜੜਤਾ ਆਉਣ ਦਿਓ,' }] }];
  const ask = async (prompt) => {
    prompts.push(prompt);
    return answers.shift();
  };
  const start = new Map([['1', 'ਜੇ ਤੁਸੀਂ ਅੰਦਰ ਸੁਸਤੀ ਆਉਣ ਦਿਓ,'], ['2', 'ਜੜਤਾ ਟਿਕ ਜਾਂਦੀ।']]);
  const out = await refineBatch(cues, start, { targetLanguage: 'Punjabi', terms: [{ english: 'inertia', translated: 'ਜੜਤਾ' }], ask });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /- id 1: the key term "inertia" is said as "ਜੜਤਾ"/);
  assert.equal(out.termsFixed, 1);
  assert.equal(out.translations.get('1'), 'ਜੇ ਤੁਸੀਂ ਅੰਦਰ ਜੜਤਾ ਆਉਣ ਦਿਓ,');
});

test('a batch that comes back as broken JSON is asked for once more', async () => {
  const good = { translations: [{ id: '1', translatedText: say(10) }, { id: '2', translatedText: say(10, '।') }] };
  const once = fakeModel((prompt, call) => (call === 1 ? '{"translations":[{"id":"1","transl' : good));
  const out = await translateCueTexts(timed, { targetLanguage: 'Bengali', voiceRate: 5, generate: once.generate });
  assert.equal(once.prompts.filter((p) => p.includes('professional dubbing translator')).length, 2);
  assert.equal(lineSyllables(out.translations.get('1')), 10);

  // Broken twice: a one-batch translation still fails, as before.
  const twice = fakeModel(() => 'not json at all');
  await assert.rejects(translateCueTexts(timed, { targetLanguage: 'Bengali', voiceRate: 5, generate: twice.generate }), { code: 'bad_model_output' });
  assert.equal(twice.prompts.length, 2);
});

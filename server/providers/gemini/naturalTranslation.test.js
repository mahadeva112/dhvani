import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNaturalUnits, cutPiece, cutUnit, readNaturalLine, naturalIssues, translateNatural } from './naturalTranslation.js';
import { reviewEffort, writeEffort } from './translation.js';

/** A cue whose words are spread evenly over its time. */
const cue = (id, text, startTime, endTime, extra = {}) => {
  const list = text.split(' ');
  const step = (endTime - startTime) / list.length;
  return {
    id,
    text,
    startTime,
    endTime,
    speaker: 'Speaker 1',
    words: list.map((w, i) => ({ text: w, start: startTime + i * step, end: startTime + (i + 1) * step - 0.02 })),
    ...extra,
  };
};

const talk = [
  cue('c1', 'This one way of', 90.34, 91.34),
  cue('c2', 'handling', 91.5, 92.68),
  cue('c3', 'the fear and the resistance that you have.', 93.94, 97.02),
  cue('c4', 'Another way is', 98.94, 99.92),
  cue('c5', 'you know some mantra.', 100.1, 101.92),
];

test('cues are joined until the English sentence ends, and every pause of 0.3 s or more is a stop', () => {
  const units = buildNaturalUnits(talk);
  assert.deepEqual(units.map((u) => u.cues.map((c) => c.id)), [['c1', 'c2', 'c3'], ['c4', 'c5']]);
  const [first, second] = units;
  // 91.34 → 91.5 is 0.16 s (no stop); 92.68 → 93.94 is 1.26 s (a stop).
  assert.equal(first.pauses.length, 1);
  assert.equal(first.pausedText, 'This one way of handling ‖ the fear and the resistance that you have.');
  assert.equal(second.pauses.length, 0);
  assert.equal(second.pausedText, undefined);
});

test('a sentence is not joined across a long pause or a new speaker', () => {
  const units = buildNaturalUnits([cue('a', 'If you', 0, 0.5), cue('b', 'really want it.', 4, 5), cue('c', 'and then', 5.2, 6), cue('d', 'go.', 6.1, 6.5, { speaker: 'Speaker 2' })]);
  assert.deepEqual(units.map((u) => u.cues.map((c) => c.id)), [['a'], ['b'], ['c'], ['d']]);
});

test('a piece is cut over its cues by speaking time, at a nearby comma, and every cue gets a word', () => {
  const cut = cutPiece('यह उस डर और हिचक से, निपटने का एक तरीका है', [
    { index: 0, talk: 1 },
    { index: 1, talk: 0.6 },
  ]);
  assert.equal(cut.length, 2);
  assert.equal(cut.map(([, t]) => t).join(' '), 'यह उस डर और हिचक से, निपटने का एक तरीका है');
  assert.ok(cut[0][1].endsWith('से,'), cut[0][1]);
  assert.ok(cut.every(([, t]) => t.length > 0));
});

test('a sentence goes back onto its cues at its stop marks, words unchanged', () => {
  const [unit] = buildNaturalUnits(talk);
  const line = 'यह उस डर और हिचक से निपटने का ‖ एक तरीका है जो आपको होती है।';
  const { lines, paused } = cutUnit(unit, line);
  assert.equal(lines.length, 3);
  assert.ok(lines.every(Boolean));
  assert.equal(lines.join(' '), line.replace(' ‖', ''));
  // The stop falls between c2 and c3, so c3 starts with what came after the mark.
  assert.equal(lines[2], 'एक तरीका है जो आपको होती है।');
  assert.deepEqual(paused, [null, null, null]);
});

test('the English shows every line break, a long stop as ‖ and a run-on line end as ¦', () => {
  const [first] = buildNaturalUnits(talk);
  assert.deepEqual(first.breaks, ['¦', '‖']);
  assert.equal(first.markedText, 'This one way of ¦ handling ‖ the fear and the resistance that you have.');
});

test('a line with the same marks as the English is cut where the model put them', () => {
  const [unit] = buildNaturalUnits(talk);
  const { lines } = cutUnit(unit, 'यह उस डर और हिचक ¦ से निपटने का ‖ एक तरीका है जो आपको होती है।');
  assert.deepEqual(lines, ['यह उस डर और हिचक', 'से निपटने का', 'एक तरीका है जो आपको होती है।']);
  // Marks in another order fall back to the stop marks and speaking time.
  const fallback = cutUnit(unit, 'यह उस डर और हिचक ‖ से निपटने का ¦ एक तरीका है जो आपको होती है।');
  assert.ok(fallback.lines.every(Boolean));
  assert.ok(fallback.lines.every((l) => !/[‖¦]/.test(l)));
});

test('a line that lost its stop marks is cut by speaking time over all the cues', () => {
  const [unit] = buildNaturalUnits(talk);
  const { lines } = cutUnit(unit, 'यह उस डर और हिचक से निपटने का एक तरीका है जो आपको होती है।');
  assert.equal(lines.length, 3);
  assert.ok(lines.every(Boolean));
  assert.equal(lines.join(' '), 'यह उस डर और हिचक से निपटने का एक तरीका है जो आपको होती है।');
});

test('a stop inside one cue becomes a pause mark for the voice only', () => {
  const one = { ...cue('x', 'So I went there and sat.', 0, 4), words: [
    { text: 'So', start: 0, end: 0.2 }, { text: 'I', start: 0.25, end: 0.3 }, { text: 'went', start: 0.35, end: 0.6 }, { text: 'there', start: 0.65, end: 1 },
    { text: 'and', start: 2.5, end: 2.7 }, { text: 'sat.', start: 2.75, end: 3.2 },
  ] };
  const [unit] = buildNaturalUnits([one]);
  assert.equal(unit.pauses.length, 1);
  const { lines, paused } = cutUnit(unit, 'तो मैं वहाँ गया ‖ और बैठ गया।');
  assert.equal(lines[0], 'तो मैं वहाँ गया और बैठ गया।');
  assert.equal(paused[0], 'तो मैं वहाँ गया [pause 1.5s] और बैठ गया।');
});

test('a short breath inside a cue (0.3 s or more) is a stop too, so Sync can cut the dub there', () => {
  const one = { ...cue('y', 'But these are great beings and, uh, being here and', 0, 4), words: [
    { text: 'But', start: 0.3, end: 0.5 }, { text: 'these', start: 0.55, end: 0.8 }, { text: 'are', start: 0.85, end: 1 }, { text: 'great', start: 1.05, end: 1.4 },
    { text: 'beings', start: 1.45, end: 1.9 }, { text: 'and,', start: 1.95, end: 2.2 }, { text: 'uh,', start: 2.3, end: 2.6 },
    { text: 'being', start: 3.1, end: 3.4 }, { text: 'here', start: 3.45, end: 3.7 }, { text: 'and', start: 3.75, end: 4.06 },
  ] };
  const [unit] = buildNaturalUnits([one]);
  assert.deepEqual(unit.pauses.map((p) => +p.toFixed(1)), [0.5]);
  assert.equal(unit.markedText, 'But these are great beings and, uh, ‖ being here and');
  const { lines, paused } = cutUnit(unit, 'लेकिन ये महान विभूतियाँ हैं और, ‖ यहाँ आकर,');
  assert.equal(lines[0], 'लेकिन ये महान विभूतियाँ हैं और, यहाँ आकर,');
  assert.equal(paused[0], 'लेकिन ये महान विभूतियाँ हैं और, [pause 0.5s] यहाँ आकर,');
  // A gap under 0.3 s is no stop.
  const [smooth] = buildNaturalUnits([{ ...one, words: one.words.map((w, i) => (i >= 7 ? { ...w, start: w.start - 0.25, end: w.end - 0.25 } : w)) }]);
  assert.equal(smooth.pauses.length, 0);
});

test('split is kept only when it has the same words as natural', () => {
  assert.equal(readNaturalLine({ natural: 'एक दो तीन', split: 'एक ‖ दो तीन' }), 'एक ‖ दो तीन');
  assert.equal(readNaturalLine({ natural: 'एक दो तीन', split: 'एक ‖ चार तीन' }), 'एक दो तीन');
  assert.equal(readNaturalLine({ natural: '', split: 'एक ‖ दो' }), 'एक ‖ दो');
});

test('a wrong number of stop marks is an issue', () => {
  const [unit] = buildNaturalUnits(talk);
  const issues = naturalIssues([unit], new Map([[unit.id, 'यह एक तरीका है।']]));
  assert.ok(issues.some((i) => i.kind === 'pauses' && i.want === 1 && i.have === 0));
});

test('translateNatural writes whole sentences, checks them and cuts them back onto every cue', async () => {
  const calls = [];
  const generate = async ({ contents }) => {
    const prompt = contents.parts[0].text;
    calls.push(prompt);
    let body;
    if (prompt.includes('INPUT SENTENCES')) {
      body = {
        sentences: [
          { id: 'n-1', natural: 'यह उस डर और हिचक से निपटने का एक तरीका है जो आपको होती है।', split: 'यह उस डर और हिचक से निपटने का ‖ एक तरीका है जो आपको होती है।' },
          { id: 'n-2', natural: 'दूसरा तरीका, कोई मंत्र आता हो।', split: 'दूसरा तरीका, कोई मंत्र आता हो।' },
        ],
        terms: [],
      };
    } else if (prompt.includes('strict reviewer')) {
      body = { sentences: [{ ids: ['n-1'], problem: '', englishShaped: '' }, { ids: ['n-2'], problem: '', englishShaped: '' }] };
    } else {
      body = { translations: [] };
    }
    return { response: { text: JSON.stringify(body) }, modelUsed: 'test-model' };
  };
  const out = await translateNatural(talk, { targetLanguage: 'Hindi', voiceRate: 5.8, generate });
  assert.equal(out.translations.size, 5);
  assert.deepEqual(out.missingIds, []);
  assert.equal(out.translations.get('c3'), 'एक तरीका है जो आपको होती है।');
  assert.equal(out.modelUsed, 'test-model');
  assert.equal(out.units.length, 2);
  // Timings never reach the model.
  assert.ok(calls.every((p) => !/90\.34|startTime|endTime/.test(p)));
});

test('the checks think at low effort and the fix call reads only the sentences it has to change', async () => {
  const calls = [];
  const generate = async ({ contents, effort }) => {
    const prompt = contents.parts[0].text;
    let body;
    if (prompt.includes('INPUT SENTENCES')) {
      calls.push({ kind: 'write', effort });
      assert.ok(prompt.includes('never inside a pair joined by'));
      body = {
        sentences: [
          { id: 'n-1', natural: 'यह उस डर और हिचक से निपटने का एक तरीका है जो आपको होती है।', split: 'यह उस डर और हिचक से ¦ निपटने का ‖ एक तरीका है जो आपको होती है।' },
          { id: 'n-2', natural: 'दूसरा तरीका, कोई मंत्र आता हो।', split: 'दूसरा तरीका, ¦ कोई मंत्र आता हो।' },
        ],
        terms: [],
      };
    } else if (prompt.includes('strict reviewer')) {
      calls.push({ kind: 'review', effort });
      body = { sentences: [{ ids: ['n-1'], problem: '', englishShaped: '' }, { ids: ['n-2'], problem: '"Another way" lost "is"', englishShaped: '' }] };
    } else {
      calls.push({ kind: 'fix', effort, prompt });
      body = { translations: [{ id: 'n-2', translatedText: 'दूसरा तरीका है, ¦ कोई मंत्र आता हो।' }] };
    }
    return { response: { text: JSON.stringify(body) }, modelUsed: 'test-model' };
  };
  const out = await translateNatural(talk, { targetLanguage: 'Hindi', voiceRate: 5.8, generate });
  assert.equal(calls.find((c) => c.kind === 'review').effort, 'low');
  const fix = calls.find((c) => c.kind === 'fix');
  assert.equal(fix.effort, 'low');
  const sent = JSON.parse(fix.prompt.slice(fix.prompt.indexOf('CUES (JSON):') + 12, fix.prompt.indexOf('Respond with ONLY')));
  const listed = fix.prompt.slice(fix.prompt.indexOf('FIX THESE CUES'), fix.prompt.indexOf('RULES'));
  assert.ok(sent.some((row) => row.id === 'n-2'));
  assert.ok(sent.every((row) => listed.includes(`id ${row.id}`)), 'only flagged sentences are sent to the fix call');
  assert.equal(out.translations.get('c4'), 'दूसरा तरीका है,');
  // The fix call is told what "¦" means and sees it in the English too.
  assert.ok(fix.prompt.includes('A "¦" is where one subtitle line ends'));
  assert.ok(fix.prompt.includes('never inside a pair joined by'));
  assert.equal(sent.find((row) => row.id === 'n-2').english, 'Another way is ¦ you know some mantra.');
});

test('the glossary keeps only terms the talk says more than once', async () => {
  const { termsThatComeBack } = await import('./translation.js');
  const cues = [{ text: 'He feeds the ghosts every amavasya.' }, { text: 'Not one ghost came out, in a shrine like place.' }, { text: 'Amavasya after amavasya.' }];
  const kept = termsThatComeBack(
    [
      { english: 'ghost', translated: 'ভূত' },
      { english: 'Amavasya', translated: 'অমাবস্যা' },
      { english: 'shrine', translated: 'মাজার' },
    ],
    cues
  );
  assert.deepEqual(kept.map((t) => t.english), ['ghost', 'Amavasya']);
});

test('quick (Fast translate) writes like Natural with no glossary or meaning review, and only fixes a bookish word', async () => {
  // Twelve one-sentence cues: three batches, so the full mode would read a glossary first.
  const cues = Array.from({ length: 12 }, (_, i) => cue(`q${i + 1}`, `Sentence number ${i + 1} is here.`, i * 3, i * 3 + 2));
  const prompts = [];
  const generate = async ({ contents }) => {
    const prompt = contents.parts[0].text;
    prompts.push(prompt);
    if (prompt.includes('INPUT SENTENCES')) {
      const ids = [...prompt.split('INPUT SENTENCES')[1].matchAll(/"id": "([^"]+)"/g)].map((m) => m[1]);
      const sentences = ids.map((id) => ({ id, natural: id === 'n-1' ? 'তাহার কথা।' : 'ওর কথা।' }));
      return { response: { text: JSON.stringify({ sentences }) }, modelUsed: 'fake' };
    }
    const ids = [...prompt.matchAll(/"id": "([^"]+)"/g)].map((m) => m[1]);
    return { response: { text: JSON.stringify({ translations: ids.filter((id) => id === 'n-1').map((id) => ({ id, translatedText: 'তার কথা।' })) }) }, modelUsed: 'fake' };
  };
  const out = await translateNatural(cues, { targetLanguage: 'Bengali', generate, quick: true });
  assert.ok(!prompts.some((p) => p.includes('preparing the glossary')), 'no glossary');
  assert.ok(!prompts.some((p) => p.includes('strict reviewer')), 'no meaning review');
  const fixes = prompts.filter((p) => !p.includes('INPUT SENTENCES'));
  assert.equal(fixes.length, 1, 'one fix call, for the batch with the bookish word');
  assert.match(fixes[0], /"তাহার" is a written, bookish word/);
  assert.equal(out.translations.get('q1'), 'তার কথা।');
  assert.equal(out.translations.size, 12);
});

test('a "¦" inside a pair moves so the whole pair sits on one line, words unchanged', async () => {
  const { mendLineSplits } = await import('./naturalTranslation.js');
  // Malayalam marks "fear and resistance" on both words.
  assert.equal(
    mendLineSplits('അങ്ങനെ ചെയ്യുമ്പോഴുള്ള പേടിയും ¦ എതിർപ്പും മാറ്റാൻ ‖ ഇതൊരു വഴിയാണ്.'),
    'അങ്ങനെ ചെയ്യുമ്പോഴുള്ള ¦ പേടിയും എതിർപ്പും മാറ്റാൻ ‖ ഇതൊരു വഴിയാണ്.'
  );
  // A line never ends on "and".
  assert.equal(mendLineSplits('तुमची भीती आणि ¦ विरोध हाताळण्याचा मार्ग'), 'तुमची भीती ¦ आणि विरोध हाताळण्याचा मार्ग');
  // A "¦" between whole phrases stays, and a line keeps at least one word of its own.
  assert.equal(mendLineSplits('"ശിവ" എന്ന് പറഞ്ഞ് ¦ നടക്കുക.'), '"ശിവ" എന്ന് പറഞ്ഞ് ¦ നടക്കുക.');
  assert.equal(mendLineSplits('ഇതാണ് ‖ പേടിയും ¦ എതിർപ്പും.'), 'ഇതാണ് ‖ പേടിയും ¦ എതിർപ്പും.');
});

test('a whole sentence is sent back for length only from three syllables over', async () => {
  const { NATURAL_LONG_MIN } = await import('./naturalTranslation.js');
  assert.equal(NATURAL_LONG_MIN, 3);
  const unit = { id: 'n-1', text: 'Some god you believe in.', syllables: 7, pauses: [], cues: [] };
  const over = (n) => naturalIssues([unit], new Map([['n-1', `${Array(n).fill('का').join(' ')}।`]])).filter((i) => i.kind === 'long');
  assert.equal(over(9).length, 0, 'two over is left alone');
  assert.equal(over(10).length, 1, 'three over is fixed');
});

test('a fix the second read finds more wrong than before goes back to how it was written', async () => {
  let reviews = 0;
  const generate = async ({ contents }) => {
    const prompt = contents.parts[0].text;
    let body;
    if (prompt.includes('INPUT SENTENCES')) {
      body = {
        sentences: [
          { id: 'n-1', natural: 'यह उस डर और हिचक से निपटने का एक तरीका है जो आपको होती है।', split: 'यह उस डर और हिचक से ¦ निपटने का ‖ एक तरीका है जो आपको होती है।' },
          { id: 'n-2', natural: 'दूसरा तरीका, कोई मंत्र आता हो।', split: 'दूसरा तरीका, ¦ कोई मंत्र आता हो।' },
        ],
        terms: [],
      };
    } else if (prompt.includes('strict reviewer')) {
      reviews += 1;
      body =
        reviews === 1
          ? { sentences: [{ ids: ['n-1'], problem: '"have" became "feel"', words: [{ english: 'have', translatedAs: 'feel', same: false }] }, { ids: ['n-2'], problem: '' }] }
          : { sentences: [{ ids: ['n-1'], problem: '"fear" and "have" are missing', words: [{ english: 'fear', translatedAs: '', same: false }, { english: 'have', translatedAs: '', same: false }] }, { ids: ['n-2'], problem: '' }] };
    } else {
      assert.ok(prompt.includes('never drops "gave"'), 'the fix keeps every word of a short sentence');
      assert.ok(prompt.includes('a dargah or a mazar'), 'the fix keeps the picture');
      body = { translations: [{ id: 'n-1', translatedText: 'यह उस हिचक से ¦ निपटने का ‖ एक तरीका है जो आपको होती है।' }] };
    }
    return { response: { text: JSON.stringify(body) }, modelUsed: 'test-model' };
  };
  const out = await translateNatural(talk, { targetLanguage: 'Hindi', voiceRate: 5.8, generate });
  assert.equal(reviews, 2, 'the fixed batch is read a second time');
  assert.equal(out.reverted, 1);
  assert.equal(out.fixed, 0);
  assert.equal(out.translations.get('c1'), 'यह उस डर और हिचक से');
});

test('thorough (Full translate) checks at full effort, puts spoken words before length and fixes bookish words the review hears', async () => {
  const calls = [];
  const generate = async ({ contents, effort }) => {
    const prompt = contents.parts[0].text;
    let body;
    if (prompt.includes('INPUT SENTENCES')) {
      calls.push({ kind: 'write', effort, prompt });
      body = {
        sentences: [
          { id: 'n-1', natural: 'এটা সেই ভয় আর বাধা সামলানোর একটা উপায় যা আপনার আছে।', split: 'এটা সেই ভয় আর বাধা ¦ সামলানোর ‖ একটা উপায় যা আপনার আছে।' },
          { id: 'n-2', natural: 'আরেকটা উপায়, কোনো মন্ত্র আবশ্যক।', split: 'আরেকটা উপায়, ¦ কোনো মন্ত্র আবশ্যক।' },
        ],
        terms: [],
      };
    } else if (prompt.includes('strict reviewer')) {
      calls.push({ kind: 'review', effort, prompt });
      body = { sentences: [{ ids: ['n-1'], problem: '' }, { ids: ['n-2'], problem: '', bookish: [{ word: 'আবশ্যক', say: 'লাগে' }, { word: 'নেই-এমন', say: 'x' }] }] };
    } else {
      calls.push({ kind: 'fix', effort, prompt });
      body = { translations: [{ id: 'n-2', translatedText: 'আরেকটা উপায়, ¦ কোনো একটা মন্ত্র লাগে।' }] };
    }
    return { response: { text: JSON.stringify(body) }, modelUsed: 'test-model' };
  };
  const out = await translateNatural(talk, { targetLanguage: 'Bengali', voiceRate: 5.8, generate, thorough: true });
  const write = calls.find((c) => c.kind === 'write');
  assert.ok(write.prompt.includes('the meaning comes first and spoken words second'));
  assert.ok(!write.prompt.includes('a little under is better than over'));
  const review = calls.find((c) => c.kind === 'review');
  // The app's own effort (Settings), whatever it is set to here or in CI.
  assert.equal(review.effort, reviewEffort());
  assert.ok(review.prompt.includes('"bookish"'));
  const fix = calls.find((c) => c.kind === 'fix');
  assert.equal(fix.effort, writeEffort());
  assert.match(fix.prompt, /"আবশ্যক" is a written, bookish word/);
  assert.ok(!fix.prompt.includes('নেই-এমন'), 'a word the line does not have is never sent');
  assert.equal(out.heard, 1);
  assert.equal(out.translations.get('c5'), 'কোনো একটা মন্ত্র লাগে।');
});

test('a fix that brings in a listed bookish word is not kept', async () => {
  const generate = async ({ contents }) => {
    const prompt = contents.parts[0].text;
    let body;
    if (prompt.includes('INPUT SENTENCES')) {
      body = { sentences: [{ id: 'n-1', natural: 'এটা একটা উপায়।' }, { id: 'n-2', natural: 'আরেকটা উপায় মন্ত্র।' }], terms: [] };
    } else if (prompt.includes('strict reviewer')) {
      body = { sentences: [{ ids: ['n-1'], problem: '' }, { ids: ['n-2'], problem: '"you know" is missing' }] };
    } else {
      body = { translations: [{ id: 'n-2', translatedText: 'আরেকটা উপায় হইল মন্ত্র।' }] };
    }
    return { response: { text: JSON.stringify(body) }, modelUsed: 'test-model' };
  };
  const out = await translateNatural(talk, { targetLanguage: 'Bengali', voiceRate: 5.8, generate, thorough: true });
  assert.ok(![...out.translations.values()].some((line) => line.includes('হইল')));
});

test('Full carries on after a restart from the sentences it saved, and saves after every batch', async () => {
  const cues = Array.from({ length: 12 }, (_, i) => cue(`r${i + 1}`, `Sentence number ${i + 1} is here.`, i * 3, i * 3 + 2));
  const prompts = [];
  const generate = async ({ contents }) => {
    const prompt = contents.parts[0].text;
    prompts.push(prompt);
    if (prompt.includes('INPUT SENTENCES')) {
      const ids = [...prompt.split('INPUT SENTENCES')[1].matchAll(/"id": "([^"]+)"/g)].map((m) => m[1]);
      return { response: { text: JSON.stringify({ sentences: ids.map((id) => ({ id, natural: `নতুন ${id}।` })) }) }, modelUsed: 'fake' };
    }
    return { response: { text: JSON.stringify({ sentences: [], translations: [], terms: [] }) }, modelUsed: 'fake' };
  };
  const saved = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`n-${i + 1}`, `পুরোনো ${i + 1}।`]));
  const all = await translateNatural(cues, { targetLanguage: 'Bengali', generate, thorough: true, resumeFrom: { translations: saved, terms: [], brief: null, modelUsed: 'fake' } });
  assert.equal(prompts.length, 0, 'nothing is asked again when every sentence was saved');
  assert.equal(all.translations.get('r3'), 'পুরোনো 3।');

  const heard = [];
  const fresh = await translateNatural(cues, { targetLanguage: 'Bengali', generate, thorough: true, onBatchDone: (p) => heard.push(p.translations.size) });
  assert.equal(fresh.translations.size, 12);
  assert.ok(heard.length >= 2 && heard.at(-1) === 12, 'saved after every batch');
});

test('Full reviews the lines with their marks and sends a sentence with an idea in another line back', async () => {
  const calls = [];
  const generate = async ({ contents }) => {
    const prompt = contents.parts[0].text;
    let body;
    if (prompt.includes('INPUT SENTENCES')) {
      calls.push({ kind: 'write', prompt });
      body = {
        sentences: [
          { id: 'n-1', natural: 'এটা ভয় আর বাধা সামলানোর একটা উপায় যা আপনার আছে।', split: 'এটা ভয় আর বাধা ¦ সামলানোর ‖ একটা উপায় যা আপনার আছে।' },
          { id: 'n-2', natural: 'কোনো মন্ত্র জানা থাকলে, আরেকটা উপায়।', split: 'কোনো মন্ত্র জানা থাকলে, ¦ আরেকটা উপায়।' },
        ],
        terms: [],
      };
    } else if (prompt.includes('strict reviewer')) {
      calls.push({ kind: 'review', prompt });
      body = { sentences: [{ ids: ['n-1'], problem: '', offLine: '' }, { ids: ['n-2'], problem: '', offLine: '"Another way" is said in the second piece' }] };
    } else {
      calls.push({ kind: 'fix', prompt });
      body = { translations: [{ id: 'n-2', translatedText: 'আরেকটা উপায়, ¦ কোনো মন্ত্র জানা থাকলে।' }] };
    }
    return { response: { text: JSON.stringify(body) }, modelUsed: 'test-model' };
  };
  const out = await translateNatural(talk, { targetLanguage: 'Bengali', voiceRate: 5.8, generate, thorough: true });
  assert.ok(calls.find((c) => c.kind === 'write').prompt.includes('keeps each idea in its own piece'));
  const review = calls.find((c) => c.kind === 'review').prompt;
  assert.ok(review.includes('"offLine"'));
  assert.ok(review.includes('Another way is ¦ you know some mantra.'), 'the review sees the English marks');
  assert.ok(review.includes('আরেকটা উপায়।"') || review.includes('¦ আরেকটা উপায়'), 'and the translation marks');
  assert.match(calls.find((c) => c.kind === 'fix').prompt, /do not line up with the English/);
  assert.equal(out.offline, 1);
  assert.equal(out.translations.get('c4'), 'আরেকটা উপায়,');
});

test('every sentence-first mode keeps one respect form per person', async () => {
  const { buildNaturalPrompt } = await import('./naturalTranslation.js');
  const prompt = buildNaturalPrompt({ batch: buildNaturalUnits(talk), targetLanguage: 'Bengali' });
  assert.ok(prompt.includes('A person keeps one respect form'));
  assert.ok(!prompt.includes('keeps each idea in its own piece'), 'the line-order rule is Full only');
});

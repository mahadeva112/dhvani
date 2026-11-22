import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNaturalUnits, cutPiece, cutUnit, readNaturalLine, naturalIssues, translateNatural } from './naturalTranslation.js';

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
  cue('c2', 'handling', 92.11, 92.68),
  cue('c3', 'the fear and the resistance that you have.', 93.94, 97.02),
  cue('c4', 'Another way is', 98.94, 99.92),
  cue('c5', 'you know some mantra.', 100.86, 101.92),
];

test('cues are joined until the English sentence ends, and only pauses of 1.2 s or more bind the wording', () => {
  const units = buildNaturalUnits(talk);
  assert.deepEqual(units.map((u) => u.cues.map((c) => c.id)), [['c1', 'c2', 'c3'], ['c4', 'c5']]);
  const [first, second] = units;
  // 91.34 → 92.11 is 0.77 s (free); 92.68 → 93.94 is 1.26 s (a stop).
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

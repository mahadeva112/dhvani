import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeScript, joinTokens, resolveBoundaries, alignScript } from './scriptAlign.js';

const words = (n, prefix = 'w') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const cuesOf = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, text: `English cue ${i}` }));

/** Every word of the script, in order, exactly once. */
const assertWholeScript = (result, script) => {
  const placed = result.cues.map((c) => c.text).filter(Boolean).join(' ').split(/\s+/);
  assert.deepEqual(placed, script.split(/\s+/));
};

test('tokens keep line breaks and rejoin without them', () => {
  const tokens = tokenizeScript('नमस्ते दोस्तों,\nआज हम  बात करेंगे।');
  assert.deepEqual(tokens.map((t) => t.text), ['नमस्ते', 'दोस्तों,', 'आज', 'हम', 'बात', 'करेंगे।']);
  assert.equal(tokens[1].sep, '\n');
  assert.equal(joinTokens(tokens), 'नमस्ते दोस्तों, आज हम बात करेंगे।');
});

test('a long run with no spaces is cut into words and rejoined without adding any', () => {
  const run = '今日はとても良い天気ですね私たちは公園に行きます。';
  const tokens = tokenizeScript(run);
  assert.ok(tokens.length > 1);
  assert.equal(joinTokens(tokens), run);
});

test('consistent answers are used as given', () => {
  const { ends, estimated } = resolveBoundaries({
    answers: [2, 5, 9],
    weights: [1, 1, 1],
    start: 0,
    stop: 10,
    final: true,
    rate: 1,
  });
  assert.deepEqual(ends, [3, 6, 10]);
  assert.deepEqual(estimated, [false, false, false]);
});

test('an answer that goes backwards is dropped and its cue is spread by weight', () => {
  const { ends, estimated } = resolveBoundaries({
    answers: [3, 1, 7, 11],
    weights: [1, 1, 1, 1],
    start: 0,
    stop: 12,
    final: true,
    rate: 1,
  });
  assert.deepEqual(ends, [4, 6, 8, 12]);
  assert.deepEqual(estimated, [false, true, false, false]);
});

test('null means empty, and the last cue of the final window closes the script', () => {
  const { ends, estimated } = resolveBoundaries({
    answers: [4, null, 6],
    weights: [5, 5, 5],
    start: 0,
    stop: 10,
    final: true,
    rate: 1,
  });
  assert.deepEqual(ends, [5, 5, 10]);
  // The model stopped short of the end, so the last cue is flagged.
  assert.deepEqual(estimated, [false, false, true]);
});

test('with no answers at all the words are shared by weight and flagged', () => {
  const { ends, estimated } = resolveBoundaries({
    answers: [undefined, undefined, undefined],
    weights: [1, 2, 1],
    start: 10,
    stop: 30,
    final: true,
    rate: 1,
  });
  assert.deepEqual(ends, [15, 25, 30]);
  assert.deepEqual(estimated, [true, true, true]);
});

test('a perfect model places every cue exactly, across many windows', async () => {
  const n = 130;
  const perCue = 7;
  const script = words(n * perCue).join(' ');
  const cues = cuesOf(n);
  let calls = 0;
  const callModel = async (prompt) => {
    if (isLocate(prompt)) return { firstCue: 1, lastCue: n };
    calls += 1;
    const [, first] = prompt.match(/numbered \{(\d+)\}/);
    const start = Number(first);
    const cueLines = prompt.split('ENGLISH CUES\n')[1].split('\n\n')[0].split('\n');
    const firstCue = start / perCue;
    return { cues: cueLines.map((_, i) => ({ n: i + 1, last: (firstCue + i + 1) * perCue - 1, fit: 'full' })) };
  };

  const result = await alignScript(cues, script, { callModel, targetLanguage: 'Hindi' });
  assert.ok(calls >= 3, 'long input runs in windows');
  assert.equal(result.failedWindows, 0);
  result.cues.forEach((cue, i) => {
    assert.equal(cue.text, words(perCue, 'w').map((_, k) => `w${i * perCue + k}`).join(' '));
    assert.equal(cue.fit, 'full');
    assert.equal(cue.estimated, false);
  });
});

test('nonsense answers still place the whole script once, in order', async () => {
  const script = words(500).join(' ');
  const cues = cuesOf(90);
  const callModel = async () => ({
    cues: Array.from({ length: 50 }, (_, i) => ({ n: i + 1, last: (i * 7919) % 600, fit: 'full' })),
  });
  const result = await alignScript(cues, script, { callModel });
  assertWholeScript(result, script);
});

test('a failing window falls back to a flagged estimate instead of failing the run', async () => {
  const script = words(300).join(' ');
  const cues = cuesOf(60);
  const errors = [];
  const callModel = async () => {
    throw Object.assign(new Error('malformed JSON'), { code: 'bad_model_output', retryable: true });
  };
  const result = await alignScript(cues, script, { callModel, onWindowError: (err) => errors.push(err) });
  assertWholeScript(result, script);
  assert.ok(result.failedWindows > 0);
  assert.equal(errors.length, result.failedWindows);
  assert.ok(result.cues.every((c) => c.estimated));
});

test('cancelling stops before the next window', async () => {
  let cancelled = false;
  const callModel = async () => {
    cancelled = true;
    return { cues: [] };
  };
  await assert.rejects(
    alignScript(cuesOf(120), words(600).join(' '), { callModel, isCancelled: () => cancelled }),
    (err) => err.code === 'cancelled'
  );
});

test('when the script runs out the remaining cues are marked as unmatched', async () => {
  const cues = cuesOf(100);
  // The first window swallows the whole (short) script.
  const callModel = async (prompt) => {
    if (isLocate(prompt)) return {};
    const [, last] = prompt.match(/to \{(\d+)\}/);
    return { cues: Array.from({ length: 40 }, (_, i) => ({ n: i + 1, last: Number(last), fit: 'partial' })) };
  };
  const script = words(20).join(' ');
  const result = await alignScript(cues, script, { callModel, margin: 0, slack: 10 });
  assertWholeScript(result, script);
  assert.equal(result.cues.at(-1).text, '');
  assert.equal(result.cues.at(-1).fit, 'none');
});

test('a cue that is only a sound tag gets no words and no flag', async () => {
  const cues = [
    { id: 'a', text: 'Hello there.' },
    { id: 'b', text: '[music]' },
    { id: 'c', text: 'Welcome back.' },
  ];
  const callModel = async (prompt) => {
    assert.match(prompt, /2\. \(no speech\)/);
    return { cues: [{ n: 1, last: 1, fit: 'full' }, { n: 2, last: null, fit: 'none' }, { n: 3, last: 3, fit: 'full' }] };
  };
  const result = await alignScript(cues, 'नमस्ते दोस्तों। फिर स्वागत।', { callModel });
  assert.deepEqual(result.cues.map((c) => c.text), ['नमस्ते दोस्तों।', '', 'फिर स्वागत।']);
  assert.equal(result.cues[1].fit, undefined);
});

test('a miscounted index is corrected from the echoed word', async () => {
  const cues = [
    { id: 'a', text: 'When you wake up,' },
    { id: 'b', text: 'sit quietly.' },
  ];
  // "उठते हैं," is word 4, but the model says 2 while echoing the right word.
  const callModel = async () => ({
    cues: [{ n: 1, last: 2, word: 'हैं,', fit: 'full' }, { n: 2, last: 6, word: 'बैठिए।', fit: 'full' }],
  });
  const result = await alignScript(cues, 'जब आप उठते हैं, चुपचाप बैठिए।', { callModel });
  assert.deepEqual(result.cues.map((c) => c.text), ['जब आप उठते हैं,', 'चुपचाप बैठिए।']);
  assert.equal(result.cues[0].estimated, false);
});

test('a reply that gives up is asked again with a smaller window', async () => {
  const perCue = 3;
  const n = 40;
  const script = words(n * perCue).join(' ');
  const sizes = [];
  const callModel = async (prompt) => {
    if (isLocate(prompt)) return {};
    const [, first] = prompt.match(/numbered \{(\d+)\}/);
    const count = prompt.split('ENGLISH CUES\n')[1].split('\n\n')[0].split('\n').length;
    sizes.push(count);
    // Gives up on anything bigger than 15 cues.
    if (count > 15) return { cues: Array.from({ length: count }, (_, i) => ({ n: i + 1, last: null, fit: 'none' })) };
    const firstCue = Number(first) / perCue;
    return { cues: Array.from({ length: count }, (_, i) => ({ n: i + 1, last: (firstCue + i + 1) * perCue - 1, fit: 'full' })) };
  };
  const result = await alignScript(cuesOf(n), script, { callModel });
  assert.equal(sizes[0], 30);
  assert.ok(sizes.includes(15));
  assertWholeScript(result, script);
  assert.ok(result.cues.every((c) => c.fit === 'full' && !c.estimated));
});

test('a bad key stops the run instead of being retried', async () => {
  let calls = 0;
  const callModel = async () => {
    calls += 1;
    throw Object.assign(new Error('API key not valid'), { status: 401, retryable: false });
  };
  await assert.rejects(alignScript(cuesOf(50), words(200).join(' '), { callModel }), /API key/);
  assert.equal(calls, 1);
});

const isLocate = (prompt) => prompt.includes('Find where it sits');

/** A model that places `perCue` words per cue, starting at cue `offset`, and locates as told. */
const placingModel = ({ perCue, offset = 0, located }) => async (prompt) => {
  if (isLocate(prompt)) return located;
  const [, first] = prompt.match(/numbered \{(\d+)\}/);
  const lines = prompt.split('ENGLISH CUES\n')[1].split('\n\n')[0].split('\n');
  const firstWordCue = Number(first) / perCue;
  return {
    cues: lines.map((_, i) => ({ n: i + 1, last: (firstWordCue + i + 1) * perCue - 1, fit: 'full' })),
  };
};

test('a script for only the first part of the video stays on those cues', async () => {
  const perCue = 6;
  const cues = cuesOf(100).map((c) => ({ ...c, text: 'one two three four five six' }));
  const script = words(40 * perCue).join(' ');
  const result = await alignScript(cues, script, {
    callModel: placingModel({ perCue, located: { firstCue: 1, lastCue: 40 } }),
  });
  assert.deepEqual(result.coverage, { firstCue: 1, lastCue: 40 });
  assertWholeScript(result, script);
  result.cues.slice(0, 40).forEach((c, i) => assert.equal(c.text, words(perCue).map((_, k) => `w${i * perCue + k}`).join(' ')));
  result.cues.slice(42).forEach((c) => {
    assert.equal(c.text, '');
    assert.equal(c.fit, 'none');
  });
});

test('a located range the script is far too short or long for is ignored', async () => {
  const cues = cuesOf(100).map((c) => ({ ...c, text: 'one two three four five six' }));
  const script = words(600).join(' ');
  // 600 words cannot translate cues 1-10 (60 English words).
  const result = await alignScript(cues, script, {
    callModel: placingModel({ perCue: 6, located: { firstCue: 1, lastCue: 10 } }),
  });
  assert.equal(result.coverage, null);
  assertWholeScript(result, script);
  assert.ok(result.cues.at(-1).text);
});

test('a script that covers everything is not trimmed', async () => {
  const cues = cuesOf(80).map((c) => ({ ...c, text: 'one two three four' }));
  const script = words(320).join(' ');
  const result = await alignScript(cues, script, {
    callModel: placingModel({ perCue: 4, located: { firstCue: 1, lastCue: 80 } }),
  });
  assert.equal(result.coverage, null);
  assert.ok(result.cues.every((c) => c.fit === 'full'));
});

test('an unreachable model is reported at once, not guessed around', async () => {
  let calls = 0;
  const callModel = async () => {
    calls += 1;
    throw Object.assign(new Error('Could not reach LLM gateway'), { code: 'network_error', retryable: true });
  };
  await assert.rejects(alignScript(cuesOf(10), words(50).join(' '), { callModel }), /Could not reach/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(alignScript(cuesOf(100), words(500).join(' '), { callModel }), /Could not reach/);
  assert.equal(calls, 1);
});

test('a network fault after the model was reached only estimates that window', async () => {
  let calls = 0;
  const good = placingModel({ perCue: 5, located: { firstCue: 1, lastCue: 80 } });
  const callModel = async (prompt) => {
    calls += 1;
    if (calls === 3) throw Object.assign(new Error('socket hang up'), { code: 'network_error', retryable: true });
    return good(prompt);
  };
  const script = words(400).join(' ');
  const result = await alignScript(cuesOf(80), script, { callModel });
  assertWholeScript(result, script);
  assert.equal(result.failedWindows, 1);
  assert.ok(result.cues.some((c) => c.estimated));
  assert.ok(result.cues.some((c) => c.fit === 'full'));
});

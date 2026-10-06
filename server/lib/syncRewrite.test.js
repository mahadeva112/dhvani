import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestLine, suggestLines, checkMeaning, contextNote, buildMeaningCheckPrompt, buildRewritePrompt, buildOptionsPrompt } from './syncRewrite.js';

/**
 * A fake text model: rewrites come from `lines` in order, meaning checks from
 * `checks` in order. Every prompt it was sent is kept.
 */
const fakeModel = ({ lines = [], checks = [] }) => {
  const prompts = { rewrite: [], check: [] };
  const generate = async ({ contents, generationConfig }) => {
    const prompt = contents.parts[0].text;
    if (generationConfig?.responseMimeType === 'application/json') {
      prompts.check.push(prompt);
      const next = checks.shift();
      return { response: { text: typeof next === 'string' ? next : JSON.stringify(next) } };
    }
    prompts.rewrite.push(prompt);
    return { response: { text: lines.shift() ?? '' } };
  };
  return { generate, prompts };
};

const request = {
  text: 'मैं कल सुबह दस बजे बाज़ार नहीं जाऊँगा, क्योंकि बारिश होगी',
  sourceText: 'I will not go to the market at ten tomorrow morning, because it will rain.',
  language: 'Hindi',
  targetChars: 40,
};

test('a wording that keeps the meaning is suggested, after the check passed', async () => {
  const { generate, prompts } = fakeModel({ lines: ['कल दस बजे बाज़ार नहीं जाऊँगा, बारिश होगी'], checks: [{ sameMeaning: true, issues: [] }] });
  const { line, reason } = await suggestLine({ ...request, direction: 'shorter' }, { generate });
  assert.equal(line, 'कल दस बजे बाज़ार नहीं जाऊँगा, बारिश होगी');
  assert.equal(reason, null);
  assert.equal(prompts.check.length, 1);
  // The check compares against the source line, as the authority.
  assert.match(prompts.check[0], /Original line \(the authority\):\nI will not go/);
  assert.match(prompts.check[0], /Suggested wording:\nकल दस बजे/);
});

test('a wording that changes the meaning is repaired once, with what was wrong', async () => {
  const { generate, prompts } = fakeModel({
    lines: ['मैं कल सुबह दस बजे बाज़ार जाऊँगा', 'कल दस बजे बाज़ार नहीं जाऊँगा, बारिश है'],
    checks: [{ sameMeaning: false, issues: ['the negation is lost', 'the reason is dropped'] }, { sameMeaning: true, issues: [] }],
  });
  const { line } = await suggestLine({ ...request, direction: 'shorter' }, { generate });
  assert.equal(line, 'कल दस बजे बाज़ार नहीं जाऊँगा, बारिश है');
  assert.equal(prompts.rewrite.length, 2);
  assert.match(prompts.rewrite[1], /changed the meaning, so it was rejected:\nमैं कल सुबह दस बजे बाज़ार जाऊँगा/);
  assert.match(prompts.rewrite[1], /- the negation is lost/);
});

test('when every wording changes the meaning, none passes, and the last comes back flagged', async () => {
  const { generate, prompts } = fakeModel({
    lines: ['मैं कल सुबह दस बजे बाज़ार जाऊँगा', 'कल सुबह दस बजे बाज़ार जाऊँगा'],
    checks: [{ sameMeaning: false, issues: ['negation lost'] }, { sameMeaning: false, issues: ['emphasis dropped'] }],
  });
  const { line, reason, flagged } = await suggestLine({ ...request, direction: 'shorter' }, { generate });
  assert.equal(line, null);
  assert.equal(reason, 'meaning');
  assert.deepEqual(flagged, { line: 'कल सुबह दस बजे बाज़ार जाऊँगा', issues: ['emphasis dropped'] });
  assert.equal(prompts.rewrite.length, 2, 'one repair, no more');
});

test('a check that gives no readable answer counts as a failure', async () => {
  const { generate } = fakeModel({ checks: ['not json at all'] });
  const result = await checkMeaning({ ...request, candidate: 'x', direction: 'shorter' }, { generate });
  assert.equal(result.ok, false);
  const missing = await checkMeaning({ ...request, candidate: 'x', direction: 'shorter' }, { generate: fakeModel({ checks: [{ issues: [] }] }).generate });
  assert.equal(missing.ok, false, 'sameMeaning must be true, not just absent');
});

test('an answer that fails the length checks is never sent to the meaning check', async () => {
  const { generate, prompts } = fakeModel({ lines: [request.text + ' और भी', request.text] });
  const { line, reason, flagged } = await suggestLine({ ...request, direction: 'shorter' }, { generate });
  assert.equal(line, null);
  assert.equal(reason, 'unusable');
  assert.equal(flagged, null);
  assert.equal(prompts.check.length, 0);
});

test('an answer of the wrong length gets a second try', async () => {
  const { generate, prompts } = fakeModel({
    lines: [request.text + ' और भी', 'कल दस बजे बाज़ार नहीं जाऊँगा, बारिश होगी'],
    checks: [{ sameMeaning: true, issues: [] }],
  });
  const { line } = await suggestLine({ ...request, direction: 'shorter' }, { generate });
  assert.equal(line, 'कल दस बजे बाज़ार नहीं जाऊँगा, बारिश होगी');
  assert.equal(prompts.rewrite.length, 2);
});

test('a fuller wording is checked for anything added, and may restore what the source says', async () => {
  const short = { text: 'हाँ, बिल्कुल।', sourceText: 'Yes, absolutely, I completely agree with you.', language: 'Hindi', targetChars: 40 };
  const { generate, prompts } = fakeModel({ lines: ['हाँ बिल्कुल, मैं आपसे पूरी तरह सहमत हूँ।'], checks: [{ sameMeaning: true, issues: [] }] });
  const { line } = await suggestLine({ ...short, direction: 'longer' }, { generate });
  assert.equal(line, 'हाँ बिल्कुल, मैं आपसे पूरी तरह सहमत हूँ।');
  assert.match(prompts.check[0], /made fuller/);
  assert.match(prompts.check[0], /saying what is there more fully is fine/);
  assert.doesNotMatch(prompts.check[0], /dropping only filler/);
});

test('without a source line, the check compares against the dub line as it is', () => {
  const prompt = buildMeaningCheckPrompt({ text: 'dub line', sourceText: '', candidate: 'new', direction: 'shorter' });
  assert.doesNotMatch(prompt, /Original line/);
  assert.match(prompt, /current dub line means/);
});

test('the rewrite prompt makes the original line the authority on meaning', () => {
  const prompt = buildRewritePrompt(request);
  assert.match(prompt, /The meaning must not change\. The original line is the authority/);
  assert.match(prompt, /every negation/);
  assert.match(prompt, /keep its own word for each idea/);
});

test("the check judges only what a suggestion changes, not the dub line's own word choices or grammar", () => {
  const prompt = buildMeaningCheckPrompt({ text: 'dub line', sourceText: 'source line', candidate: 'new', language: 'Hindi', direction: 'shorter' });
  assert.match(prompt, /Judge only what the suggested wording changes/);
  assert.match(prompt, /already uses for an idea in the original line/);
  assert.match(prompt, /Grammar that Hindi naturally uses/);
  assert.match(prompt, /If you are not sure, it does not keep the meaning/);
  const noSource = buildMeaningCheckPrompt({ text: 'dub line', sourceText: '', candidate: 'new', direction: 'shorter' });
  assert.doesNotMatch(noSource, /accepted translation/);
});

/**
 * A fake text model for several wordings at once: each request for wordings
 * gets the next of `rounds` (a list of lines), each meaning check the verdict
 * `verdict(line)` gives that line.
 */
const optionsModel = ({ rounds = [], verdict = () => ({ sameMeaning: true, issues: [] }) }) => {
  const prompts = { options: [], check: [] };
  const generate = async ({ contents }) => {
    const prompt = contents.parts[0].text;
    if (prompt.includes('strict reviewer')) {
      prompts.check.push(prompt);
      const candidate = prompt.split('Suggested wording:\n')[1].split('\n')[0];
      return { response: { text: JSON.stringify(verdict(candidate)) } };
    }
    prompts.options.push(prompt);
    return { response: { text: JSON.stringify({ meaning: 'He will not go.', options: rounds.shift() ?? [] }) } };
  };
  return { generate, prompts };
};

test('three wordings come back from one request, each checked on its own', async () => {
  const lines = ['कल दस बजे बाज़ार नहीं जाऊँगा, बारिश होगी', 'बारिश होगी, कल दस बजे बाज़ार नहीं जाऊँगा', 'कल सुबह दस बजे नहीं जाऊँगा, बारिश है'];
  const { generate, prompts } = optionsModel({ rounds: [lines] });
  const { options } = await suggestLines({ ...request, direction: 'shorter', count: 3 }, { generate });
  assert.deepEqual(options.map((o) => o.line), lines);
  assert.ok(options.every((o) => !o.issues));
  assert.equal(prompts.options.length, 1);
  assert.equal(prompts.check.length, 3);
  // The model works the meaning out first, and is asked for wordings of different kinds.
  assert.match(prompts.options[0], /First, understand the line/);
  assert.match(prompts.options[0], /"meaning"/);
  assert.match(prompts.options[0], /1\. Closest[\s\S]*2\. Natural[\s\S]*3\. Recast/);
});

test('a wording that changed the meaning is asked for again, and still offered last, flagged, if no other comes', async () => {
  const good = 'कल दस बजे बाज़ार नहीं जाऊँगा, बारिश होगी';
  const bad = 'कल दस बजे बाज़ार जाऊँगा, बारिश होगी';
  const third = 'बारिश होगी, कल दस बजे नहीं जाऊँगा';
  const { generate, prompts } = optionsModel({
    rounds: [[good, bad, good], [third]],
    verdict: (line) => (line === bad ? { sameMeaning: false, issues: ['negation dropped'] } : { sameMeaning: true, issues: [] }),
  });
  const { options } = await suggestLines({ ...request, direction: 'shorter', count: 3 }, { generate });
  assert.deepEqual(options, [{ line: good }, { line: third }, { line: bad, issues: ['negation dropped'] }]);
  // The second round asks only for what is missing, told what went wrong.
  assert.equal(prompts.options.length, 2);
  assert.match(prompts.options[1], /Write 2 shorter wordings/);
  assert.match(prompts.options[1], /What was wrong: negation dropped/);
});

test('wordings of the wrong length, or repeats of earlier ones, are not offered', async () => {
  const offered = 'कल दस बजे बाज़ार नहीं जाऊँगा, बारिश होगी';
  const { generate } = optionsModel({ rounds: [[request.text, offered, 'नहीं'], []] });
  const { options } = await suggestLines({ ...request, direction: 'shorter', count: 3, avoid: [offered] }, { generate });
  assert.deepEqual(options, []);
});

test('the lines around a line and its speaker go into the prompt, as context only', () => {
  const context = { before: ['तुम कल बाज़ार चलोगे?'], after: ['ठीक है, परसों चलेंगे।'], speaker: 'Ravi' };
  for (const prompt of [
    buildRewritePrompt({ ...request, context }),
    buildOptionsPrompt({ ...request, direction: 'longer', count: 3, context }),
  ]) {
    assert.match(prompt, /Speaker: Ravi/);
    assert.match(prompt, /Line before: तुम कल बाज़ार चलोगे\?/);
    assert.match(prompt, /Line after: ठीक है, परसों चलेंगे।/);
    assert.match(prompt, /do not move anything from them into this one/);
  }
  assert.equal(contextNote({ before: [], after: [''] }), '');
  assert.doesNotMatch(buildRewritePrompt(request), /Context, only/);
});

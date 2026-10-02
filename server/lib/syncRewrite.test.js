import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestLine, checkMeaning, buildMeaningCheckPrompt, buildRewritePrompt } from './syncRewrite.js';

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

test('when every wording changes the meaning, nothing is suggested', async () => {
  const { generate, prompts } = fakeModel({
    lines: ['मैं कल सुबह दस बजे बाज़ार जाऊँगा', 'कल सुबह दस बजे बाज़ार जाऊँगा'],
    checks: [{ sameMeaning: false, issues: ['negation lost'] }, { sameMeaning: false, issues: ['negation lost'] }],
  });
  const { line, reason } = await suggestLine({ ...request, direction: 'shorter' }, { generate });
  assert.equal(line, null);
  assert.equal(reason, 'meaning');
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
  const { generate, prompts } = fakeModel({ lines: [request.text + ' और भी'] });
  const { line, reason } = await suggestLine({ ...request, direction: 'shorter' }, { generate });
  assert.equal(line, null);
  assert.equal(reason, 'unusable');
  assert.equal(prompts.check.length, 0);
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

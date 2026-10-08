import test from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestLine,
  suggestLines,
  checkMeaning,
  contextNote,
  buildMeaningCheckPrompt,
  buildRewritePrompt,
  buildOptionsPrompt,
  keptTerms,
  missingTerms,
  rewordLimit,
  acceptReword,
} from './syncRewrite.js';

/**
 * A fake text model: rewrites come from `lines` in order, meaning checks from
 * `checks` in order. Every prompt it was sent is kept.
 */
const fakeModel = ({ lines = [], checks = [] }) => {
  const prompts = { rewrite: [], check: [], back: [] };
  const generate = async ({ contents, generationConfig }) => {
    const prompt = contents.parts[0].text;
    if (prompt.startsWith('Translate this')) {
      prompts.back.push(prompt);
      return { response: { text: `EN: ${prompt.split('\n\n')[1]}` } };
    }
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
  assert.deepEqual(flagged, { line: 'कल सुबह दस बजे बाज़ार जाऊँगा', issues: ['emphasis dropped'], backTranslation: 'EN: कल सुबह दस बजे बाज़ार जाऊँगा' });
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
  const prompts = { options: [], check: [], back: [] };
  const generate = async ({ contents }) => {
    const prompt = contents.parts[0].text;
    if (prompt.startsWith('Translate this')) {
      prompts.back.push(prompt);
      return { response: { text: `EN: ${prompt.split('\n\n')[1]}` } };
    }
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
  const en = (line) => `EN: ${line}`;
  assert.deepEqual(options, [
    { line: good, backTranslation: en(good) },
    { line: third, backTranslation: en(third) },
    { line: bad, issues: ['negation dropped'], backTranslation: en(bad) },
  ]);
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

test('numbers, glossary terms and words kept in Latin letters are what a wording must keep', () => {
  const line = 'Sadhguru ने कहा कि 2,500 लोग Isha Yoga Center में आएँगे';
  assert.deepEqual(keptTerms(line, ['Isha Yoga Center', 'Mahashivratri']), ['2500', 'Isha Yoga Center', 'Sadhguru']);
  // The same number in another script's digits, or without its comma, is kept.
  assert.deepEqual(missingTerms('৩০০ জন এসেছিলেন', '300 জন এলেন'), []);
  assert.deepEqual(missingTerms(line, 'Sadhguru: 2500 लोग Isha Yoga Center आएँगे', ['Isha Yoga Center']), []);
  assert.deepEqual(missingTerms(line, 'Sadhguru ने कहा कि बहुत लोग Isha Yoga Center आएँगे', ['Isha Yoga Center']), ['2500']);
  assert.deepEqual(missingTerms(line, '2500 लोग Isha Yoga Center आएँगे', ['Isha Yoga Center']), ['Sadhguru']);
  // A line written in Latin letters keeps only its numbers and glossary terms.
  assert.deepEqual(keptTerms('We will meet at the Center at 10'), ['10']);
  assert.deepEqual(keptTerms('Nous irons à Paris à 10 h'), ['10']);
});

test('a wording that drops a kept term fails in code, without a meaning check, and is repaired', async () => {
  const line = { ...request, text: 'Sadhguru कल सुबह 10 बजे बाज़ार नहीं जाएँगे, क्योंकि बारिश होगी', targetChars: 45 };
  const { generate, prompts } = fakeModel({
    lines: ['कल 10 बजे बाज़ार नहीं जाएँगे, बारिश होगी', 'Sadhguru कल 10 बजे नहीं जाएँगे, बारिश होगी'],
    checks: [{ sameMeaning: true, issues: [] }],
  });
  const result = await suggestLine({ ...line, direction: 'shorter' }, { generate });
  assert.equal(result.line, 'Sadhguru कल 10 बजे नहीं जाएँगे, बारिश होगी');
  assert.equal(prompts.check.length, 1, 'only the wording that kept every term was sent to the check');
  assert.match(prompts.rewrite[0], /Keep these exactly as they are: "10", "Sadhguru"/);
  assert.match(prompts.rewrite[1], /- leaves out "Sadhguru"/);
});

test('among several wordings, one that drops a glossary term comes back flagged with what it left out', async () => {
  const line = { ...request, text: 'वे Isha Yoga Center में कल सुबह नहीं आएँगे, क्योंकि बारिश होगी', targetChars: 50 };
  const kept = 'वे Isha Yoga Center कल नहीं आएँगे, बारिश होगी';
  const dropped = 'वे आश्रम में कल नहीं आएँगे, बारिश होगी';
  const { generate, prompts } = optionsModel({ rounds: [[kept, dropped], []] });
  const { options } = await suggestLines({ ...line, direction: 'shorter', count: 2, keep: ['Isha Yoga Center'] }, { generate });
  // A wording that fails in code is never sent on, so it has no back-translation.
  assert.deepEqual(options, [{ line: kept, backTranslation: `EN: ${kept}` }, { line: dropped, issues: ['leaves out "Isha Yoga Center"'] }]);
  assert.equal(prompts.check.length, 1);
});

test('a line that fits is reworded at about its own length, never past what its slot holds', async () => {
  const text = request.text; // 56 characters
  const near = 'कल सुबह दस बजे मैं बाज़ार नहीं जाऊँगा, क्योंकि बारिश होगी';
  const cut = 'कल बाज़ार नहीं जाऊँगा';
  const { generate, prompts } = fakeModel({ lines: [cut, near], checks: [{ sameMeaning: true, issues: [] }] });
  const { line } = await suggestLine({ ...request, direction: 'same', targetChars: rewordLimit(text, 60) }, { generate });
  assert.equal(line, near, 'the cut was not offered as a rewording; the second try was');
  assert.match(prompts.rewrite[0], /fits its time, but the user wants another way to say it/);
  assert.match(prompts.check[0], /A wording was reworded/);
  // Nothing may be dropped from a rewording, not even filler.
  assert.doesNotMatch(prompts.check[0], /dropping only filler/);
  // About its own length: no more than its slot, or 15% past the line.
  assert.equal(rewordLimit(text, 60), 60);
  assert.equal(rewordLimit(text, 200), Math.floor(text.length * 1.15));
  assert.equal(rewordLimit(text, 10), text.length);
  assert.equal(acceptReword(text, text, 60), null, 'the same line is not a new wording');
});

test('several rewordings of a line that fits are asked for as other wordings', async () => {
  const lines = ['कल सुबह दस बजे मैं बाज़ार नहीं जाऊँगा, क्योंकि बारिश होगी', 'बारिश होगी, इसलिए कल सुबह दस बजे बाज़ार नहीं जाऊँगा'];
  const { generate, prompts } = optionsModel({ rounds: [lines] });
  const { options } = await suggestLines({ ...request, direction: 'same', targetChars: 64, count: 2 }, { generate });
  assert.deepEqual(options.map((o) => o.line), lines);
  assert.match(prompts.options[0], /Write 2 new wordings of it that read naturally/);
  assert.match(prompts.options[0], /Dub line to reword:/);
});

test('a wording offered before is never offered again, however many were', async () => {
  const offered = Array.from({ length: 20 }, (_, i) => `पहले की ${i} वाली पंक्ति, बारिश होगी तो नहीं जाऊँगा`);
  const fresh = 'कल दस बजे बाज़ार नहीं जाऊँगा, बारिश होगी';
  const { generate, prompts } = fakeModel({ lines: [offered[2], fresh], checks: [{ sameMeaning: true, issues: [] }] });
  const { line } = await suggestLine({ ...request, direction: 'shorter', avoid: offered }, { generate });
  assert.equal(line, fresh, 'the repeat of an early wording was asked for again');
  assert.equal(prompts.check.length, 1);
  assert.match(prompts.rewrite[0], new RegExp(offered[19]));
});

test('each wording is translated back into English without the original in view, and the check reads that English', async () => {
  const wording = 'कल दस बजे बाज़ार नहीं जाऊँगा, बारिश होगी';
  const { generate, prompts } = fakeModel({ lines: [wording], checks: [{ sameMeaning: true, issues: [] }] });
  const result = await suggestLine({ ...request, direction: 'shorter' }, { generate });
  assert.equal(result.backTranslation, `EN: ${wording}`);
  assert.equal(prompts.back.length, 1);
  // The back-translation never sees the original line or the dub line it came from.
  assert.doesNotMatch(prompts.back[0], /I will not go/);
  assert.doesNotMatch(prompts.back[0], new RegExp(request.text));
  assert.match(prompts.check[0], /translated literally into English by someone who never saw the original line:\nEN: कल दस बजे/);
});

test('without a source line there is nothing to translate back against, so no back-translation is asked for', async () => {
  const { generate, prompts } = fakeModel({ lines: ['कल दस बजे बाज़ार नहीं जाऊँगा, बारिश होगी'], checks: [{ sameMeaning: true, issues: [] }] });
  const result = await suggestLine({ ...request, sourceText: '', direction: 'shorter' }, { generate });
  assert.equal(result.backTranslation, null);
  assert.equal(prompts.back.length, 0);
});

test('a back-translation that fails leaves the meaning check to run without it', async () => {
  let checked = 0;
  const generate = async ({ contents, generationConfig }) => {
    const prompt = contents.parts[0].text;
    if (prompt.startsWith('Translate this')) throw new Error('rate limited');
    if (generationConfig?.responseMimeType === 'application/json') {
      checked++;
      assert.doesNotMatch(prompt, /translated literally into English/);
      return { response: { text: JSON.stringify({ sameMeaning: true, issues: [] }) } };
    }
    return { response: { text: 'कल दस बजे बाज़ार नहीं जाऊँगा, बारिश होगी' } };
  };
  const result = await suggestLine({ ...request, direction: 'shorter' }, { generate });
  assert.equal(result.line, 'कल दस बजे बाज़ार नहीं जाऊँगा, बारिश होगी');
  assert.equal(result.backTranslation, null);
  assert.equal(checked, 1);
});

test("the user's earlier choices go into every prompt as a guide to style, never to content", () => {
  const examples = [{ from: 'आपको इस बात का ध्यान रखना होगा', to: 'ध्यान रखिए' }];
  for (const prompt of [
    buildRewritePrompt({ ...request, examples }),
    buildOptionsPrompt({ ...request, direction: 'same', count: 3, examples }),
  ]) {
    assert.match(prompt, /How this user reworded other lines of this script before/);
    assert.match(prompt, /- "आपको इस बात का ध्यान रखना होगा" became "ध्यान रखिए"/);
    assert.match(prompt, /never take words, ideas or facts from them/);
  }
  assert.doesNotMatch(buildRewritePrompt(request), /How this user reworded/);
});

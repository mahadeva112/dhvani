import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptFix, checkGrammar, editDistance, buildGrammarPrompt, GRAMMAR_BATCH } from './grammarCheck.js';

test('acceptFix lets small real fixes through', () => {
  assert.equal(acceptFix('लड़कियाँ स्कूल जा रहा है।', 'लड़कियाँ स्कूल जा रही हैं।'), null);
  assert.equal(acceptFix('क्या तुम कल आओगे।', 'क्या तुम कल आओगे?'), null);
  assert.equal(acceptFix('मुझको को यह पता नहीं।', 'मुझको यह पता नहीं।'), null);
});

test('acceptFix turns away rewrites and touched kept parts', () => {
  assert.equal(acceptFix('आज आने के लिए धन्यवाद।', 'आज आने के लिए धन्यवाद।'), 'unchanged');
  assert.equal(acceptFix('हम सब इसको समझते है।', 'हम सभी लोग इस बात को भली भाँति समझ लेते हैं।'), 'too big');
  assert.equal(acceptFix('Sadhguru ने कहा है।', 'सद्गुरु ने कहा है।'), 'kept parts');
  assert.equal(acceptFix('[calm] 3 बार कहो है।', '3 बार कहो हैं।'), 'kept parts');
  assert.equal(acceptFix('पहली लाइन\nदूसरी लाइन है', 'पहली लाइन दूसरी लाइन हैं'), 'lines');
  assert.equal(acceptFix('कुछ', ''), 'empty');
});

test('editDistance counts code points and stops past the limit', () => {
  assert.equal(editDistance('है', 'हैं'), 1);
  assert.equal(editDistance('abc', 'xyz', 1), 2);
});

test('checkGrammar batches lines, keeps order and drops bad fixes', async () => {
  const lines = Array.from({ length: GRAMMAR_BATCH + 3 }, (_, n) => ({ id: n, text: `लाइन ${n} है`, sourceText: `line ${n}` }));
  const prompts = [];
  const generate = async ({ contents }) => {
    const prompt = contents.parts[0].text;
    prompts.push(prompt);
    const ids = [...prompt.matchAll(/"id":"(\d+)"/g)].map((m) => m[1]);
    const fixes = ids.flatMap((id) =>
      id === '2' ? [{ id, fixed: `लाइन ${id} हैं`, kind: 'Matra', why: 'bindu' }] : id === '27' ? [{ id, fixed: 'पूरी तरह नई लाइन जो बहुत अलग है', kind: 'Grammar' }] : id === '26' ? [{ id, fixed: `लाइन ${id} हैं`, kind: 'Odd' }] : []
    );
    return { response: { text: JSON.stringify({ fixes }) } };
  };
  const result = await checkGrammar({ lines, language: 'Hindi' }, { generate, effort: null });
  assert.equal(prompts.length, 2);
  assert.deepEqual(result.fixes.map((f) => [f.id, f.kind]), [['2', 'Matra'], ['26', 'Grammar']]);
  assert.equal(result.dropped, 1);
});

test('an unreadable answer counts its lines as unread', async () => {
  const result = await checkGrammar({ lines: [{ id: 'a', text: 'कुछ है' }] }, { generate: async () => ({ response: { text: 'nope' } }), effort: null });
  assert.deepEqual(result, { fixes: [], dropped: 0, unread: 1 });
});

test('the prompt names the language and forbids rewording', () => {
  const prompt = buildGrammarPrompt({ lines: [{ id: '1', text: 'क', sourceText: 'k' }], language: 'Hindi' });
  assert.match(prompt, /Hindi proofreader/);
  assert.match(prompt, /Do not reword/);
  assert.match(prompt, /"original":"k"/);
});

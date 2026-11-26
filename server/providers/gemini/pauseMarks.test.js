import test from 'node:test';
import assert from 'node:assert/strict';
import { markableCues, markPauses, readMarkedLine } from './pauseMarks.js';

const shivaji = {
  id: 'cue-12',
  text: 'But these are great beings and, uh, being here and',
  line: 'लेकिन ये महान विभूतियाँ हैं और, यहाँ आकर,',
  words: [
    { text: 'But', start: 0.3, end: 0.5 }, { text: 'these', start: 0.55, end: 0.8 }, { text: 'are', start: 0.85, end: 1 }, { text: 'great', start: 1.05, end: 1.4 },
    { text: 'beings', start: 1.45, end: 1.9 }, { text: 'and,', start: 1.95, end: 2.2 }, { text: 'uh,', start: 2.3, end: 2.6 },
    { text: 'being', start: 3.1, end: 3.4 }, { text: 'here', start: 3.45, end: 3.7 }, { text: 'and', start: 3.75, end: 4.06 },
  ],
};

test('only cues with a pause inside them and a dub line are sent, the English marked at each pause', () => {
  const smooth = { ...shivaji, id: 'x', words: shivaji.words.map((w, i) => (i >= 7 ? { ...w, start: w.start - 0.25, end: w.end - 0.25 } : w)) };
  const list = markableCues([shivaji, smooth, { ...shivaji, id: 'y', line: '' }]);
  assert.deepEqual(list.map((c) => c.id), ['cue-12']);
  assert.equal(list[0].english, 'But these are great beings and, uh, ‖ being here and');
});

test('a marked line is kept only with the same words and one mark per pause', () => {
  const [cue] = markableCues([shivaji]);
  assert.equal(readMarkedLine(cue, 'लेकिन ये महान विभूतियाँ हैं और, ‖ यहाँ आकर,'), 'लेकिन ये महान विभूतियाँ हैं और, [pause 0.5s] यहाँ आकर,');
  // A changed word, a missing or extra mark, or no answer: nothing.
  assert.equal(readMarkedLine(cue, 'लेकिन ये महान लोग हैं और, ‖ यहाँ आकर,'), null);
  assert.equal(readMarkedLine(cue, 'लेकिन ये महान विभूतियाँ हैं और, यहाँ आकर,'), null);
  assert.equal(readMarkedLine(cue, 'लेकिन ये ‖ महान विभूतियाँ हैं और, ‖ यहाँ आकर,'), null);
  assert.equal(readMarkedLine(cue, null), null);
});

test('markPauses asks the model, keeps good lines and lists the rest as missed', async () => {
  const other = { ...shivaji, id: 'cue-13', line: 'जब मैंने देखा कि उन्होंने कैसे संभाला,' };
  const generate = async ({ contents }) => {
    const prompt = contents.parts[0].text;
    assert.ok(prompt.includes('‖'));
    return {
      modelUsed: 'test-model',
      response: { text: JSON.stringify({ lines: [
        { id: 'cue-12', split: 'लेकिन ये महान विभूतियाँ हैं और, ‖ यहाँ आकर,' },
        { id: 'cue-13', split: 'जब मैंने देखा ‖ कि उन्होंने कैसे सँभाला,' },
      ] }) },
    };
  };
  const out = await markPauses([shivaji, other], { targetLanguage: 'Hindi', generate });
  assert.deepEqual([...out.marked.keys()], ['cue-12']);
  assert.deepEqual(out.missed, ['cue-13']);
  assert.equal(out.modelUsed, 'test-model');
});

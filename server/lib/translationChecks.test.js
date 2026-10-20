import test from 'node:test';
import assert from 'node:assert/strict';
import { sentenceEnding, cueIssues, issueScore, readFix, readMeaningIssues } from './translationChecks.js';
import { refineBatch } from '../providers/gemini/translation.js';
import { lineSyllables } from './syllables.js';

test('sentence ends are read in English and Indian scripts, and trailing off counts either way', () => {
  assert.equal(sentenceEnding('People think you need an investigation.'), 'end');
  assert.equal(sentenceEnding('Is that so?"'), 'end');
  assert.equal(sentenceEnding('তদন্ত চালানো দরকার!'), 'end');
  assert.equal(sentenceEnding('शासन में रही है।'), 'end');
  assert.equal(sentenceEnding('Human civilizations have been controlled'), 'open');
  assert.equal(sentenceEnding('and so...'), null);
  assert.equal(sentenceEnding('और फिर…'), null);
});

const cues = [
  { id: '1', text: 'Human civilizations have been controlled', syllables: 16 },
  { id: '2', text: 'and ruled by powerful men.', syllables: 10 },
];

test('a cue past its budget, a sentence ended early and a run-on are each found', () => {
  const long = 'মানবসভ্যতা দীর্ঘদিন ধরে ক্ষমতাধর পুরুষদের শাসন ও নিয়ন্ত্রণে চলে এসেছে।';
  const issues = cueIssues(cues, new Map([['1', long], ['2', 'আর তাই চলেছে']]));
  assert.deepEqual(issues.map((i) => [i.id, i.kind]), [['1', 'long'], ['1', 'open'], ['2', 'end']]);
  assert.equal(issues[0].syllables, lineSyllables(long));
  assert.equal(issues[0].target, 16);
});

test('a cue a syllable or two over is not sent back', () => {
  const issues = cueIssues([{ id: '1', text: 'Time is life.', syllables: 5 }], new Map([['1', 'সময়ই জীবন।']]));
  assert.deepEqual(issues, []);
});

test('a one-word cue is not judged for length, and sound notes are not counted', () => {
  const tiny = cueIssues([{ id: '4', text: 'situation.', syllables: 2 }], new Map([['4', 'পরিস্থিতিতে।']]));
  assert.deepEqual(tiny, []);
  const tagged = cueIssues([{ id: '1', text: '[laughs] or divorce.', syllables: 6 }], new Map([['1', '[laughs] কিংবা ডিভোর্সে।']]));
  assert.deepEqual(tagged, []);
});

test('the score falls when a fix brings cues closer to right', () => {
  const before = new Map([['1', 'মানবসভ্যতা দীর্ঘদিন ধরে ক্ষমতাধর পুরুষদের শাসন ও নিয়ন্ত্রণে চলে এসেছে।'], ['2', '']]);
  const after = new Map([['1', 'মানবসভ্যতা দীর্ঘদিন ক্ষমতাধর পুরুষদের'], ['2', 'শাসনে চলে এসেছে।']]);
  assert.ok(issueScore(cues, after) < issueScore(cues, before));
  assert.equal(issueScore(cues, after), 0);
});

test('fix and review answers keep only cues of the batch', () => {
  const fix = readFix({ translations: [{ id: '1', translatedText: ' a ' }, { id: '9', translatedText: 'b' }, { id: '2', translatedText: '' }] }, ['1', '2']);
  assert.deepEqual([...fix], [['1', 'a']]);
  const problems = readMeaningIssues({ issues: [{ ids: ['2', '7'], problem: 'negation lost' }, { ids: ['7'], problem: 'x' }, { ids: ['1'], problem: '' }] }, ['1', '2']);
  assert.deepEqual(problems, [{ ids: ['2'], problem: 'negation lost' }]);
  const sentences = readMeaningIssues({ sentences: [{ ids: ['1'], backTranslation: 'x', problem: '' }, { ids: ['2'], problem: 'None.' }, { ids: ['1', '2'], problem: '"controlled" is missing' }] }, ['1', '2']);
  assert.deepEqual(sentences, [{ ids: ['1', '2'], problem: '"controlled" is missing' }]);
  const words = readMeaningIssues(
    {
      sentences: [
        { ids: ['1'], problem: '', words: [{ english: 'beings', translatedAs: 'creatures', same: false }, { english: 'powerful', translatedAs: 'powerful', same: true }, { english: 'controlled', translatedAs: '', same: false }] },
        { ids: ['2'], problem: 'None', words: [{ english: 'men', translatedAs: 'men', same: true }] },
      ],
    },
    ['1', '2']
  );
  assert.deepEqual(words, [{ ids: ['1'], problem: '"beings" is said as "creatures"; "controlled" is missing' }]);
});

test('refineBatch restores meaning first, then fits the length', async () => {
  const start = new Map([['1', 'মানবসভ্যতা দীর্ঘদিন ধরে ক্ষমতাধর পুরুষদের শাসন ও নিয়ন্ত্রণে চলে এসেছে।'], ['2', 'আর তাই।']]);
  const prompts = [];
  const answers = [
    { sentences: [{ ids: ['1', '2'], problem: '', words: [{ english: 'ruled', translatedAs: '', same: false }] }] },
    { translations: [{ id: '2', translatedText: 'শাসনে চলে এসেছে।' }] },
    { translations: [{ id: '1', translatedText: 'মানবসভ্যতা দীর্ঘদিন ক্ষমতাধর পুরুষদের' }] },
  ];
  const ask = async (prompt) => {
    prompts.push(prompt);
    return answers.shift();
  };
  const out = await refineBatch(cues, start, { targetLanguage: 'Bengali', ask });
  assert.equal(prompts.length, 3);
  assert.match(prompts[0], /strict reviewer/);
  assert.match(prompts[1], /"ruled" is missing/);
  assert.match(prompts[2], /id 1: \d+ syllables, the voice has time for about 16/);
  assert.equal(out.meaningFixed, 1);
  assert.equal(out.lengthFixed, 1);
  assert.equal(out.translations.get('1'), 'মানবসভ্যতা দীর্ঘদিন ক্ষমতাধর পুরুষদের');
  assert.equal(out.translations.get('2'), 'শাসনে চলে এসেছে।');
});

test('refineBatch survives a failing meaning check and drops length fixes that make things worse', async () => {
  const start = new Map([['1', 'মানবসভ্যতা দীর্ঘদিন ধরে ক্ষমতাধর পুরুষদের শাসন ও নিয়ন্ত্রণে চলে এসেছে।'], ['2', 'শাসনে।']]);
  let call = 0;
  const ask = async () => {
    call += 1;
    if (call === 1) throw new Error('unreachable');
    return { translations: [{ id: '1', translatedText: 'মানবসভ্যতা দীর্ঘদিন ধরে অনেক অনেক ক্ষমতাধর পুরুষদের শাসন ও নিয়ন্ত্রণে চলে এসেছে।' }] };
  };
  const out = await refineBatch(cues, start, { targetLanguage: 'Bengali', ask });
  // The meaning check, then two length passes: the cue is still long after the first.
  assert.equal(call, 3);
  assert.equal(out.lengthFixed, 0);
  assert.equal(out.meaningFixed, 0);
  assert.deepEqual([...out.translations], [...start]);
});

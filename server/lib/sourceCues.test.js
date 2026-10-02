import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptSourceCues, performanceTag, groupSections, buildSourceCuePrompt, SECTION_SECONDS } from './sourceCues.js';
import { cleanTextForNaturalSpeech, readSettings, NEUTRAL_VOICE } from '../providers/elevenlabs/speech.js';
import { splitPassages } from './ttsText.js';

const line = 'उससे मुक्त होना या उससे अलग होना योग अभ्यास का एक बहुत महत्वपूर्ण पहलू है।';

test('compound tags are kept in canonical form, disallowed parts dropped', () => {
  assert.equal(performanceTag('Explaining,  Calm , slow'), '[explaining, calm, slow]');
  assert.equal(performanceTag('reasoning, intense, authoritative'), '[reasoning]');
  assert.equal(performanceTag('return to anchor'), null);
  assert.equal(performanceTag('sentence-build pause'), '[sentence-build pause]');
  assert.equal(performanceTag('matter_of_fact, fast'), '[matter of fact, fast]');
});

test('tags and pauses are accepted when every word is kept', () => {
  const cued = '[reasoning, serious, slow] उससे मुक्त होना ... [sentence-build pause] [explaining, matter of fact, fast] या उससे अलग होना ... [sentence-build pause] [concluding, firm, normal pace] योग अभ्यास का एक बहुत महत्वपूर्ण पहलू है।';
  assert.equal(acceptSourceCues(line, cued), cued);
});

test('a changed, added or dropped word keeps the line as written', () => {
  assert.equal(acceptSourceCues(line, `[calm] ${line.replace('बहुत', 'काफ़ी')}`), line);
  assert.equal(acceptSourceCues(line, `[calm] ${line} सच में।`), line);
  assert.equal(acceptSourceCues(line, '[calm] ' + line.replace('योग ', '')), line);
  assert.equal(acceptSourceCues(line, ''), line);
});

test('tags outside the vocabulary are removed', () => {
  const accepted = acceptSourceCues(line, `[dramatic music] [intense] [calm, sighs] ${line}`);
  assert.equal(accepted, `[calm] ${line}`);
});

test('cues group into sections by audio length and skip empty cues', () => {
  const cues = [
    { start: 0, end: 30, text: 'a' },
    { start: 30, end: 60, text: '' },
    { start: 60, end: 85, text: 'b' },
    { start: 85, end: 100, text: 'c' },
  ];
  const sections = groupSections(cues);
  assert.equal(SECTION_SECONDS, 90);
  assert.deepEqual(sections.map((s) => s.indexes), [[0, 2], [3]]);
  assert.equal(sections[1].start, 85);
});

test('the prompt carries the framework, the line count and the script', () => {
  const prompt = buildSourceCuePrompt(['पहली पंक्ति।', 'दूसरी पंक्ति।'], 'Hindi');
  assert.match(prompt, /Performance Score Framework/);
  assert.match(prompt, /Return exactly 2 lines/);
  assert.match(prompt, /Hindi dub script/);
  assert.ok(prompt.endsWith('पहली पंक्ति।\nदूसरी पंक्ति।'));
  assert.doesNotMatch(prompt, /English Output Only/);
});

test('performance tags reach the voice only when asked for', () => {
  const text = '[narrating, calm, normal pace] नमस्ते ... [sentence-build pause] [intense] दोस्तों।';
  assert.equal(
    cleanTextForNaturalSpeech(text, { keepPerformanceTags: true }),
    '[narrating, calm, normal pace] नमस्ते ... [sentence-build pause] दोस्तों।'
  );
  assert.equal(cleanTextForNaturalSpeech('[dramatic pause] [calm] नमस्ते।'), 'नमस्ते।');
});

test('tags that push a read towards performance never reach the voice', () => {
  for (const tag of ['dramatic pause', 'jovial', 'playful', 'emphasize', 'word-stretch']) {
    assert.equal(performanceTag(tag), null, tag);
  }
  assert.equal(performanceTag('explaining, playful, calm'), '[explaining, calm]');
  assert.equal(
    cleanTextForNaturalSpeech('[calm] नमस्ते ... [dramatic pause] दोस्तों।', { keepPerformanceTags: true }),
    '[calm] नमस्ते ... दोस्तों।'
  );
});

test('a long script is never cut inside a tag or just after one', () => {
  // The tag straddles the 1000-character limit, so the last word gap before it is inside the tag.
  const text = `${'क '.repeat(492)}[explaining, calm, normal pace] ${'ख '.repeat(100)}`;
  const passages = splitPassages(text, 1000);
  assert.ok(passages.length > 1);
  for (const { text: passage } of passages) {
    assert.equal(passage.split('[').length, passage.split(']').length, 'brackets balanced');
    assert.doesNotMatch(passage, /\]\s*$/);
  }
});

test('voice expression Neutral holds every read calm and even, without slowing it', () => {
  const lively = { stability: 0.3, similarity_boost: 0.6, style: 0.4, use_speaker_boost: true, speed: 1.05 };
  for (const modelId of ['eleven_v3', 'eleven_v4', 'eleven_multilingual_v2']) {
    for (const explicit of [true, false]) {
      const settings = readSettings(lively, modelId, { explicit, count: 3, steady: true }).settings;
      assert.equal(settings.stability, NEUTRAL_VOICE.stability);
      assert.equal(settings.similarity_boost, NEUTRAL_VOICE.similarity_boost);
      assert.equal(settings.style, 0);
      assert.equal(settings.speed, 1.05);
    }
  }
  // A voice already steadier than the floor stays as it is.
  const even = readSettings({ stability: 0.9, similarity_boost: 0.95, style: 0 }, 'eleven_v4', { explicit: false, count: 1, steady: true }).settings;
  assert.equal(even.stability, 0.9);
  assert.equal(even.similarity_boost, 0.95);
  // Without Neutral, settings the user chose are kept.
  assert.deepEqual(readSettings(lively, 'eleven_v3', { explicit: true, count: 3 }).settings, lively);
});

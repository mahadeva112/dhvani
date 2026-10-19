import test from 'node:test';
import assert from 'node:assert/strict';
import { lineSyllables, syllablesIn } from './syllables.js';
import { syllablesIn as appSyllablesIn, timeLine } from '../../services/speechTiming.ts';

const LINES = [
  'जब आप वाकई में जीवन के साथ पूरी तरह से जुड़े होते हैं, तो ऊब का कोई सवाल ही नहीं उठता।',
  'मैं कल सुबह दस बजे बाज़ार नहीं जाऊँगा, क्योंकि बारिश होगी',
  'ধীরে-ধীরে আপনি নিজের স্বাস্থ্য বুঝতে পারবেন।',
  'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ, ਤੁਸੀਂ ਕਿਵੇਂ ਹੋ?',
  'நீங்கள் எப்படி இருக்கிறீர்கள்?',
  'మీరు ఎలా ఉన్నారు, మిత్రమా?',
  'When you are truly involved with life, there is no question of boredom.',
  'Sadhguru कहते हैं कि 2024 में Isha Yoga Center…',
];

test('the server counts syllables exactly as the app does', () => {
  for (const line of LINES) {
    assert.equal(lineSyllables(line), timeLine(line, 1).syllables, line);
    for (const word of line.split(/\s+/)) assert.equal(syllablesIn(word), appSyllablesIn(word), word);
  }
});

test('joined consonants are one syllable, and a dropped final vowel is not counted', () => {
  assert.equal(syllablesIn('प्रेम'), 1);
  assert.equal(syllablesIn('कमल'), 2);
  assert.equal(syllablesIn('मित्र'), 2);
  assert.equal(lineSyllables(''), 0);
  assert.equal(lineSyllables('…, ।'), 0);
});

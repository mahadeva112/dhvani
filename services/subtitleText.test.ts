import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasPunctuation, stripPunctuation, stripSubtitlePunctuation } from './subtitleText.ts';

test('takes every Indic mark off: danda, double danda, abbreviation sign', () => {
  assert.equal(stripPunctuation('यह सच है। और यह भी॥'), 'यह सच है और यह भी');
  assert.equal(stripPunctuation('डॉ॰ शर्मा'), 'डॉ शर्मा');
  assert.equal(stripPunctuation('আমি যাব।'), 'আমি যাব');
});

test('takes the | typed for a danda off', () => {
  assert.equal(stripPunctuation('यह सच है | और यह भी ||'), 'यह सच है और यह भी');
});

test('takes curly quotes, ellipsis, dashes and Arabic/CJK marks off', () => {
  assert.equal(stripPunctuation('“क्या?” उसने कहा… — फिर चुप'), 'क्या उसने कहा फिर चुप');
  assert.equal(stripPunctuation('کیا؟ ہاں، ٹھیک۔'), 'کیا ہاں ٹھیک');
  assert.equal(stripPunctuation('好。是、吗？'), '好 是 吗');
  assert.equal(stripPunctuation('¿Qué? ¡Sí!'), 'Qué Sí');
});

test('a hyphenated pair becomes two words', () => {
  assert.equal(stripPunctuation('धीरे-धीरे'), 'धीरे धीरे');
});

test('keeps words and numbers whole', () => {
  assert.equal(stripPunctuation("don't stop"), 'dont stop');
  assert.equal(stripPunctuation('2.5 सेकंड, 10,000 लोग, 10:30 बजे।'), '2.5 सेकंड 10,000 लोग 10:30 बजे');
  assert.equal(stripPunctuation('50% और ₹100'), '50% और ₹100');
});

test('a mark on its own leaves nothing', () => {
  assert.equal(stripPunctuation('।'), '');
  assert.equal(stripPunctuation(' — '), '');
});

test('a subtitle keeps its line breaks', () => {
  assert.equal(stripSubtitlePunctuation('पहली पंक्ति,\nदूसरी पंक्ति।'), 'पहली पंक्ति\nदूसरी पंक्ति');
  assert.equal(stripSubtitlePunctuation('शब्द\n।'), 'शब्द');
});

test('tells whether any punctuation is left', () => {
  assert.equal(hasPunctuation('पहली पंक्ति\nदूसरी पंक्ति'), false);
  assert.equal(hasPunctuation('पहली पंक्ति।'), true);
});

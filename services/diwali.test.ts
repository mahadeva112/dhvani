import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDiwaliTime, localDay } from './diwali.ts';

test('Diwali days run from two days before to four days after', () => {
  assert.equal(isDiwaliTime(new Date(2026, 10, 5, 23, 59)), false);
  assert.equal(isDiwaliTime(new Date(2026, 10, 6, 0, 1)), true);
  assert.equal(isDiwaliTime(new Date(2026, 10, 8, 9)), true);
  assert.equal(isDiwaliTime(new Date(2026, 10, 12, 23, 59)), true);
  assert.equal(isDiwaliTime(new Date(2026, 10, 13, 0, 1)), false);
  assert.equal(isDiwaliTime(new Date(2027, 9, 29)), true);
});

test('Off the table for years with no date', () => {
  assert.equal(isDiwaliTime(new Date(2040, 10, 8)), false);
});

test('Local day as YYYY-MM-DD', () => {
  assert.equal(localDay(new Date(2026, 10, 8, 15)), '2026-11-08');
});

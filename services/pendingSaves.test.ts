import test from 'node:test';
import assert from 'node:assert/strict';
import { savesPending, trackSave, whenSaved } from './pendingSaves.ts';

const later = <T>(ms: number, value: T, fail = false) =>
  new Promise<T>((resolve, reject) => setTimeout(() => (fail ? reject(new Error('refused')) : resolve(value)), ms));

test('whenSaved waits for every save, failed ones included', async () => {
  const order: string[] = [];
  trackSave(later(20, 'a')).then(() => order.push('a'));
  trackSave(later(5, 'b', true)).catch(() => order.push('b failed'));
  assert.equal(savesPending(), 2);
  await whenSaved();
  assert.equal(savesPending(), 0);
  assert.deepEqual(order.sort(), ['a', 'b failed']);
});

test('a save started while waiting is waited for too', async () => {
  let second = false;
  trackSave(later(10, 1)).then(() => {
    trackSave(later(10, 2)).then(() => (second = true));
  });
  await whenSaved();
  assert.equal(second, true);
  assert.equal(savesPending(), 0);
});

test('with nothing under way it settles at once', async () => {
  await whenSaved();
  assert.equal(savesPending(), 0);
});

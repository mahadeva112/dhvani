import test from 'node:test';
import assert from 'node:assert/strict';
import { rowsInView } from './useWindowRows.ts';

/** Where each of `count` rows `height` tall starts, and where they end. */
const even = (count: number, height: number) => Float64Array.from({ length: count + 1 }, (_, i) => i * height);

test('only the rows in view are drawn, with the overscan either side', () => {
  const offsets = even(2500, 60);
  // 600 px of view at row 1000, 300 px more either side: rows 995 up to 1015.
  assert.deepEqual(rowsInView(offsets, 60_000, 600, 300), { start: 995, end: 1015 });
});

test('a row cut by the top or bottom of the view is drawn', () => {
  const offsets = even(100, 50);
  // From 25 px into row 2 to 25 px into row 6.
  assert.deepEqual(rowsInView(offsets, 125, 200, 0), { start: 2, end: 7 });
});

test('the window stops at the first and last rows', () => {
  const offsets = even(100, 50);
  assert.deepEqual(rowsInView(offsets, 0, 300, 900), { start: 0, end: 24 });
  assert.deepEqual(rowsInView(offsets, 4700, 300, 900), { start: 76, end: 100 });
  // Scrolled past the end (rows removed under the view): nothing above the last rows is lost.
  assert.deepEqual(rowsInView(offsets, 9000, 300, 0), { start: 100, end: 100 });
});

test('rows of different heights are found by where they start', () => {
  // 10, 200, 10, 10, 200 px tall.
  const offsets = Float64Array.from([0, 10, 210, 220, 230, 430]);
  assert.deepEqual(rowsInView(offsets, 15, 10, 0), { start: 1, end: 2 });
  assert.deepEqual(rowsInView(offsets, 205, 20, 0), { start: 1, end: 4 });
});

test('a list with no height yet draws its first rows', () => {
  const offsets = even(2500, 60);
  assert.deepEqual(rowsInView(offsets, 0, 0, 900), { start: 0, end: 40 });
  assert.deepEqual(rowsInView(even(5, 60), 0, 0, 900), { start: 0, end: 5 });
});

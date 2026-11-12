const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeFreezeTrace } = require('./freezeTrace.cjs');

const meta = (tid, name) => ({ ph: 'M', name: 'thread_name', pid: 1, tid, args: { name } });
const span = (tid, name, ts, dur, args) => ({ ph: 'X', pid: 1, tid, name, ts, dur, ...(args && { args }) });

test('a freeze is summed by the work the page did itself, not the tasks wrapping it', () => {
  const lines = summarizeFreezeTrace({
    traceEvents: [
      meta(1, 'CrRendererMain'),
      meta(2, 'Compositor'),
      span(1, 'RunTask', 0, 9_000_000),
      span(1, 'MajorGC', 100, 6_000_000),
      span(1, 'FunctionCall', 6_000_200, 2_900_000, { data: { functionName: 'computePeaks', url: 'http://x/assets/index.js', lineNumber: 41 } }),
      span(1, 'Layout', 8_950_000, 40_000),
      span(2, 'MajorGC', 0, 50_000_000),
    ],
  });
  assert.deepEqual(lines, ['6000 ms  MajorGC', '2900 ms  script computePeaks index.js:42']);
});

test('a trace without the page says so', () => {
  assert.deepEqual(summarizeFreezeTrace([meta(2, 'Compositor')]), ['the trace has nothing from the page']);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeFreezeTrace, describeFreezeMemory } = require('./freezeTrace.cjs');

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

test('a freeze note says what the page and the app held, and what the page last had open', () => {
  const GB = 1024 * 1024; // metrics are in KB
  const lines = describeFreezeMemory({
    metrics: [
      { pid: 10, type: 'Browser', memory: { workingSetSize: 200 * 1024 } },
      { pid: 11, type: 'Tab', memory: { workingSetSize: 3 * GB, privateBytes: 2.5 * GB, peakWorkingSetSize: 4 * GB } },
      { pid: 12, type: 'GPU', memory: { workingSetSize: 300 * 1024 } },
    ],
    pagePid: 11,
    freeBytes: 512 * 1024 * 1024,
    totalBytes: 16 * 1024 * 1024 * 1024,
    status: { heap: 900 * 1024 * 1024, seconds: 9000, lines: 1500, original: 'as peaks', dub: 'as peaks', steps: 640, projects: 3, decoded: 1 },
    ageMs: 6200,
  });
  assert.deepEqual(lines, [
    'memory: page 3072 MB (2560 MB its own), peak 4096 MB; whole app 3572 MB; computer 512 MB free of 16384 MB',
    'last heard from the page 6 s before: script memory 900 MB, project 2:30:00, 1500 lines, original as peaks, dub as peaks, 640 undo steps, 3 projects, 1 with audio decoded whole',
  ]);
});

test('without the page process or a status, the memory line still says what it can', () => {
  assert.deepEqual(describeFreezeMemory({ metrics: [{ pid: 1, memory: { workingSetSize: 1024 } }], pagePid: 9, freeBytes: 0, totalBytes: 0 }), [
    'memory: page not found; whole app 1 MB; computer 0 MB free of 0 MB',
  ]);
  assert.equal(describeFreezeMemory({ metrics: [], status: {} }).length, 1);
});

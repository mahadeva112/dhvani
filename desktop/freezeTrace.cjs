/**
 * What a frozen page spent its time on, from a Chromium trace taken while it
 * was frozen. The page's own call stack can't say: when the page is busy
 * outside script (decoding audio, collecting garbage, laying out, copying a
 * big buffer) it comes back empty, as in the problem reports of 2026-11-12.
 */

/** Events that only wrap others; their time is their children's. */
const WRAPPERS = new Set([
  'RunTask',
  'ThreadControllerImpl::RunTask',
  'ThreadPool_RunTask',
  'SequenceManager::DoIdleWork',
  'TimerBase::run',
  'ScheduledAction::execute',
  'v8.run',
  'V8.Execute',
  'v8.callFunction',
  'RunMicrotasks',
  'FunctionCall',
  'EvaluateScript',
  'v8.compile',
  'V8.StackGuard',
  'V8.HandleInterrupts',
]);

const ms = (us) => Math.round(us / 1000);

/**
 * A few lines for the log: the page's busiest kinds of work by time spent in
 * them alone (not in what they called), and the script functions that ran
 * longest.
 */
const summarizeFreezeTrace = (trace, { top = 8 } = {}) => {
  const events = Array.isArray(trace) ? trace : trace?.traceEvents || [];
  const threadNames = new Map();
  for (const e of events) if (e.name === 'thread_name' && e.ph === 'M') threadNames.set(`${e.pid}:${e.tid}`, e.args?.name);
  const onMain = (e) => threadNames.get(`${e.pid}:${e.tid}`) === 'CrRendererMain';
  const spans = events.filter((e) => e.ph === 'X' && onMain(e) && Number.isFinite(e.dur) && e.dur > 0).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  if (spans.length === 0) return ['the trace has nothing from the page'];

  // Time each event spent outside its children, per thread.
  const self = new Map();
  const scripts = new Map();
  const stacks = new Map();
  for (const e of spans) {
    const key = `${e.pid}:${e.tid}`;
    const stack = stacks.get(key) || [];
    stacks.set(key, stack);
    while (stack.length && stack[stack.length - 1].end <= e.ts) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.self -= Math.min(e.dur, parent.end - e.ts);
    const frame = { e, end: e.ts + e.dur, self: e.dur };
    stack.push(frame);
    self.set(frame, true);
    if (e.name === 'FunctionCall' || e.name === 'EvaluateScript') {
      const data = e.args?.data || {};
      const file = String(data.url || '').split('/').pop() || '(page)';
      const where = `${data.functionName || '(anonymous)'} ${file}:${(data.lineNumber ?? -1) + 1}`;
      scripts.set(where, (scripts.get(where) || 0) + e.dur);
    }
  }
  const byName = new Map();
  for (const frame of self.keys()) {
    if (WRAPPERS.has(frame.e.name) || frame.self <= 0) continue;
    byName.set(frame.e.name, (byName.get(frame.e.name) || 0) + frame.self);
  }
  const busiest = [...byName].sort((a, b) => b[1] - a[1]).slice(0, top).filter(([, t]) => t >= 50_000);
  const longest = [...scripts].sort((a, b) => b[1] - a[1]).slice(0, 4).filter(([, t]) => t >= 200_000);
  const lines = busiest.map(([name, t]) => `${ms(t)} ms  ${name}`);
  if (longest.length) lines.push(...longest.map(([where, t]) => `${ms(t)} ms  script ${where}`));
  return lines.length ? lines : ['nothing on the page took long while it was traced'];
};

/** Trace categories: the page's work, script and garbage collection, without the heavy samplers. */
const FREEZE_TRACE_CATEGORIES = ['devtools.timeline', 'v8', 'v8.execute', 'blink', 'loading', 'disabled-by-default-devtools.timeline'];

module.exports = { summarizeFreezeTrace, FREEZE_TRACE_CATEGORIES };

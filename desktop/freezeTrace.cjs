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

const megabytes = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;
const clock = (seconds) => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * What a frozen page held, for its freeze note: the memory of its process
 * and of the whole app (Electron's app metrics, in KB), the computer's free
 * memory, and what the page last said it had open (the status it answers
 * the freeze ping with, `ageMs` before). A freeze from running short of
 * memory looks just like one from work; these say which.
 */
const describeFreezeMemory = ({ metrics = [], pagePid, freeBytes, totalBytes, status, ageMs } = {}) => {
  const kb = (n) => megabytes((n || 0) * 1024);
  const page = metrics.find((m) => m.pid === pagePid);
  const all = metrics.reduce((sum, m) => sum + (m.memory?.workingSetSize || 0), 0);
  const lines = [];
  const pageMemory = page
    ? `page ${kb(page.memory.workingSetSize)}${page.memory.privateBytes ? ` (${kb(page.memory.privateBytes)} its own)` : ''}${page.memory.peakWorkingSetSize ? `, peak ${kb(page.memory.peakWorkingSetSize)}` : ''}`
    : 'page not found';
  lines.push(`memory: ${pageMemory}; whole app ${kb(all)}; computer ${megabytes(freeBytes || 0)} free of ${megabytes(totalBytes || 0)}`);
  if (status && typeof status === 'object') {
    const said = [];
    if (status.heap > 0) said.push(`script memory ${megabytes(status.heap)}`);
    if (status.seconds > 0) said.push(`project ${clock(status.seconds)}`);
    if (status.lines > 0) said.push(`${status.lines} lines`);
    if (status.original) said.push(`original ${status.original}`);
    if (status.dub) said.push(`dub ${status.dub}`);
    if (status.steps > 0) said.push(`${status.steps} undo steps`);
    if (status.projects > 1) said.push(`${status.projects} projects`);
    if (status.decoded > 0) said.push(`${status.decoded} with audio decoded whole`);
    if (said.length) lines.push(`last heard from the page ${Math.round((ageMs || 0) / 1000)} s before: ${said.join(', ')}`);
  }
  return lines;
};

module.exports = { summarizeFreezeTrace, describeFreezeMemory, FREEZE_TRACE_CATEGORIES };

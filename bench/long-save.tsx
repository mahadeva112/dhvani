// Long save bench: what one edit costs in a 2.5-hour project of 1500 lines
// with a synced dub, as the app saves it: the undo step (services/
// projectHistory.ts) and the project written to IndexedDB. Open
// bench/long-save.html on the Vite dev server (launch config "bench") and
// call window.runSave(). It writes one project to this page's own
// IndexedDB (the bench origin, not the app's) and deletes it after.
// Nothing here reaches the app's build: Vite builds index.html only.
import { describeProjectChange, HISTORY_FIELDS, keepRecentSyncs, recordProjectStep, toStoredHistory, type HistoryState, type ProjectHistory } from '../services/projectHistory';
import { deleteJobFromStorage, getAllJobsFromStorage, saveJobToStorage } from '../services/storageService';
import type { AudioSegment, BatchJob } from '../types';

const SECONDS = 2.5 * 3600;
const LINES = 1500;

let seed = 12345;
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const HINDI = 'मैं तुम हम वह यह जीवन मन शरीर ऊर्जा ध्यान सवाल जवाब लोग दुनिया समय काम घर रास्ता अनुभव समझ इच्छा शांति आनंद प्रेम भक्ति सत्य'.split(' ');
const ENGLISH = 'I you we he this life mind body energy meditation question answer people world time work home path experience understanding desire peace joy love devotion truth'.split(' ');
const pick = (list: string[], n: number) => Array.from({ length: n }, () => list[Math.floor(random() * list.length)]).join(' ');

/** A synced project of 1500 lines, shaped as the app keeps one. */
const makeJob = (): BatchJob => {
  const step = SECONDS / LINES;
  const segments: AudioSegment[] = [];
  const lines: unknown[] = [];
  const units: unknown[] = [];
  for (let i = 0; i < LINES; i++) {
    const start = i * step;
    const end = start + step * 0.8;
    const n = 6 + Math.floor(random() * 10);
    const source = pick(ENGLISH, n) + '.';
    const target = pick(HINDI, n + 1) + '।';
    const each = (end - start) / n;
    const words = source.split(' ').map((text, k) => ({ text, start: start + k * each, end: start + (k + 0.85) * each, type: 'word', speaker_id: 'speaker_0', logprob: -0.01 }));
    segments.push({ id: i + 1, startTime: start, endTime: end, duration: end - start, speaker: 'Speaker 1', originalText: source, textSource: source, targetText: target, textTarget: target, words } as unknown as AudioSegment);
    const key = String(i + 1);
    lines.push({ key, speaker: 'Speaker 1', bankStart: i * 200000, length: 190000, startSample: Math.round(start * 48000), lead: 0.12, speech: 3.4, gain: 1, hash: Math.random().toString(36).slice(2), cuts: [{ start: 0.5, end: 0.9 }], crossfade: 0.01 });
    units.push({
      index: i, key, cueIds: [i + 1], speaker: 'Speaker 1', text: target, sourceText: source, srcStart: start, srcEnd: end, placedStart: start + 0.05, placedEnd: end - 0.1,
      offset: 0.05, overrun: null, inSync: true, silent: false, exceeded: false, exceededBy: 0, voiceId: 'v1',
      wordTiming: { status: 'measured', startError: 0.01, endError: 0.02, words: words.map((w) => ({ text: w.text, start: w.start, end: w.end })) },
    });
  }
  const takes: Record<string, unknown> = {};
  for (let i = 0; i < 200; i++) takes[String(i * 7 + 1)] = { active: 't1', takes: [{ id: 'sync', text: 'x' }, { id: 't1', text: pick(HINDI, 8), bankStart: 1e8 + i * 1e5, length: 90000, voiceId: 'v1' }] };
  const edits: Record<string, unknown> = {};
  for (let i = 0; i < 100; i++) edits[String(i * 13 + 1)] = { parts: [{ id: 'p1', start: i * 9, from: 0, to: 3, rate: 1, gainDb: 0, fadeIn: 0, fadeOut: 0, muted: false }] };
  return {
    id: 'bench-long-save',
    name: 'bench',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    file: new File([new Uint8Array(1024)], 'long.m4a', { type: 'audio/mp4' }),
    status: 'idle',
    segments,
    syncBank: { bankId: 'b1', sampleRate: 48000, float: false, lines, speakerGains: {} },
    syncBaseReport: { duration: SECONDS, units },
    syncTakes: takes,
    syncEdits: edits,
    syncEpoch: 'first',
  } as unknown as BatchJob;
};

const stateOf = (job: BatchJob): HistoryState => Object.fromEntries(HISTORY_FIELDS.map((field) => [field, (job as any)[field] ?? null])) as HistoryState;

/** One edit as the app makes it: the step (as App's withHistoryStep), then the save. */
const edit = async (job: BatchJob, n: number) => {
  const i = (n * 37) % LINES;
  const segments = job.segments.map((seg, k) => (k === i ? ({ ...seg, targetText: seg.targetText + ' क', textTarget: seg.targetText + ' क' } as AudioSegment) : seg));
  const t0 = performance.now();
  const before = stateOf(job);
  const after = { ...before, segments };
  const change = describeProjectChange(before, after)!;
  const recorded = recordProjectStep(job.projectHistory as ProjectHistory | null, before, after, { label: change.label, key: `${change.key ?? ''}${n}` });
  const { history } = keepRecentSyncs(recorded, 'first');
  const t1 = performance.now();
  const next = { ...job, segments, projectHistory: history } as BatchJob;
  // The copy IndexedDB makes of the record, on this thread, as put() does (storageService writes the history in its stored form).
  structuredClone({ ...next, file: null, projectHistory: null, storedHistory: next.projectHistory ? toStoredHistory(next.projectHistory) : null });
  const t2 = performance.now();
  await saveJobToStorage(next);
  const t3 = performance.now();
  return { job: next, step: t1 - t0, copy: t2 - t1, save: t3 - t2 };
};

const sizeOf = (history: ProjectHistory | null | undefined) => {
  if (!history) return { steps: 0, pool: 0, refs: 0, jsonMB: 0 };
  const refs = history.steps.reduce((n, s) => n + s.segments.length + (s.dub?.bank?.lines.length ?? 0) + (s.dub?.base?.units.length ?? 0), 0);
  return { steps: history.steps.length, pool: history.pool.length, refs, jsonMB: Math.round(JSON.stringify(history).length / 1e5) / 10 };
};

const round = (x: number) => Math.round(x);

(window as any).runSave = async ({ steps = 300, afterReload = 20 } = {}) => {
  let job = makeJob();
  const out: Record<string, unknown>[] = [];
  const marks = new Set([1, 2, 10, 50, 100, 200, 300, 500, 750, 1000, steps]);
  for (let n = 1; n <= steps; n++) {
    const r = await edit(job, n);
    job = r.job;
    if (marks.has(n)) out.push({ edit: n, stepMs: round(r.step), copyMs: round(r.copy), saveMs: round(r.save), ...sizeOf(job.projectHistory) });
  }
  // As it is read back after a restart.
  const t0 = performance.now();
  job = (await getAllJobsFromStorage()).jobs.find((j) => j.id === 'bench-long-save')!;
  out.push({ edit: 'read back', ms: round(performance.now() - t0), shared: job.segments[0] === job.projectHistory!.pool[job.projectHistory!.steps[job.projectHistory!.at].segments[0]] });
  let worst = { step: 0, copy: 0, save: 0 };
  for (let n = 1; n <= afterReload; n++) {
    const r = await edit(job, steps + n);
    job = r.job;
    worst = { step: Math.max(worst.step, r.step), copy: Math.max(worst.copy, r.copy), save: Math.max(worst.save, r.save) };
    if (n === 1 || n === afterReload) out.push({ edit: `after reload ${n}`, stepMs: round(r.step), copyMs: round(r.copy), saveMs: round(r.save) });
  }
  await deleteJobFromStorage('bench-long-save');
  const result = { lines: LINES, rows: out, projectMB: Math.round(JSON.stringify({ ...job, file: null }).length / 1e5) / 10 };
  (window as any).saveResult = result;
  return result;
};

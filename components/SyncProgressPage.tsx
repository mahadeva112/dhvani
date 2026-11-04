import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Timer, X } from 'lucide-react';
import { SYNC_STEPS, type SyncProgress, type SyncReport } from '../services/syncService';
import type { DubProgress } from '../services/elevenLabsService';
import { syncFraction, SyncVerdictBadge } from './SyncPanel';

/**
 * The Dub step while Dub & sync runs: what Sync is doing, how far it is, and
 * Cancel, with no settings. Sync reports its step and counts (how many lines
 * it has voiced, not which); the times, each step's length and the activity
 * are measured here, from when those change. Once a sync it watched ends, the
 * page shows the result until Open the dub.
 */

type Phase = (typeof SYNC_STEPS)[number]['phase'];

/** What each step is for, under its name. */
const STEP_WHY: Record<Phase, string> = {
  units: 'Where each line starts and stops in the original.',
  voicing: 'The voice reads each line for its own slot.',
  fitting: 'Each take against the time its line has.',
  placing: "Chunks go on the original's words; pauses close up.",
  rendering: 'One file, with loudness, breaths and fades as set.',
  checking: 'Lists the lines worth a listen.',
  suggesting: 'Shorter or fuller wordings for lines that are off.',
};

export interface SyncRunEntry {
  at: number;
  text: string;
  /** Seconds the thing took, shown at the right. */
  took?: number;
  strong?: boolean;
  /** An entry of a kind that counts up (word checks, suggestions) is updated in place, not added again. */
  kind?: string;
}

export interface SyncRun {
  startedAt: number;
  endedAt: number | null;
  log: SyncRunEntry[];
  /** Per step (1-based): when it last started, and the seconds it has run before that. */
  steps: Record<number, { start: number | null; took: number }>;
  /** When the first line was voiced and how many were by then, for the estimate of what is left. */
  voicingFrom: { at: number; voiced: number } | null;
  /** The last progress Sync reported, for the counts once it has ended (App clears its own). */
  last: SyncProgress | null;
}

const MAX_LOG = 80;
const stepLabel = (step: number) => SYNC_STEPS[step - 1]?.label ?? 'Working';

const push = (log: SyncRunEntry[], entry: SyncRunEntry) => {
  const last = log[log.length - 1];
  const next = entry.kind && last?.kind === entry.kind ? [...log.slice(0, -1), entry] : [...log, entry];
  return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
};

/**
 * Follows one sync as it runs: when it started, each step's length, and what
 * happened, from the progress Sync reports. Kept by the step (not the page),
 * so leaving the Dub step and coming back keeps it.
 */
export const useSyncRun = (isSyncing: boolean, progress: SyncProgress | null, waitingFor: string | null): SyncRun | null => {
  const [run, setRun] = useState<SyncRun | null>(null);
  const last = useRef<SyncProgress | null>(null);

  useEffect(() => {
    const now = Date.now();
    if (isSyncing) {
      setRun((r) => (r && r.endedAt === null ? r : { startedAt: now, endedAt: null, log: [{ at: now, text: 'Dub & sync started', strong: true }], steps: {}, voicingFrom: null, last: null }));
    } else {
      setRun((r) => {
        if (!r || r.endedAt !== null) return r;
        const steps = { ...r.steps };
        for (const key of Object.keys(steps)) {
          const s = steps[Number(key)];
          if (s.start !== null) steps[Number(key)] = { start: null, took: s.took + (now - s.start) / 1000 };
        }
        return { ...r, endedAt: now, steps };
      });
    }
    last.current = null;
  }, [isSyncing]);

  useEffect(() => {
    if (!isSyncing || !waitingFor) return;
    setRun((r) => (r ? { ...r, log: push(r.log, { at: Date.now(), text: `Waiting for “${waitingFor}” to finish dubbing`, kind: 'waiting' }) } : r));
  }, [isSyncing, waitingFor]);

  useEffect(() => {
    if (!isSyncing || !progress || progress.step < 1) return;
    const prev = last.current;
    last.current = progress;
    setRun((r) => {
      if (!r) return r;
      const now = Date.now();
      let { log, voicingFrom } = r;
      const steps = { ...r.steps };
      if (!prev || prev.step !== progress.step) {
        if (prev) {
          const was = steps[prev.step];
          const took = was?.start ? (was.took ?? 0) + (now - was.start) / 1000 : was?.took ?? 0;
          steps[prev.step] = { start: null, took };
          if (prev.step === 1 && progress.unitCount > 0) log = push(log, { at: now, text: `Read the source timings: ${progress.unitCount} lines`, took });
          else if (prev.step === 2)
            log = push(log, {
              at: now,
              text: prev.unitsToVoice > 0 ? `Voiced ${Math.min(prev.unitsVoiced, prev.unitsToVoice)} of ${prev.unitsToVoice} lines` : 'Every line kept its take',
              took,
              strong: true,
              // In place of the last "n of m lines voiced", which says the same.
              kind: 'voiced',
            });
          else log = push(log, { at: now, text: `${stepLabel(prev.step)}: done`, took });
        }
        steps[progress.step] = { start: now, took: steps[progress.step]?.took ?? 0 };
        if (progress.step === 2 && prev && prev.step > 2) log = push(log, { at: now, text: `Voicing ${progress.unitsToVoice - prev.unitsToVoice} long lines again for a take that fits` });
      }
      if (progress.step === 2 && progress.unitCount > 0 && (!prev || prev.step !== 2) && progress.unitsToVoice < progress.unitCount) {
        const kept = progress.unitCount - progress.unitsToVoice;
        log = push(log, { at: now, text: `${kept} ${kept === 1 ? 'line keeps its take' : 'lines keep their takes'}: nothing in ${kept === 1 ? 'it' : 'them'} changed` });
      }
      if (progress.step === 2 && prev && progress.unitsVoiced > prev.unitsVoiced) {
        log = push(log, { at: now, text: `${Math.min(progress.unitsVoiced, progress.unitsToVoice)} of ${progress.unitsToVoice} lines voiced`, kind: 'voiced' });
        if (!voicingFrom) voicingFrom = { at: now, voiced: progress.unitsVoiced };
      }
      if (progress.wordChecksTotal && progress.wordChecksDone !== prev?.wordChecksDone)
        log = push(log, { at: now, text: `Word timing checked on ${progress.wordChecksDone ?? 0} of ${progress.wordChecksTotal} lines`, kind: 'words' });
      if (progress.suggestionsTotal > 0 && progress.suggestionsDone !== prev?.suggestionsDone)
        log = push(log, { at: now, text: `${progress.suggestionsDone} of ${progress.suggestionsTotal} wordings suggested`, kind: 'suggest' });
      return { ...r, log, steps, voicingFrom, last: progress };
    });
  }, [isSyncing, progress]);

  return run;
};

/**
 * Whether the Dub step shows this page: while a sync runs, and once one it
 * watched has ended with a new report, until Open the dub. Decided while
 * rendering, not after, so the moment the sync ends the page turns into
 * Dubbed with nothing in between (deciding it in an effect drew the whole dub
 * page for a moment, then this page again, fading in a second time). A
 * cancelled or failed sync leaves the report as it was and goes straight back.
 */
export const useSyncPageView = (
  isSyncing: boolean,
  jobId: string | null,
  report: SyncReport | null,
  onDubStep: boolean
): { show: boolean; done: SyncReport | null; open: () => void } => {
  /** The project being dubbed, the report it had when the sync started, and whether that sync has ended. */
  const [watch, setWatch] = useState<{ jobId: string; before: SyncReport | null; ended: boolean } | null>(null);
  const finished = Boolean(!isSyncing && watch && watch.jobId === jobId && onDubStep && report && report !== watch.before);
  if (isSyncing) {
    // A sync started while the last one's result shows is a new one to watch.
    if (jobId && (watch?.jobId !== jobId || watch.ended)) setWatch({ jobId, before: report, ended: false });
  } else if (watch && !finished) setWatch(null);
  else if (watch && !watch.ended) setWatch({ ...watch, ended: true });
  return { show: isSyncing || finished, done: finished ? report : null, open: () => setWatch(null) };
};

const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const timeOfDay = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export interface SyncProgressPageProps {
  run: SyncRun | null;
  progress: SyncProgress | null;
  /** A continuous read: how far the one take is. */
  reading?: DubProgress | null;
  waitingFor?: string | null;
  isCancelling?: boolean;
  onCancel: () => void;
  /** The sync this page watched has ended: its report, shown until Open the dub. */
  done?: SyncReport | null;
  onOpen: () => void;
  characters: number;
  /** "00_Tanmay Bhat Podcast · Eleven v4 · line by line". */
  about: string;
  /** Suggestions are asked for, so the last step runs. */
  suggesting?: boolean;
}

export const SyncProgressPage: React.FC<SyncProgressPageProps> = ({
  run,
  progress,
  reading = null,
  waitingFor = null,
  isCancelling = false,
  onCancel,
  done = null,
  onOpen,
  characters,
  about,
  suggesting = false,
}) => {
  // Once it has ended, the counts are the last ones Sync reported.
  if (!progress && done) progress = run?.last ?? null;
  // The clocks tick while it runs.
  const [, tick] = useState(0);
  useEffect(() => {
    if (done) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [done]);
  const now = Date.now();

  const steps = SYNC_STEPS.filter((s) => s.phase !== 'suggesting' || suggesting || (progress?.step ?? 0) === 7 || (done?.summary.suggestionsAsked ?? 0) > 0);
  const step = done ? SYNC_STEPS.length + 1 : progress?.step ?? 0;
  const waiting = Boolean(waitingFor) && !done;
  const pct = done ? 100 : waiting ? null : Math.round(Math.min(0.98, syncFraction(progress)) * 100);

  const unitCount = progress?.unitCount ?? 0;
  const toVoice = progress?.unitsToVoice ?? 0;
  const voiced = Math.min(progress?.unitsVoiced ?? 0, toVoice);
  const kept = step >= 2 && unitCount > 0 ? Math.max(0, unitCount - toVoice) : 0;
  const continuous = Boolean(reading && reading.phase !== 'done' && reading.totalChars > 0);
  const readShare = continuous ? Math.min(1, reading!.charsDone / reading!.totalChars) : 0;

  /** How far one step is, 0–1, for its bar and its share of the long bar. */
  const partOf = (n: number) => {
    if (n < step) return 1;
    if (n > step || !progress) return 0;
    if (n === 2) return continuous ? readShare : toVoice > 0 ? voiced / toVoice : 0;
    if (n === 4 && progress.wordChecksTotal) return (progress.wordChecksDone ?? 0) / progress.wordChecksTotal;
    if (n === 7 && progress.suggestionsTotal > 0) return progress.suggestionsDone / progress.suggestionsTotal;
    return 0;
  };
  const tookOf = (n: number) => {
    const s = run?.steps[n];
    if (!s) return null;
    // A step still open when the page turns to Dubbed (its end is noted just after) runs to now.
    return s.took + (s.start !== null ? (now - s.start) / 1000 : 0);
  };
  const detailOf = (n: number, phase: Phase): string => {
    const state = n < step ? 'done' : n === step ? 'now' : 'next';
    if (state === 'next') return 'Next';
    if (!progress && !done) return 'Working…';
    switch (phase) {
      case 'units':
        return unitCount > 0 ? `${unitCount} lines` : state === 'done' ? 'Done' : 'Working…';
      case 'voicing':
        if (state === 'now') return continuous ? `Reading in one take · ${Math.round(readShare * 100)}%` : toVoice > 0 ? `${voiced} of ${toVoice} lines` : 'Working…';
        return toVoice === 0 && unitCount > 0 ? 'Every line kept its take' : `${toVoice || unitCount} voiced${kept ? `, ${kept} kept` : ''}`;
      case 'placing':
        if (state === 'now') return progress?.wordChecksTotal ? `Word timing ${progress.wordChecksDone ?? 0} of ${progress.wordChecksTotal}` : 'Working…';
        return 'On the original';
      case 'suggesting':
        if (state === 'now') return progress && progress.suggestionsTotal > 0 ? `${progress.suggestionsDone} of ${progress.suggestionsTotal}` : 'Working…';
        return done ? `${done.summary.suggested} suggested` : 'Done';
      case 'fitting':
        return state === 'now' ? 'Working…' : done ? `${done.summary.lines - done.summary.exceeded} fit, ${done.summary.exceeded} run long` : 'Done';
      case 'checking':
        return state === 'now' ? 'Working…' : done ? `${done.summary.exceeded + done.summary.short} worth a listen` : 'Done';
      default:
        return state === 'now' ? 'Working…' : 'Done';
    }
  };

  // What is left of the voicing, at the rate the lines have come in so far; nothing is guessed for the other steps.
  const vf = run?.voicingFrom;
  const leftToVoice =
    !done && step === 2 && vf && voiced > vf.voiced && toVoice > voiced ? ((now - vf.at) / 1000 / (voiced - vf.voiced)) * (toVoice - voiced) : null;
  const elapsed = run ? ((done && run.endedAt ? run.endedAt : now) - run.startedAt) / 1000 : 0;

  const nowLine = waiting
    ? `“${waitingFor}” is dubbing first. This dub starts on its own when it finishes.`
    : done
      ? null
      : !progress
        ? 'Starting…'
        : step === 2
          ? continuous
            ? `${stepLabel(2)} · reading the script in one take, ${Math.round(readShare * 100)}%`
            : toVoice > 0
              ? `${stepLabel(2)} · ${voiced} of ${toVoice} voiced`
              : stepLabel(2)
          : step === 4 && progress.wordChecksTotal
            ? `${stepLabel(4)} · word timing ${progress.wordChecksDone ?? 0} of ${progress.wordChecksTotal}`
            : stepLabel(step);

  // One box per line: by count while it runs (kept takes, then the lines voiced), each line's fit once done.
  const cells: { cls: string; label: string; sub: string; title?: string }[] = done
    ? done.units.map((u, i) => {
        const cls = u.exceeded ? 'long' : u.short ? 'early' : 'ok';
        return { cls, label: String(i + 1), sub: cls === 'long' ? 'too long' : cls === 'early' ? 'ends early' : 'in sync', title: u.text };
      })
    : Array.from({ length: unitCount }, (_, i) => {
        if (i < kept) return { cls: 'kept', label: '·', sub: 'kept' };
        const n = i - kept;
        if (n < voiced || step > 2) return { cls: 'voiced', label: String(n + 1), sub: 'voiced' };
        if (n === voiced && step === 2) return { cls: 'now', label: String(n + 1), sub: 'voicing' };
        return { cls: '', label: String(n + 1), sub: 'to voice' };
      });
  const roomy = cells.length <= 32;
  const CELL: Record<string, string> = {
    '': 'border-slate-800 bg-slate-950 text-slate-600',
    kept: 'border-slate-700 text-slate-400 bg-[repeating-linear-gradient(135deg,rgba(148,163,184,.13)_0_5px,rgba(148,163,184,.04)_5px_10px)]',
    voiced: 'border-indigo-400/60 bg-indigo-500/25 text-indigo-100',
    now: 'border-cyan-400 bg-slate-950 text-cyan-200 animate-pulse',
    ok: 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200',
    long: 'border-rose-400/60 bg-rose-500/15 text-rose-200',
    early: 'border-sky-400/50 bg-sky-500/15 text-sky-200',
  };

  const facts: [string, string][] = done
    ? [
        [`${done.summary.inSync} / ${done.summary.lines}`, 'in sync'],
        [String(done.summary.exceeded), 'run long'],
        [String(done.summary.short), 'end early'],
        [clock(elapsed), 'took'],
      ]
    : [
        [toVoice > 0 ? `${voiced} / ${toVoice}` : '—', 'voiced'],
        [toVoice > 0 ? String(toVoice - voiced) : '—', 'still to voice'],
        [step >= 2 ? String(kept) : '—', 'kept from before'],
        [characters.toLocaleString(), 'characters in the script'],
      ];

  const log = [...(run?.log ?? [])];
  if (done && run) log.push({ at: run.endedAt ?? now, text: `Done: ${done.summary.inSync} of ${done.summary.lines} lines in sync`, took: elapsed, strong: true });

  return (
    <div className="flex-1 w-full max-w-[1280px] mx-auto flex flex-col gap-[18px] py-2 animate-in fade-in duration-200">
      {waiting && (
        <div role="status" className="flex items-center gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/[.07] px-3.5 py-2.5 text-[12.5px] text-amber-100">
          <Timer className="w-4 h-4 text-amber-300 shrink-0" />
          <span>
            In line: <b>“{waitingFor}”</b> is dubbing. This dub starts on its own when that one finishes; you can keep working meanwhile.
          </span>
        </div>
      )}

      <section className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 items-end" aria-live="polite">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2.5 text-[22px] font-semibold text-slate-50">
            {waiting ? 'Waiting in line' : done ? 'Dubbed' : 'Dubbing your script'}
            {done && <SyncVerdictBadge report={done} />}
          </h1>
          {nowLine && <p className="mt-1 text-[13.5px] text-slate-300">{nowLine}</p>}
          {done && (
            <p className="mt-1 text-[13.5px] text-slate-300">
              {done.summary.inSync} of {done.summary.lines} lines in sync
              {done.summary.exceeded > 0 && `; ${done.summary.exceeded} run long`}
              {done.summary.short > 0 && `; ${done.summary.short} end early`}.{' '}
              {done.summary.exceeded + done.summary.short > 0 ? 'They are listed under Worth a listen.' : ''}
            </p>
          )}
        </div>
        <span className="text-[42px] leading-none font-semibold text-slate-50 tabular-nums text-right">{pct === null ? '—' : `${pct}%`}</span>
        <p className="col-span-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
          {run && (
            <>
              <span>
                {done ? 'Took' : 'Running'} <b className="font-mono font-semibold text-slate-300 tabular-nums">{clock(elapsed)}</b>
              </span>
              {leftToVoice !== null && (
                <span>
                  About <b className="font-mono font-semibold text-slate-300 tabular-nums">{clock(leftToVoice)}</b> left to voice, est.
                </span>
              )}
              <span>
                Started <b className="font-mono font-semibold text-slate-300 tabular-nums">{timeOfDay(run.startedAt).slice(0, 5)}</b>
              </span>
            </>
          )}
          <span>{about}</span>
        </p>
      </section>

      {/* The long bar, in the steps' own segments */}
      <div className="flex gap-[3px] h-2.5" aria-hidden>
        {steps.map((s) => {
          const n = SYNC_STEPS.indexOf(s) + 1;
          return (
            <div key={s.phase} title={s.label} className="relative flex-1 h-full rounded-[5px] bg-slate-800 overflow-hidden">
              <i
                className={`absolute inset-y-0 left-0 rounded-[5px] transition-[width] duration-500 ${n < step ? 'bg-indigo-500' : 'bg-gradient-to-r from-indigo-500 to-cyan-400'}`}
                style={{ width: `${partOf(n) * 100}%` }}
              />
            </div>
          );
        })}
      </div>

      <ol className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Steps">
        {steps.map((s) => {
          const n = SYNC_STEPS.indexOf(s) + 1;
          const state = waiting ? 'next' : n < step ? 'done' : n === step ? 'now' : 'next';
          const took = tookOf(n);
          const sub = partOf(n);
          const counted = state === 'now' && sub > 0;
          return (
            <li
              key={s.phase}
              aria-current={state === 'now' ? 'step' : undefined}
              className={`flex flex-col min-h-[118px] rounded-[14px] border px-3 py-3 transition-colors ${
                state === 'done' ? 'border-emerald-400/25 bg-slate-900/90' : state === 'now' ? 'border-cyan-400/55 bg-cyan-400/[.06]' : 'border-slate-800 bg-slate-900/90'
              }`}
            >
              <span
                className={`flex items-center gap-1.5 text-[11px] font-semibold ${state === 'done' ? 'text-emerald-300' : state === 'now' ? 'text-cyan-300' : 'text-slate-600'}`}
              >
                {state === 'done' ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <span className={`w-2 h-2 rounded-full ${state === 'now' ? 'bg-cyan-400 shadow-[0_0_0_4px_rgba(34,211,238,.18)]' : 'bg-slate-700'}`} />
                )}
                Step {steps.indexOf(s) + 1}
                {took !== null && state !== 'next' && <span className="ml-auto font-mono font-normal tabular-nums">{clock(took)}</span>}
              </span>
              <span className={`mt-1.5 text-[13px] font-semibold leading-snug ${state === 'next' ? 'text-slate-600' : state === 'now' ? 'text-white' : 'text-slate-200'}`}>{s.label}</span>
              <span className={`mt-1 text-xs ${state === 'now' ? 'text-cyan-200' : state === 'done' ? 'text-slate-400' : 'text-slate-600'}`}>{detailOf(n, s.phase)}</span>
              {counted && (
                <span className="mt-2 h-1 rounded-full bg-slate-800 overflow-hidden">
                  <i className="block h-full bg-cyan-400 transition-[width] duration-500" style={{ width: `${sub * 100}%` }} />
                </span>
              )}
              <span className={`mt-auto pt-1.5 text-[11px] leading-snug ${state === 'next' ? 'text-slate-600' : 'text-slate-500'}`}>{STEP_WHY[s.phase]}</span>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section aria-label="Lines" className="flex flex-col rounded-[18px] border border-slate-800 bg-slate-900/90 px-5 py-4">
          <p className="flex items-center gap-2 text-[10.5px] uppercase tracking-[.09em] font-semibold text-slate-500">
            Lines in the dub
            <span className="ml-auto normal-case tracking-normal font-normal">{done ? "each line's fit" : 'by count: Sync says how many, not which'}</span>
          </p>
          {cells.length > 0 ? (
            <div className={`mt-3 grid gap-1.5 ${roomy ? 'grid-cols-[repeat(auto-fill,minmax(3.6rem,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(.9rem,1fr))]'}`}>
              {cells.map((c, i) => (
                <span
                  key={i}
                  title={c.title ? `${c.label}. ${c.title}` : `${c.label === '·' ? 'Kept' : `Line ${c.label}`}: ${c.sub}`}
                  className={`flex flex-col items-center justify-center rounded-[9px] border text-[11px] leading-tight transition-colors ${roomy ? 'h-[38px]' : 'h-3.5 rounded-[3px]'} ${CELL[c.cls]}`}
                >
                  {roomy && (
                    <>
                      <b className="text-xs">{c.label}</b>
                      {c.sub}
                    </>
                  )}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">The lines show here once the source timings are read.</p>
          )}
          <p className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-slate-400">
            {(done
              ? [
                  ['bg-emerald-500/40', 'In sync'],
                  ['bg-rose-500/45', 'Too long'],
                  ['bg-sky-500/40', 'Ends early'],
                ]
              : [
                  ['bg-indigo-500/50', 'Voiced'],
                  ['border border-cyan-400', 'Voicing'],
                  ['bg-slate-500/30', 'Kept from before (unchanged)'],
                  ['border border-slate-700', 'To voice'],
                ]
            ).map(([dot, label]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-[3px] ${dot}`} />
                {label}
              </span>
            ))}
          </p>
          <div className="grid grid-cols-4 gap-2.5 mt-3.5 pt-3.5 border-t border-slate-800">
            {facts.map(([value, label]) => (
              <div key={label}>
                <b className="block text-[19px] font-semibold font-mono tabular-nums text-slate-100">{value}</b>
                <span className="text-[11.5px] text-slate-500">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section aria-label="Activity" className="flex flex-col rounded-[18px] border border-slate-800 bg-slate-900/90 px-5 py-4 min-h-0">
          <p className="flex items-center gap-2 text-[10.5px] uppercase tracking-[.09em] font-semibold text-slate-500">
            Activity <span className="ml-auto normal-case tracking-normal font-normal">newest first</span>
          </p>
          <ol className="mt-2.5 max-h-[13.5rem] overflow-hidden flex flex-col">
            {log
              .slice()
              .reverse()
              .map((e, i) => (
                <li
                  key={`${e.at}-${i}`}
                  className={`grid grid-cols-[4.6rem_minmax(0,1fr)_auto] gap-2.5 py-[5px] border-b border-slate-800/70 text-xs ${e.strong ? 'text-slate-100' : 'text-slate-400'}`}
                >
                  <span className="font-mono tabular-nums text-slate-600">{timeOfDay(e.at)}</span>
                  <span className="truncate" title={e.text}>
                    {e.text}
                  </span>
                  <span className="font-mono tabular-nums text-slate-500">{e.took !== undefined ? clock(e.took) : ''}</span>
                </li>
              ))}
          </ol>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-3.5">
        {done ? (
          <>
            <span className="flex-1 text-[12.5px] text-slate-300">
              Took {clock(elapsed)}.{' '}
              {done.summary.exceeded + done.summary.short > 0 ? 'Open the dub to listen to the lines worth a listen.' : 'Open the dub to listen.'}
            </span>
            <button
              type="button"
              onClick={onOpen}
              autoFocus
              className="h-10 px-[18px] inline-flex items-center gap-2 rounded-[11px] bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold cursor-default"
            >
              Open the dub <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <>
            <span className="flex-1 text-xs text-slate-500">Keeps running if you leave this step or open another project; the header shows how far it is.</span>
            <button
              type="button"
              onClick={onCancel}
              disabled={isCancelling}
              className="h-10 px-[18px] inline-flex items-center gap-2 rounded-[11px] border border-slate-700 text-[13px] font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50 cursor-default"
            >
              <X className="w-3.5 h-3.5" /> {waiting ? 'Take out of the line' : isCancelling ? 'Cancelling…' : 'Cancel'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

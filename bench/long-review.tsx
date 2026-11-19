// Long project bench: Review's two lanes with a made-up 2.5-hour project of
// 1500 lines, to time what a long video costs while editing. Open
// bench/long-review.html on the Vite dev server (launch config "bench") and
// press Run, or call window.runBench() and read window.benchResult.
// Nothing here reaches the app's build: Vite builds index.html only.
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import '../index.css';
import { DubEstimateLane, SourceLineLane } from '../components/SyncPreviewPanel';
import { WindowWaveform, usePeaks } from '../components/WindowWaveform';
import type { SyncPreviewUnit } from '../services/syncService';
import type { AudioSegment } from '../types';

const HOURS = 2.5;
const SECONDS = HOURS * 3600;
const LINES = 1500;

/** The same project every run. */
const random = (() => {
  let s = 12345;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
})();

const HINDI = 'मैं तुम हम वह यह जीवन मन शरीर ऊर्जा ध्यान सवाल जवाब लोग दुनिया समय काम घर रास्ता अनुभव समझ इच्छा शांति आनंद प्रेम भक्ति सत्य'.split(' ');
const ENGLISH = 'I you we he this life mind body energy meditation question answer people world time work home path experience understanding desire peace joy love devotion truth'.split(' ');
const pick = (list: string[], n: number) => Array.from({ length: n }, () => list[Math.floor(random() * list.length)]).join(' ');

const makeProject = () => {
  const segments: AudioSegment[] = [];
  const units: SyncPreviewUnit[] = [];
  const step = SECONDS / LINES;
  for (let i = 0; i < LINES; i++) {
    const start = i * step + random() * 0.8;
    const spoken = 1.5 + random() * (step - 2.5);
    const end = start + spoken;
    const words = 4 + Math.floor(random() * 12);
    const source = pick(ENGLISH, words);
    const target = pick(HINDI, words + 1);
    const each = spoken / words;
    segments.push({
      id: i + 1,
      startTime: start,
      endTime: end,
      duration: spoken,
      speaker: i % 3 === 0 ? 'Speaker 2' : 'Speaker 1',
      textSource: source,
      originalText: source,
      textTarget: target,
      targetText: target,
      words: source.split(' ').map((text, n) => ({ text, start: start + n * each, end: start + (n + 0.85) * each })),
    } as unknown as AudioSegment);
    const nextStart = (i + 1) * step;
    const slot = Math.max(0.5, nextStart - start - 0.2);
    const read = spoken * (0.8 + random() * 0.6);
    const overflow = Math.max(0, read - slot);
    units.push({
      index: i,
      key: String(i + 1),
      cueIds: [i + 1],
      text: target,
      sourceText: source,
      speaker: (segments[i] as any).speaker,
      srcStart: start,
      srcEnd: end,
      nextStart: i + 1 < LINES ? nextStart : null,
      slot,
      spoken,
      read,
      estimate: read,
      overflow,
      underflow: 0,
      status: overflow > 0.3 ? 'long' : overflow > 0 ? 'tight' : 'fits',
      targetChars: target.length,
    });
  }
  return { segments, units };
};

/** A quiet-and-loud test signal of `seconds`, mono, at `rate`. */
const makeAudio = (seconds: number, rate: number) => {
  const buffer = new AudioBuffer({ numberOfChannels: 1, length: Math.round(seconds * rate), sampleRate: rate });
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.sin(i / 37) * 0.5 * (Math.floor(i / rate / 3) % 2);
  return buffer;
};

type Row = { step: string; ms: number };

/** Lets the page run what it queued (observers, effects); a hidden page gets no animation frames, so not rAF. */
const nextFrame = () =>
  new Promise<void>((done) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => done();
    channel.port2.postMessage(null);
  });

function Bench() {
  const project = useMemo(makeProject, []);
  const [view, setView] = useState({ start: 0, seconds: 120, look: 'bars' as 'bars' | 'blocks' | 'wave', width: 1600 });
  const [audio, setAudio] = useState<AudioBuffer | null>(null);
  const peaks = usePeaks(audio);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const longest = useRef(0);

  useLayoutEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longest.current = Math.max(longest.current, entry.duration);
    });
    try {
      observer.observe({ type: 'longtask', buffered: false });
    } catch {
      return;
    }
    return () => observer.disconnect();
  }, []);

  /** Sets the view and times it until the page has drawn it. */
  const time = async (step: string, next: Partial<typeof view>) => {
    const t0 = performance.now();
    flushSync(() => setView((v) => ({ ...v, ...next })));
    void document.body.offsetHeight;
    await nextFrame();
    return { step, ms: Math.round(performance.now() - t0) };
  };

  const run = async () => {
    setRunning(true);
    longest.current = 0;
    const out: Row[] = [];
    const t0 = performance.now();
    for (const look of ['bars', 'blocks'] as const) {
      out.push(await time(`${look}: open at 2 min`, { look, start: 0, seconds: 120, width: 1600 }));
      for (const seconds of [600, 1800, 3600, SECONDS])
        out.push(await time(`${look}: zoom out to ${Math.round(seconds / 60)} min`, { seconds }));
      out.push(await time(`${look}: zoom in to 2 min`, { seconds: 120 }));
      for (let n = 1; n <= 10; n++) out.push(await time(`${look}: scroll to ${Math.round((n * SECONDS) / 10 / 60)} min`, { start: Math.min(SECONDS - 120, (n * SECONDS) / 10) }));
      out.push(await time(`${look}: whole project, window narrower`, { start: 0, seconds: SECONDS, width: 1400 }));
      out.push(await time(`${look}: whole project, window wider`, { width: 1600 }));
    }
    const total = Math.round(performance.now() - t0);
    const worst = out.reduce((a, b) => (b.ms > a.ms ? b : a));
    const result = {
      lines: LINES,
      hours: HOURS,
      totalMs: total,
      worst,
      longestTaskMs: Math.round(longest.current),
      heapMB: Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1e6),
      elements: document.getElementsByTagName('*').length,
      rows: out,
    };
    (window as any).benchResult = result;
    setRows(out);
    setRunning(false);
    return result;
  };
  (window as any).runBench = run;
  /** One step on its own, for a step that may take minutes: benchStep('bars, whole', { look: 'bars', seconds: 9000 }). */
  (window as any).benchStep = (step: string, next: Partial<typeof view>) => time(step, next);

  const loadAudio = () => {
    const t0 = performance.now();
    setAudio(makeAudio(SECONDS, 48000));
    (window as any).audioMs = Math.round(performance.now() - t0);
  };

  const spans = useMemo(
    () => project.units.map((u, n) => ({ from: u.srcStart, to: u.srcEnd, color: ['#818cf8', '#2dd4bf', '#f59e0b', '#f472b6'][n % 4] })),
    [project]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 space-y-3 text-sm">
      <div className="flex flex-wrap gap-2 items-center">
        <strong>
          {LINES} lines · {HOURS} h
        </strong>
        <button className="px-3 py-1 rounded bg-indigo-600 disabled:opacity-50" disabled={running} onClick={() => void run()}>
          {running ? 'Running…' : 'Run'}
        </button>
        <button className="px-3 py-1 rounded border border-edge" onClick={loadAudio} disabled={Boolean(audio)}>
          Add {HOURS} h of 48 kHz audio
        </button>
        <span className="text-slate-400">
          window {Math.round(view.seconds)} s at {Math.round(view.start)} s · {view.look}
        </span>
      </div>
      <div style={{ width: view.width }} className="space-y-1">
        {peaks && (
          <div className="relative h-16 bg-slate-900">
            <WindowWaveform data={peaks} from={view.start} span={view.seconds} spans={spans} className="text-slate-500/50" look="clips" />
          </div>
        )}
        <div className="relative h-12 bg-slate-900 overflow-hidden">
          <SourceLineLane
            units={project.units}
            segments={project.segments}
            windowStart={view.start}
            windowSeconds={view.seconds}
            look={view.look === 'wave' ? 'bars' : view.look}
            numbers
          />
        </div>
        <div className="relative h-14 bg-slate-900 overflow-hidden">
          <DubEstimateLane units={project.units} windowStart={view.start} windowSeconds={view.seconds} look={view.look} layers={{ fit: true, numbers: true }} />
        </div>
      </div>
      {rows.length > 0 && (
        <table className="text-xs">
          <tbody>
            {rows.map((r, n) => (
              <tr key={n} className={r.ms > 200 ? 'text-rose-300' : ''}>
                <td className="pr-4">{r.step}</td>
                <td className="text-right">{r.ms} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Bench />);

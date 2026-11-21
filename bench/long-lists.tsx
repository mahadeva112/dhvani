// Long lists bench: the lists that show every line of a project (Script
// view, the subtitle Edit rows, Edit segments) with a made-up 2.5-hour
// project, to time opening them, following playback and typing in them.
// Open bench/long-lists.html on the Vite dev server (launch config "bench")
// and call window.runLists(), or press Run.
// Nothing here reaches the app's build: Vite builds index.html only.
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import '../index.css';
import { ScriptTableView, type LinePacing } from '../components/review/ScriptTableView';
import { SubtitleEditor } from '../components/SubtitleEditor';
import { TranscriptSegmentEditor } from '../components/TranscriptSegmentEditor';
import { CustomScriptAlignModal } from '../components/CustomScriptAlignModal';
import { SrtExportModal } from '../components/SrtExportModal';
import type { AudioSegment, EditedSubtitle, SubtitleEdit } from '../types';

const SECONDS = 2.5 * 3600;
const LINES = 1500;
const SUBTITLES = 2500;

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

const makeSegments = () => {
  const step = SECONDS / LINES;
  return Array.from({ length: LINES }, (_, i) => {
    const start = i * step + random() * 0.8;
    // Every fifth line runs on to the next with no pause, so paragraphs hold several lines.
    const end = i % 5 === 4 ? start + 1.5 + random() * (step - 2.5) : (i + 1) * step - 0.05;
    const words = 4 + Math.floor(random() * 12);
    const source = pick(ENGLISH, words) + '.';
    const target = pick(HINDI, words + 1) + '।';
    const each = (end - start) / words;
    return {
      id: i + 1,
      startTime: start,
      endTime: end,
      duration: end - start,
      speaker: i % 7 === 0 ? 'Speaker 2' : 'Speaker 1',
      originalText: source,
      textSource: source,
      targetText: target,
      textTarget: target,
      words: source.split(' ').map((text, n) => ({ text, start: start + n * each, end: start + (n + 0.85) * each })),
    } as unknown as AudioSegment;
  });
};

const makeSubtitles = (): EditedSubtitle[] => {
  const step = SECONDS / SUBTITLES;
  return Array.from({ length: SUBTITLES }, (_, i) => ({ start: i * step, end: i * step + step * 0.9, text: pick(HINDI, 5) + '\n' + pick(HINDI, 4) }));
};

type Row = { step: string; ms: number };
type List = 'script' | 'subtitles' | 'segments' | 'align' | 'export' | 'none';

const nextFrame = () =>
  new Promise<void>((done) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => done();
    channel.port2.postMessage(null);
  });

const text = (seg: AudioSegment, field: 'targetText' | 'originalText') => String((seg as any)[field] ?? '');

function Bench() {
  const [segments, setSegments] = useState(makeSegments);
  const [subtitles, setSubtitles] = useState(makeSubtitles);
  const [exportEdits, setExportEdits] = useState<Record<string, SubtitleEdit> | null>(null);
  const [state, setState] = useState({ list: 'none' as List, active: 0, tick: 0 });
  const [rows, setRows] = useState<Row[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const longest = useRef(0);
  const visibleIds = useMemo(() => new Set(segments.map((s) => String(s.id))), [segments]);

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

  const settle = async (t0: number) => {
    void document.body.offsetHeight;
    await nextFrame();
    return Math.round(performance.now() - t0);
  };
  const time = async (step: string, next: Partial<typeof state>) => {
    const t0 = performance.now();
    flushSync(() => setState((s) => ({ ...s, ...next })));
    return { step, ms: await settle(t0) };
  };
  /** Types a letter into the first box of the list, as a keystroke would reach React. */
  const type = async (step: string, n: number) => {
    const box = state.list === 'align' || state.list === 'export' ? document.querySelector<HTMLElement>('[role="dialog"]') ?? document.body : boxRef.current;
    const field = box?.querySelector<HTMLElement>('[data-dub-cue], textarea, input[type="text"]');
    if (!field) return { step: `${step} (no field)`, ms: -1 };
    if (document.activeElement !== field) {
      field.focus();
      await nextFrame();
    }
    const t0 = performance.now();
    if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
      const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, field.value + 'क');
    } else {
      field.textContent = (field.textContent || '') + 'क';
    }
    flushSync(() => field.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'क', inputType: 'insertText' })));
    return { step: `${step} ${n}`, ms: await settle(t0) };
  };
  const scroll = async (step: string, to: number) => {
    // Whatever scrolls the list: the list's own scroller, or the box.
    const all = [boxRef.current, ...Array.from(boxRef.current?.querySelectorAll<HTMLElement>('*') ?? [])];
    const el = all.find((e) => e && e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY));
    if (!el) return { step, ms: -1 };
    const t0 = performance.now();
    el.scrollTop = to * (el.scrollHeight - el.clientHeight);
    el.dispatchEvent(new Event('scroll'));
    return { step, ms: await settle(t0) };
  };

  const run = async (only?: List[]) => {
    longest.current = 0;
    const out: Row[] = [];
    const lists: List[] = only ?? ['script', 'subtitles', 'segments', 'align'];
    for (const list of lists) {
      out.push(await time(`${list}: open`, { list, active: 0 }));
      const elements = document.getElementsByTagName('*').length;
      out.push({ step: `${list}: elements`, ms: elements });
      for (const at of [10, 500, 1000, 1400]) out.push(await time(`${list}: playing line ${at}`, { active: at }));
      out.push(await time(`${list}: parent redraws`, { tick: state.tick + 1 }));
      for (let n = 1; n <= 3; n++) out.push(await type(`${list}: type a letter`, n));
      (document.activeElement as HTMLElement | null)?.blur?.();
      for (const at of [0.5, 1]) out.push(await scroll(`${list}: scroll to ${at * 100}%`, at));
      out.push(await time(`${list}: close`, { list: 'none' }));
    }
    const worst = out.filter((r) => !r.step.endsWith('elements')).reduce((a, b) => (b.ms > a.ms ? b : a));
    const result = { lines: LINES, subtitles: SUBTITLES, worst, longestTaskMs: Math.round(longest.current), rows: out };
    (window as any).listsResult = result;
    setRows(out);
    return result;
  };
  (window as any).runLists = run;
  /** Opens one list and leaves it open, to look at: openList('subtitles', 1200) with line 1200 playing. */
  (window as any).openList = (list: List, active = 0) => flushSync(() => setState((s) => ({ ...s, list, active })));

  const pacing = (seg: AudioSegment, t: string): LinePacing => {
    const cps = t.length / Math.max(0.3, seg.endTime - seg.startTime);
    return { level: cps > 18 ? 'fast' : cps > 15 ? 'tight' : 'natural', cps, endsEarlyBy: null };
  };

  return (
    <div className="p-4 text-slate-200 text-sm">
      <div className="mb-3 flex items-center gap-3">
        <button type="button" className="px-3 py-1 rounded bg-indigo-600" onClick={() => void run()}>
          Run
        </button>
        <span>
          {LINES} lines, {SUBTITLES} subtitles, {state.list}
        </span>
      </div>
      {/* A column of fixed height, as the lists sit in the app: each list's own scroller takes what is left. */}
      <div ref={boxRef} className="h-[640px] flex flex-col overflow-auto border border-slate-700 rounded">
        {state.list === 'script' && (
          <ScriptTableView
            segments={segments}
            visibleIds={visibleIds}
            sourceLanguage="English"
            targetLanguage="Hindi"
            getSourceText={(seg) => text(seg, 'originalText')}
            getTargetText={(seg) => text(seg, 'targetText')}
            onUpdateLines={(lines) => {
              const byId = new Map(lines.map((l) => [String(l.id), l.text]));
              setSegments((all) => all.map((s) => (byId.has(String(s.id)) ? ({ ...s, targetText: byId.get(String(s.id)), textTarget: byId.get(String(s.id)) } as AudioSegment) : s)));
            }}
            getPacing={pacing}
            passagePause={0.6}
            activeSegmentId={segments[state.active]?.id ?? null}
            isPlaying={false}
            onSeek={() => {}}
            onPlayPassage={() => {}}
            onTogglePlay={() => {}}
            exportFileStem="bench"
          />
        )}
        {state.list === 'subtitles' && (
          <SubtitleEditor
            cues={subtitles}
            maxChars={42}
            maxLines={2}
            maxCps={20}
            language="Hindi"
            words={[]}
            activeRow={state.active}
            onPick={() => {}}
            onChange={setSubtitles}
            onUndo={() => {}}
            onRedo={() => {}}
            listRef={listRef}
          />
        )}
        {state.list === 'export' && (
          <SrtExportModal
            isOpen
            onClose={() => {}}
            segments={segments}
            targetLanguage="Hindi"
            syncedSegments={segments}
            hasSynthAudio
            synthAudioDuration={SECONDS}
            subtitleEdits={exportEdits}
            onSubtitleEditChange={(key, edit) => setExportEdits((all) => ({ ...(all ?? {}), ...(edit ? { [key]: edit } : {}) }))}
          />
        )}
        {state.list === 'align' && (
          <CustomScriptAlignModal isOpen segments={segments} targetLanguage="Hindi" audioDuration={SECONDS} onClose={() => {}} onApplyAlignedScript={() => {}} />
        )}
        {state.list === 'segments' && (
          <TranscriptSegmentEditor segments={segments} onApply={() => {}} onCancel={() => {}} formatTime={(s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`} />
        )}
      </div>
      <table className="mt-3 font-mono text-xs">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="pr-4">{r.step}</td>
              <td className="text-right">{r.ms}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Bench />);

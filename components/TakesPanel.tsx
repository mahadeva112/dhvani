import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Headphones, Loader2, Mic, Pause, Play, X } from 'lucide-react';
import type { SyncUnitReport } from '../services/syncService';
import {
  phraseOf,
  SYNC_TAKE_ID,
  TAKE_DIRECTIONS,
  takeFit,
  takeWav,
  TAKES_PER_ASK,
  wordsOf,
  type LineTakes,
  type SyncTake,
  type TakeDirection,
  type TakeFit,
} from '../services/syncTakesService';

const TONE: Record<TakeFit['tone'], string> = {
  fits: 'bg-emerald-400/12 text-emerald-300',
  short: 'bg-sky-400/12 text-sky-300',
  over: 'bg-amber-400/12 text-amber-300',
  cut: 'bg-rose-400/12 text-rose-300',
};

const directionLabel = (direction?: TakeDirection) => TAKE_DIRECTIONS.find((d) => d.id === direction)?.label ?? 'Same';

/** A take's name in the list: Sync's own, or its number among the takes asked for. */
const takeName = (take: SyncTake, index: number) => (take.id === SYNC_TAKE_ID ? "Sync's take" : `Take ${index}`);

/**
 * The takes of one synced line: every take of it heard side by side, Sync's
 * own among them, and the one the dub plays picked from them. New takes are
 * voiced at once, of the whole line or of only some of its words, read the
 * same or a little differently; none changes a word. A picked take is in the
 * dub within seconds, and every take stays to go back to.
 */
export const TakesPanel: React.FC<{
  unit: SyncUnitReport;
  lineNumber: number;
  lineTakes: LineTakes;
  /** Where the line's first word is now, where a picked take's first word goes. */
  firstWord: number;
  nextStart: number | null;
  tolerance: number;
  bankBlob: Blob | null | undefined;
  sampleRate: number;
  float: boolean;
  /** This line's takes are being voiced. */
  busy: boolean;
  /** Takes of some line are being voiced: one request at a time. */
  anyBusy: boolean;
  error: string | null;
  /** The line's words changed since Sync: takes would read the old words. */
  pending: boolean;
  locked?: boolean;
  initialPhrase?: { from: number; to: number } | null;
  onVoice: (options: { direction: TakeDirection; phrase?: { from: number; to: number } }) => void;
  onUse: (takeId: string) => void;
  onListenInDub: () => void;
  onClose: () => void;
}> = ({
  unit,
  lineNumber,
  lineTakes,
  firstWord,
  nextStart,
  tolerance,
  bankBlob,
  sampleRate,
  float,
  busy,
  anyBusy,
  error,
  pending,
  locked = false,
  initialPhrase,
  onVoice,
  onUse,
  onListenInDub,
  onClose,
}) => {
  const words = useMemo(() => wordsOf(unit.text), [unit.text]);
  const [direction, setDirection] = useState<TakeDirection>('same');
  // Words picked to retake on their own: the first clicked, and the one shift-clicked to.
  const [pick, setPick] = useState<{ from: number; to: number } | null>(null);
  useEffect(() => setPick(initialPhrase ?? null), [unit.key, unit.text, initialPhrase]);
  const phrase = pick ? phraseOf(unit.text, pick.from, pick.to) : null;
  const wholeLine = !phrase || (!phrase.before && !phrase.after);
  const chars = (wholeLine ? unit.text.length : phrase.words.length) * TAKES_PER_ASK;

  const clickWord = (index: number, extend: boolean) => {
    if (extend && pick) setPick({ from: pick.from, to: index });
    else if (pick && pick.from === index && pick.to === index) setPick(null);
    else setPick({ from: index, to: index });
  };
  const inPick = (index: number) => pick !== null && index >= Math.min(pick.from, pick.to) && index <= Math.max(pick.from, pick.to);

  const fits = useMemo(
    () => new Map(lineTakes.takes.map((take) => [take.id, takeFit(take, unit, firstWord, nextStart, tolerance)])),
    [lineTakes.takes, unit, firstWord, nextStart, tolerance]
  );
  // The take that fits best, among more than one: what Sync would have kept.
  const best = useMemo(() => {
    if (lineTakes.takes.length < 2) return null;
    let top: SyncTake | null = null;
    for (const take of lineTakes.takes) if (!top || (fits.get(take.id)?.score ?? Infinity) < (fits.get(top.id)?.score ?? Infinity)) top = take;
    return top;
  }, [lineTakes.takes, fits]);

  // One take plays at a time, on its own, from its samples in the bank.
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const stop = () => {
    const el = audio.current;
    if (el) {
      el.pause();
      URL.revokeObjectURL(el.src);
    }
    audio.current = null;
    setPlaying(null);
  };
  useEffect(() => stop, []);
  useEffect(() => { stop(); }, [unit.key, lineTakes.active]);
  const play = (take: SyncTake) => {
    if (playing === take.id) return stop();
    stop();
    if (!bankBlob) return;
    const el = new Audio(URL.createObjectURL(takeWav(bankBlob, take, { sampleRate, float })));
    el.onended = stop;
    audio.current = el;
    setPlaying(take.id);
    el.play().catch(stop);
  };

  const numbered = lineTakes.takes.filter((take) => take.id !== SYNC_TAKE_ID);

  return (
    <section aria-label={`Takes for line ${lineNumber}`} className="rounded-xl border border-indigo-500/30 bg-slate-950/70 px-3.5 py-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Mic className="w-3.5 h-3.5 text-indigo-300" />
        <span className="text-[13px] font-semibold text-slate-100">Takes · line {String(lineNumber).padStart(2, '0')}</span>
        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
          {nextStart !== null ? `slot ${Math.max(0, nextStart - firstWord).toFixed(1)} s · ` : ''}original speech {Math.max(0, unit.srcEnd - unit.srcStart).toFixed(1)} s
        </span>
        <button type="button" onClick={onClose} aria-label="Close the takes" className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* The words: click one, shift-click another, to retake only those */}
      <div>
        <p className="flex flex-wrap gap-x-1 gap-y-0.5 text-[13.5px] leading-relaxed" aria-label="Words of the line">
          {words.map((word, index) => (
            <button
              key={index}
              type="button"
              onClick={(e) => clickWord(index, e.shiftKey)}
              aria-pressed={inPick(index)}
              className={`rounded px-0.5 cursor-pointer ${inPick(index) ? 'bg-indigo-500/25 text-indigo-100 ring-1 ring-indigo-400/60' : 'text-slate-200 hover:bg-slate-800'}`}
            >
              {word}
            </button>
          ))}
        </p>
        <p className="mt-1 text-[11.5px] text-slate-500">
          {pick
            ? wholeLine
              ? 'Every word is picked: the whole line is voiced again.'
              : 'Only the picked words are voiced again, read with the words around them, and put in where they are. The rest of the take stays as it is, sample for sample.'
            : 'Click a word, then Shift + click another, to voice again only those words.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11.5px] text-slate-400 mr-1">Read</span>
        {TAKE_DIRECTIONS.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setDirection(d.id)}
            aria-pressed={direction === d.id}
            title={d.hint}
            className={`h-7 px-2.5 rounded-full border text-[11.5px] cursor-pointer ${
              direction === d.id ? 'border-indigo-400/70 bg-indigo-500/15 text-indigo-100' : 'border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onVoice({ direction })}
          disabled={anyBusy || pending || locked}
          className="min-h-8 px-3 py-1 rounded-lg border border-slate-700 text-slate-100 text-xs flex items-center gap-1.5 disabled:opacity-40 cursor-pointer disabled:cursor-default"
        >
          <Mic className="w-3.5 h-3.5" /> Retake line {String(lineNumber).padStart(2, '0')} · {TAKES_PER_ASK} takes · {(unit.text.length * TAKES_PER_ASK).toLocaleString()} chars
        </button>
        <button
          type="button"
          onClick={() => onVoice({ direction, ...(!wholeLine && pick && { phrase: pick }) })}
          disabled={anyBusy || pending || locked || wholeLine}
          title={
            pending
              ? "This line's words changed since Sync: Sync again, then take it again"
              : `Voices ${TAKES_PER_ASK} takes now (${TAKES_PER_ASK} voicings of ${wholeLine ? 'the line' : 'the words'}). Nothing changes in the dub until you use one.`
          }
          className="min-h-8 px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 disabled:bg-slate-800 disabled:text-slate-500 cursor-pointer disabled:cursor-default"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
          {busy
            ? 'Voicing takes…'
            : wholeLine
              ? 'Select words for phrase retake'
              : `Retake “${phrase?.words.length && phrase.words.length > 28 ? `${phrase.words.slice(0, 26)}…` : phrase?.words}” only · ${TAKES_PER_ASK} takes · ${chars.toLocaleString()} chars`}
        </button>
        <span className="text-[11.5px] text-slate-500">Character counts are estimates. Phrase retakes also use forced alignment.</span>
        {locked && <span className="text-[11.5px] text-amber-300">Unlock this line in Edit timing before retaking or replacing it.</span>}
        {pending && <span className="text-[11.5px] text-amber-300">The words changed since Sync: Sync again first.</span>}
      </div>
      {error && <p className="text-[12px] text-rose-300">{error}</p>}

      <ul className="flex flex-col gap-1.5" aria-label="Takes">
        {lineTakes.takes.map((take) => {
          const fit = fits.get(take.id);
          const active = lineTakes.active === take.id;
          const n = numbered.indexOf(take) + 1;
          return (
            <li
              key={take.id}
              className={`flex flex-wrap items-center gap-2.5 rounded-lg px-2.5 py-2 border ${active ? 'border-indigo-400/70 bg-indigo-500/10' : 'border-slate-800 bg-slate-900/60'}`}
            >
              <button
                type="button"
                onClick={() => play(take)}
                disabled={!bankBlob}
                aria-label={playing === take.id ? `Stop ${takeName(take, n)}` : `Play ${takeName(take, n)}`}
                className="w-8 h-8 rounded-full border border-slate-700 text-slate-200 hover:bg-slate-800 flex items-center justify-center cursor-pointer disabled:opacity-40"
              >
                {playing === take.id ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[12.5px] font-medium text-slate-100">{takeName(take, n)}</span>
                  {take.kind !== 'sync' && <span className="text-[11px] text-slate-400">{directionLabel(take.direction)}</span>}
                  {take.phrase && <span className="text-[11px] text-indigo-300 truncate max-w-[16rem]">only “{take.phrase}”</span>}
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">{take.speech.toFixed(2)} s</span>
                  {best?.id === take.id && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-indigo-400/15 text-indigo-200">Best fit</span>}
                </div>
                {(() => {
                  const slot = nextStart === null ? Math.max(0, unit.srcEnd - unit.srcStart) : Math.max(0, nextStart - firstWord);
                  const scale = Math.max(slot, ...lineTakes.takes.map(t => t.speech), 0.01) * 1.08;
                  return <div className="relative h-1.5 mt-2 rounded-full bg-slate-800" role="img" aria-label={`${take.speech.toFixed(2)} seconds of speech; ${slot.toFixed(2)} second ${nextStart === null ? 'original speech reference' : 'slot'}`}>
                    <div className={`h-full rounded-full ${active ? 'bg-indigo-400' : 'bg-slate-500'}`} style={{ width: `${take.speech / scale * 100}%` }} />
                    <span className="absolute -top-0.5 h-2.5 w-px bg-slate-200" style={{ left: `${slot / scale * 100}%` }} />
                  </div>;
                })()}
                {take.text !== unit.text && <p className="text-[11px] text-amber-300/90 mt-0.5">Voiced from an earlier wording of the line</p>}
              </div>
              {fit && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TONE[fit.tone]}`}>{fit.label}</span>}
              {active ? (
                <span className="flex items-center gap-1 text-[11.5px] text-indigo-200 font-medium px-1">
                  <Check className="w-3.5 h-3.5" /> In the dub
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    stop();
                    onUse(take.id);
                  }}
                  disabled={take.text !== unit.text || anyBusy || pending || locked}
                  title={take.text !== unit.text ? 'This take says an earlier wording of the line' : 'Put this take in the dub, where the line is now'}
                  className="h-7 px-2.5 rounded-lg border border-slate-700 text-xs text-slate-100 hover:bg-slate-800 cursor-pointer disabled:opacity-40 disabled:cursor-default"
                >
                  Use {takeName(take, n)}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-slate-500">
        <button type="button" onClick={onListenInDub} className="h-7 px-2.5 rounded-lg border border-slate-800 text-slate-300 hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer">
          <Headphones className="w-3.5 h-3.5" /> Listen in the dub
        </button>
        <span>Each take is fitted as Sync fits a line, never stretched. Sync again keeps the take in the dub and starts the takes afresh.</span>
      </div>
    </section>
  );
};

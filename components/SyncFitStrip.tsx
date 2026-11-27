import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, FastForward, Info, MoveHorizontal, RotateCcw, Scissors } from 'lucide-react';
import type { SyncPreviewUnit } from '../services/syncService';
import { fitAdvice, fitLabel, needsFix } from './FinalScriptFit';
import { ExpertLineDetail, LineFixControls, WordingButtons, deepCut, lineNote, type LineFixControlsProps } from './SyncPreviewPanel';

/**
 * Review's sync fit for one line, in one row (Mock A, 2026-11-19; simpler
 * 2026-11-27): for a line that runs long or ends early, its state, a small
 * meter and the seconds (a line that fits shows none of them: its passage
 * and the top bar say so, the seconds sit behind i), one number to change
 * (syllables when known, else characters), pills for what was done to it,
 * then Read faster, the wording icons (the suggested one named) and Keep. No pencil: the line is
 * already open for typing. Less crowded (Mock A, 2026-11-27): the seconds sit
 * on the chip's hover, a line too long to shorten gets a warning icon in
 * place of a sentence, a cut line's pill is scissors and its parts, and Read
 * faster only its seconds. The whole advice, the counts, and syllables,
 * pauses and lips open under the row from the i button.
 */

const CHIP_TONE: Record<SyncPreviewUnit['status'], string> = {
  fits: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
  tight: 'bg-amber-500/10 text-amber-200 border-amber-500/25',
  long: 'bg-amber-500/15 text-amber-300 border-amber-500/35',
  short: 'bg-sky-500/15 text-sky-300 border-sky-500/35',
};

const FILL_TONE: Record<SyncPreviewUnit['status'], string> = {
  fits: 'bg-emerald-400/80',
  tight: 'bg-emerald-400/80',
  long: 'bg-amber-400/90',
  short: 'bg-sky-400/80',
};

const DELTA_TONE: Record<SyncPreviewUnit['status'], string> = {
  fits: 'text-slate-400',
  tight: 'text-amber-200/90',
  long: 'text-amber-200/90',
  short: 'text-sky-300',
};

const pill =
  'inline-flex items-center gap-1 h-[22px] px-2 rounded-full border text-[11.5px] whitespace-nowrap cursor-default transition-colors [&_svg]:w-3 [&_svg]:h-3';
const pillOn = 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25';
const pillOff = 'border-dashed border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400';
const iconButton =
  'inline-flex items-center justify-center gap-1 h-6 px-1.5 rounded-md text-[11.5px] text-slate-400 hover:text-white hover:bg-slate-800 cursor-default';

/** The meter: the dub's length as a bar, a tick where its slot ends, a dashed box for original speech left silent. */
const InlineMeter: React.FC<{ unit: SyncPreviewUnit }> = ({ unit }) => {
  const scale = Math.max(unit.slot, unit.estimate, unit.spoken, 0.1);
  const pct = (seconds: number) => `${Math.min(100, (seconds / scale) * 100)}%`;
  return (
    <span className="relative block w-16 h-1.5 rounded-full bg-slate-800 shrink-0" aria-hidden="true">
      {unit.status === 'short' && (
        <span className="absolute inset-y-0 left-0 rounded-full border border-dashed border-sky-400/70" style={{ width: pct(unit.spoken) }} />
      )}
      <span className={`absolute inset-y-0 left-0 rounded-full ${FILL_TONE[unit.status]}`} style={{ width: pct(unit.estimate) }} />
      <span className="absolute -top-1 -bottom-1 w-px bg-slate-300" style={{ left: pct(unit.slot) }} />
      {unit.wantSeconds !== undefined && (
        <span className="absolute -top-1.5 -bottom-1.5 w-0.5 rounded-full bg-indigo-300" style={{ left: pct(unit.wantSeconds) }} />
      )}
    </span>
  );
};

/** One number for what the line should lose or gain: syllables when the Expert estimate knows, else characters. */
const deltaOf = (unit: SyncPreviewUnit) => {
  if (!needsFix(unit)) return '';
  if (unit.status === 'long' && unit.expert && unit.expert.cut > 0) return `−${unit.expert.cut} syl`;
  const chars = unit.targetChars - unit.text.length;
  return chars !== 0 ? `${chars > 0 ? '+' : '−'}${Math.abs(chars)} ch` : '';
};

/** The state chip: a long line shows only its seconds over, the rest say it in words. */
const chipLabel = (unit: SyncPreviewUnit) => (unit.status === 'long' ? `+${unit.overflow.toFixed(1)} s` : fitLabel(unit));

export interface SyncFitStripProps {
  unit: SyncPreviewUnit;
  cps: number;
  fix: Omit<LineFixControlsProps, 'unit' | 'cps'> & { onPrefetch?: () => void };
  /** The line is the one picked in Review: its marked wording is asked for ahead of the click. */
  open?: boolean;
  /** "Cues 2–3" for a line said over several cues. */
  cuesLabel?: string;
  /** Marks the original runs straight through, from pauseAdvice. */
  pauses?: string;
  /** Read faster with a pace direction, for Eleven v3/v4 lines that run long. */
  faster?: { on: boolean; seconds: number; fits: boolean; model: string; onToggle: (on: boolean) => void } | null;
  /** Placed or cut on the dub lane: a short label, the whole sentence, and the way back to Sync's place. */
  placed?: { label: string; detail: string; onReset: () => void; short?: { kind: 'cut' | 'moved' | 'pauses'; text: string } } | null;
  /** Trimmed on the timeline: the way back to the length worked out from the slot. */
  onResetTrim?: () => void;
  /** "107 characters · 36 syllables, …", shown behind the i. */
  counts?: string;
}

/** Said on the warning icon, and under the i, when shortening would lose too much. */
const DEEP_CUT_HINT = 'Shorter would cut over a third of its words: drag its end on the timeline, or join it with the next line.';

/** How long the pointer rests on a line's fit row before its wording is asked for ahead. */
const AHEAD_HOVER_MS = 500;
/** How long the open line's words stay unchanged before its wording is asked for ahead. */
const AHEAD_SETTLE_MS = 1200;

export const SyncFitStrip: React.FC<SyncFitStripProps> = ({ unit, cps, fix, open = false, cuesLabel, pauses, faster, placed, onResetTrim, counts }) => {
  const [infoOpen, setInfoOpen] = useState(false);
  const { state, direction, onPrefetch, ...controls } = fix;
  // Picked, or hovered for a moment: the wording the line points to is asked for before the click.
  const hoverTimer = useRef<number | undefined>(undefined);
  const prefetchRef = useRef(onPrefetch);
  prefetchRef.current = onPrefetch;
  // Waits for the words to settle, so typing in the open line doesn't ask for each letter.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => prefetchRef.current?.(), AHEAD_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [open, unit.key, unit.text]);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const startHover = () => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => prefetchRef.current?.(), AHEAD_HOVER_MS);
  };
  const endHover = () => window.clearTimeout(hoverTimer.current);
  const flagged = needsFix(unit);
  const idle = state.kind === 'idle' || state.kind === 'error';
  const delta = deltaOf(unit);
  const advice = [fitAdvice(unit), pauses].filter(Boolean).join(' ');
  const note = idle ? null : lineNote(unit, state, direction);
  const short = unit.status === 'short';
  const fasterSentence =
    faster &&
    `Read faster with a pace direction: about ${faster.seconds.toFixed(1)} s, ${faster.fits ? 'fits' : 'still long'}. ${faster.model} ignores the speed setting, so Sync asks the voice to read faster instead.`;
  const shortCut = idle && direction === 'shorter' && deepCut(unit);
  // A line that fits says nothing on its own: the passage's "All fit" and the top bar already say so.
  const quiet = unit.status === 'fits' || unit.status === 'tight';
  const seconds = `About ${unit.estimate.toFixed(1)} s of speech${unit.read - unit.estimate >= 0.1 ? ` once placed (read in ${unit.read.toFixed(1)} s)` : ''} · slot ${unit.slot.toFixed(1)} s · original speech ${unit.spoken.toFixed(1)} s`;

  return (
    <div className="mt-1.5" onPointerEnter={startHover} onPointerLeave={endHover} onFocus={() => prefetchRef.current?.()}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 min-h-[26px]">
        {!quiet && (
          <>
            <span
              className={`font-mono text-[11.5px] tabular-nums px-1.5 py-px rounded-md border whitespace-nowrap ${CHIP_TONE[unit.status]}`}
              title={[fitLabel(unit), seconds, advice].filter(Boolean).join('. ')}
            >
              {chipLabel(unit)}
            </span>
            <span title={seconds}>
              <InlineMeter unit={unit} />
            </span>
          </>
        )}
        {delta && (
          <span className={`text-[12px] tabular-nums whitespace-nowrap ${DELTA_TONE[unit.status]}`} title={`Aim for about ${unit.targetChars} characters (now ${unit.text.length})${counts ? `. ${counts}` : ''}`}>
            {delta}
          </span>
        )}
        {shortCut && (
          <span role="img" aria-label={DEEP_CUT_HINT} title={DEEP_CUT_HINT} className="inline-flex text-amber-300 cursor-default">
            <AlertTriangle className="w-3.5 h-3.5" />
          </span>
        )}
        {cuesLabel && <span className="text-[11.5px] text-indigo-300/80 whitespace-nowrap">{cuesLabel}</span>}
        {placed && (
          <button
            type="button"
            onClick={placed.onReset}
            className={`${pill} ${pillOn}`}
            title={`${placed.detail} Click to join its parts and let Sync place the line again.`}
            aria-label={`${placed.label}. Click to let Sync place it again.`}
          >
            {placed.short?.kind === 'cut' ? <Scissors /> : placed.short?.kind === 'moved' ? <MoveHorizontal /> : <RotateCcw />}
            {placed.short ? placed.short.text : `${placed.label} · auto`}
          </button>
        )}
        {unit.wantSeconds !== undefined && onResetTrim && (
          <button type="button" onClick={onResetTrim} className={`${pill} ${pillOn}`} title="Trimmed by you. Click to go back to the length worked out from the slot.">
            <Scissors /> Trim {unit.wantSeconds.toFixed(1)} s · reset
          </button>
        )}

        <span
          className={`ml-auto flex flex-wrap items-center gap-1 ${
            idle && !flagged && !infoOpen ? 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity' : ''
          }`}
        >
          {state.kind === 'error' && (
            <>
              <span className="text-[11.5px] text-rose-300">{state.message}</span>
              <button type="button" onClick={() => fix.onSuggest()} className={iconButton}>
                Try again
              </button>
            </>
          )}
          {faster && (
            <button
              type="button"
              aria-pressed={faster.on}
              onClick={() => faster.onToggle(!faster.on)}
              className={`${pill} ${faster.on ? pillOn : pillOff}`}
              title={fasterSentence || undefined}
              aria-label={`Read faster, about ${faster.seconds.toFixed(1)} s`}
            >
              <FastForward /> {faster.seconds.toFixed(1)} s
            </button>
          )}
          {idle && (
            <>
              <WordingButtons unit={unit} onSuggest={fix.onSuggest} icons />
              {(flagged || unit.status === 'long' || unit.status === 'short') && (
                <button type="button" onClick={fix.onKeep} className={iconButton} title="Keep as is" aria-label="Keep as is">
                  <Check className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setInfoOpen((open) => !open)}
            aria-expanded={infoOpen}
            className={`${iconButton} ${infoOpen ? 'text-indigo-200 bg-indigo-500/15' : ''}`}
            title="Why, and syllables, pauses and lips"
            aria-label="Why, and syllables, pauses and lips"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>

      {infoOpen && (
        <div className="mt-1.5 rounded-lg border border-edge bg-slate-950/60 px-2.5 py-2 text-[12.5px] leading-snug text-slate-300">
          {advice ? <p className={unit.status === 'long' ? 'text-rose-300' : short ? 'text-sky-300' : 'text-slate-300'}>{advice}</p> : <p>Fits its slot.</p>}
          {shortCut && <p className="mt-1 text-amber-300">{DEEP_CUT_HINT}</p>}
          <p className="mt-1 text-slate-400">{seconds}.</p>
          {counts && <p className="mt-1 text-slate-400">{counts}</p>}
          {placed && <p className="mt-1 text-slate-400">{placed.detail}</p>}
          {fasterSentence && <p className="mt-1 text-slate-400">{fasterSentence}</p>}
          {unit.expert ? (
            <>
              <p className="mt-2 text-[10.5px] uppercase tracking-wide font-semibold text-slate-500">Syllables, pauses and lips</p>
              <ExpertLineDetail unit={unit} />
            </>
          ) : (
            <p className="mt-1 text-[11.5px] text-slate-500">Syllables, pauses and lips show with the Expert estimate.</p>
          )}
        </div>
      )}

      {note?.text && <p className={`mt-1 text-[12.5px] leading-snug ${note.tone}`}>{note.text}</p>}
      {!idle && <LineFixControls unit={unit} cps={cps} state={state} direction={direction} {...controls} />}
    </div>
  );
};

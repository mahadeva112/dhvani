import React, { useEffect, useState } from 'react';
import { ChevronRight, ListChecks, Ruler, Undo2, X } from 'lucide-react';
import type { SyncJoinSettings } from '../services/syncService';
import type { AutoFitChange, AutoFitOutcome } from '../services/syncAutoFit';
import { presetName } from './SyncJoinSettings';

/**
 * What Sync's own Fit to this video did (services/syncAutoFit.ts): one card
 * on the Sync progress page and the Dub step, and a window in the middle of
 * the screen with each setting from → to and its reason, and Undo.
 */

const LABELS: Record<keyof SyncJoinSettings, string> = {
  chunkSync: 'Chunk sync',
  gateOpenDb: 'Split below',
  gateHysteresisDb: 'Split hysteresis',
  minSliceLength: 'Shortest chunk',
  minSilenceLength: 'Shortest silence to split at',
  leadPad: 'Chunk lead pad',
  trailPad: 'Chunk trail pad',
  chunkGapShare: 'Shrink a pause to',
  wordGap: 'Shortest pause at a word',
  commaGap: 'Shortest pause at a comma',
  stopGap: 'Shortest pause at a sentence end',
  maxChunkGap: 'Longest a chunk need wait',
  punctuationPriority: 'Words, then commas, then sentence ends',
  joinSpokenChunks: 'Join chunks said in one go',
  speedFit: 'Read faster',
  maxVoiceSpeed: 'Fastest read',
  bestTakes: 'Best of 3 takes',
  maxRevoice: 'Most lines voiced again',
  minGap: 'Minimum gap',
  speakerGap: 'Gap at a speaker change',
  gapShare: 'Keep of the original pause',
  breathClear: 'Keep breaths clear of the line before',
  removeBreaths: 'Remove breaths',
  breathReduction: 'Breath reduction',
  shortenPauses: 'Shorten pauses',
  minInnerPause: 'Shortest pause kept',
  maxPauseTake: 'Most taken from one pause',
  matchSourcePauses: 'Match source pauses',
  unmatchedPause: 'Pause the original never made',
  cutAtSourcePauses: "Cut at the original's pauses",
  sourceCutMinPause: 'Shortest source pause to cut at',
  sourceCutMaxInsert: 'Longest pause put in',
  tightenSilences: 'Tighten silences',
  tightMinPause: 'Tighten down to',
  tightMargin: 'Room around words',
  checkCutWords: 'Check cut words',
  spliceCrossfade: 'Splice crossfade',
  tailFloorDb: 'Tail down to',
  tailHold: 'Tail hold',
  edgeFade: 'Edge fade',
  maxLateStart: 'Latest start',
  anchorWeight: 'Pull to the original after a pause',
  endByVideo: 'Ends with the original',
  endSlack: 'End within',
  unitGap: 'Join cues closer than',
  maxUnit: 'Longest joined line',
  flagJoin: 'Flag joins tighter than',
  preserveLongPauses: 'Keep long pauses clear',
  protectedPause: 'A long pause is at least',
} as Record<keyof SyncJoinSettings, string>;

const SHARES = new Set(['chunkGapShare', 'gapShare', 'maxPauseTake', 'breathReduction']);
const DECIBELS = new Set(['gateOpenDb', 'gateHysteresisDb', 'tailFloorDb']);
const SECONDS = new Set(['maxChunkGap', 'maxUnit', 'endSlack', 'protectedPause']);
const COUNTS = new Set(['maxRevoice', 'anchorWeight']);

const valueOf = (key: AutoFitChange['key'], value: AutoFitChange['from']) => {
  if (key === 'preset') return presetName(value as never);
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'string') return value.charAt(0).toUpperCase() + value.slice(1);
  if (SHARES.has(key)) return `${Math.round(value * 100)}%`;
  if (DECIBELS.has(key)) return `${value} dB`;
  if (SECONDS.has(key)) return `${value} s`;
  if (key === 'maxVoiceSpeed') return `${value}×`;
  if (COUNTS.has(key)) return String(value);
  return `${Math.round(value * 1000)} ms`;
};

const labelOf = (key: AutoFitChange['key']) => (key === 'preset' ? 'Length preset' : LABELS[key] ?? key);

const ChangeRow: React.FC<{ change: AutoFitChange; quiet?: boolean }> = ({ change, quiet }) => (
  <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-2 border-t border-slate-800 first:border-t-0">
    <span className="min-w-0">
      <span className={`block text-[13px] ${quiet ? 'text-slate-300' : 'text-slate-100'}`}>{labelOf(change.key)}</span>
      {!quiet && <span className="block text-[11.5px] text-slate-400 mt-0.5">{change.reason}</span>}
    </span>
    <span className="tabular-nums text-[12.5px] text-indigo-200 whitespace-nowrap self-start">
      {valueOf(change.key, change.from)} <span className="text-slate-500">→</span> {valueOf(change.key, change.to)}
    </span>
  </li>
);

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The changes Fit measured and the preset row first; the rest the preset set, folded. */
const split = (changes: AutoFitChange[]) => ({
  measured: changes.filter((c) => c.by === 'fit' || c.key === 'preset'),
  byPreset: changes.filter((c) => c.by === 'preset' && c.key !== 'preset'),
});

export interface AutoFitPanelProps {
  outcome: AutoFitOutcome;
  /** True while the settings are still the ones it applied. */
  canUndo: boolean;
  /** Set once Undo was pressed. */
  undone?: boolean;
  onUndo: () => void;
  /** On a sync after lines were voiced: use the grouping it left out (the next Sync voices those lines again). */
  onUseGrouping?: () => void;
  groupingUsed?: boolean;
  onTurnOff?: () => void;
  onDismiss?: () => void;
}

/** The window: every change with its reason, and Undo. Centred, as the app's settings windows are. */
const WhatChangedWindow: React.FC<AutoFitPanelProps & { onClose: () => void }> = ({ outcome, canUndo, undone, onUndo, onTurnOff, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const applied = outcome.status === 'applied';
  const { measured, byPreset } = split(outcome.changes);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center sm:p-6 bg-slate-950/80 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="fit-changed-title"
        className="w-full max-w-[40rem] min-h-full sm:min-h-0 sm:my-auto flex flex-col sm:rounded-[18px] bg-slate-900 border border-slate-700/80 shadow-2xl text-slate-100 overflow-hidden animate-in zoom-in-95 duration-200 motion-reduce:animate-none"
      >
        <div className="flex items-center gap-3.5 px-5 sm:px-6 py-4 border-b border-slate-800">
          <div className="w-[38px] h-[38px] rounded-[10px] bg-indigo-500/15 text-indigo-300 flex items-center justify-center shrink-0" aria-hidden="true">
            <Ruler className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="fit-changed-title" className="text-lg font-semibold leading-tight">
              {applied ? 'What changed' : 'What Fit proposed'}
            </h2>
            <p className="text-[12.5px] text-slate-400 mt-0.5">
              {applied
                ? 'Sync measured this video first and changed these settings. The words are never changed.'
                : outcome.keptBecause ?? 'Nothing was changed.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0 cursor-default"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-4 flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
          {outcome.inSync && (
            <p className="text-[12.5px] text-slate-300">
              Sync preview: <b className="tabular-nums">{outcome.inSync.before}</b> → <b className="tabular-nums">{outcome.inSync.after}</b> of{' '}
              {plural(outcome.inSync.cues, 'cue')} in sync (an estimate from the text, before voicing).
            </p>
          )}
          <ul className="flex flex-col">
            {measured.map((change) => (
              <ChangeRow key={change.key} change={change} />
            ))}
          </ul>
          {byPreset.length > 0 && (
            <details className="group rounded-xl border border-slate-800 bg-slate-800/20">
              <summary className="flex items-center gap-2 px-3.5 py-2.5 list-none cursor-default text-[12.5px] text-slate-300 hover:text-slate-100 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
                {plural(byPreset.length, 'setting')} the {presetName(outcome.presetTo ?? 'natural')} preset sets
              </summary>
              <p className="px-3.5 text-[11.5px] text-slate-400">{byPreset[0].reason}</p>
              <ul className="px-3.5 pb-1.5 flex flex-col">
                {byPreset.map((change) => (
                  <ChangeRow key={change.key} change={change} quiet />
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 px-5 sm:px-6 py-3.5 border-t border-slate-800 bg-slate-950/30">
          <span className="flex-1 min-w-[14rem] text-[11.5px] text-slate-400">
            {undone
              ? 'Your settings are back. Sync again to hear it.'
              : !applied
                ? 'Your settings are as they were.'
                : outcome.undoRevoices && outcome.undoRevoices.lines > 0
                  ? `Undo also puts the old line grouping back: Sync again would voice about ${plural(outcome.undoRevoices.lines, 'line')} anew (${plural(outcome.undoRevoices.characters, 'character')}).`
                  : 'Undo puts your settings back. Sync again then reuses the lines already voiced: no credit.'}
          </span>
          {onTurnOff && (
            <button type="button" onClick={onTurnOff} className="text-[12px] text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline cursor-default">
              Don't fit when I Sync
            </button>
          )}
          {applied && !undone && (
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              title={canUndo ? undefined : 'The settings were changed since; Undo would undo those too.'}
              className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 text-[12.5px] font-medium text-slate-100 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-default"
            >
              <Undo2 className="w-3.5 h-3.5" /> Undo
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="h-9 px-3.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[12.5px] font-semibold text-white cursor-default"
          >
            Close
          </button>
        </div>
      </section>
    </div>
  );
};

/** One card: what Sync's fit did, in a line, with What changed, Undo and the grouping it left out. */
export const AutoFitPanel: React.FC<AutoFitPanelProps> = (props) => {
  const { outcome, canUndo, undone, onUndo, onUseGrouping, groupingUsed, onDismiss } = props;
  const [open, setOpen] = useState(false);
  const applied = outcome.status === 'applied';
  const settingCount = outcome.changes.filter((c) => c.key !== 'preset').length;
  const presetMove = outcome.changes.find((c) => c.key === 'preset');

  const headline = undone
    ? 'Fit to this video undone: your settings are back.'
    : applied
      ? `Fit to this video: ${plural(settingCount, 'setting')} changed${presetMove ? `, ${presetName(presetMove.from as never)} → ${presetName(presetMove.to as never)}` : ''}.`
      : outcome.status === 'fits'
        ? 'Settings already fit this video.'
        : outcome.status === 'custom'
          ? 'Your Custom settings were kept: Fit to this video leaves them alone.'
          : outcome.keptBecause ?? 'Settings kept as they are.';
  const detail =
    applied && !undone && outcome.inSync
      ? `Preview: ${outcome.inSync.before} → ${outcome.inSync.after} of ${outcome.inSync.cues} cues in sync.`
      : outcome.status === 'kept' && outcome.changes.length > 0 && !outcome.keptBecause?.includes('undid')
        ? 'Nothing was changed.'
        : null;
  const grouping = outcome.grouping;

  return (
    <section
      aria-label="Fit to this video"
      className={`flex flex-col gap-2 rounded-xl border px-3.5 py-2.5 ${applied && !undone ? 'border-indigo-500/35 bg-indigo-500/[.06]' : 'border-slate-800 bg-slate-900/70'}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Ruler className="w-4 h-4 shrink-0 text-indigo-300" aria-hidden="true" />
        <span className="flex-1 min-w-[12rem] text-[13px] text-slate-200">
          {headline}
          {detail && <span className="text-slate-400"> {detail}</span>}
        </span>
        {outcome.changes.length > 0 && outcome.status !== 'fits' && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 text-[12.5px] text-slate-200 hover:bg-slate-800 cursor-default"
          >
            <ListChecks className="w-3.5 h-3.5" /> {applied ? 'What changed' : 'What it proposed'}
          </button>
        )}
        {applied && !undone && (
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title={canUndo ? 'Put your settings back as they were' : 'The settings were changed since'}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 text-[12.5px] text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-default"
          >
            <Undo2 className="w-3.5 h-3.5" /> Undo
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Hide"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 cursor-default"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {grouping && !undone && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-7 text-[12px] text-slate-400">
          <span className="flex-1 min-w-[12rem]">
            {groupingUsed
              ? `Grouping changed: the next Sync voices about ${plural(grouping.lines, 'line')} anew (${plural(grouping.characters, 'character')}).`
              : `Line grouping could match this video too (${grouping.changes.map((c) => `${labelOf(c.key).toLowerCase()} ${valueOf(c.key, c.from)} → ${valueOf(c.key, c.to)}`).join(', ')}). Left as it is: it voices about ${plural(grouping.lines, 'line')} anew, ${plural(grouping.characters, 'character')}.`}
          </span>
          {onUseGrouping && !groupingUsed && (
            <button
              type="button"
              onClick={onUseGrouping}
              className="h-8 px-3 rounded-lg border border-slate-700 text-[12.5px] text-slate-200 hover:bg-slate-800 cursor-default"
            >
              Use this grouping
            </button>
          )}
        </div>
      )}
      {open && <WhatChangedWindow {...props} onClose={() => setOpen(false)} />}
    </section>
  );
};

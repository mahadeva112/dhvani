import React from 'react';
import type { SyncJoinSettings, SyncOptions } from '../services/syncService';
import type { SyncJoinSection } from './SyncJoinSettings';

/**
 * A small picture at the top of a Sync settings section: the original
 * speaker's lines over the dub's, with the gap, pause or tail the section
 * sets marked in amber. Drawn from the current settings, so it follows a
 * slider as it moves. An illustration, not a measurement of this dub.
 */

const ms = (seconds: number) => `${Math.round(seconds * 1000)} ms`;
/** Seconds to pixels, kept readable: a few ms still shows, a long pause doesn't run off the picture. */
const px = (seconds: number) => Math.max(6, Math.min(170, seconds * 600));

const ROW_ORIGINAL = 22;
const ROW_DUB = 76;
const H = 26;
const X0 = 76;

const Block: React.FC<{ x: number; y: number; w: number; label?: string; tone: 'original' | 'dub' | 'flag' | 'faint' }> = ({ x, y, w, label, tone }) => (
  <g>
    <rect
      x={x}
      y={y}
      width={Math.max(4, w)}
      height={H}
      rx={5}
      className={
        tone === 'original' ? 'fill-slate-700' : tone === 'dub' ? 'fill-indigo-600' : tone === 'flag' ? 'fill-amber-600' : 'fill-indigo-600/35'
      }
    />
    {label && w > 40 && (
      <text x={x + 8} y={y + 17} className="fill-slate-100 text-[11px]">
        {label}
      </text>
    )}
  </g>
);

/** A measured span: a bracket with its value over it. */
const Span: React.FC<{ x1: number; x2: number; y: number; label: string }> = ({ x1, x2, y, label }) => (
  <g className="stroke-amber-400">
    <line x1={x1} x2={x2} y1={y} y2={y} strokeWidth={1.5} />
    <line x1={x1} x2={x1} y1={y - 5} y2={y + 5} />
    <line x1={x2} x2={x2} y1={y - 5} y2={y + 5} />
    <text x={(x1 + x2) / 2} y={y + 16} textAnchor="middle" className="fill-amber-300 stroke-none text-[11px]">
      {label}
    </text>
  </g>
);

const Guide: React.FC<{ x: number }> = ({ x }) => (
  <line x1={x} x2={x} y1={ROW_ORIGINAL + H} y2={ROW_DUB} strokeDasharray="3 3" className="stroke-indigo-400/70" />
);

const scene = (section: SyncJoinSection, join: SyncJoinSettings, options: SyncOptions): React.ReactNode => {
  switch (section) {
    case 'chunks': {
      if (!join.chunkSync)
        return (
          <>
            <Block x={X0} y={ROW_ORIGINAL} w={150} label="we came" tone="original" />
            <Block x={X0 + 200} y={ROW_ORIGINAL} w={160} label="to the river" tone="original" />
            <Block x={X0} y={ROW_DUB} w={360} label="Placed whole: chunk sync is off" tone="dub" />
          </>
        );
      const gap = px(Math.max(join.minSilenceLength, 0.08));
      return (
        <>
          <Block x={X0} y={ROW_ORIGINAL} w={150} label="we came" tone="original" />
          <Block x={X0 + 200} y={ROW_ORIGINAL} w={160} label="to the river" tone="original" />
          <Block x={X0 + 420} y={ROW_ORIGINAL} w={190} label="at dawn" tone="original" />
          <Block x={X0} y={ROW_DUB} w={200 - gap} label="chunk 1" tone="dub" />
          <Block x={X0 + 200} y={ROW_DUB} w={420 - 200 - gap} label="chunk 2" tone="dub" />
          <Block x={X0 + 420} y={ROW_DUB} w={175} label="chunk 3" tone="dub" />
          <Guide x={X0 + 200} />
          <Guide x={X0 + 420} />
          <Span x1={X0 + 200 - gap} x2={X0 + 200} y={ROW_DUB + H + 12} label={`Split below ${Math.round(join.gateOpenDb)} dB`} />
        </>
      );
    }
    case 'gaps': {
      const gap = px(join.minGap);
      return (
        <>
          <Block x={X0} y={ROW_ORIGINAL} w={230} label="Line 12" tone="original" />
          <Block x={X0 + 330} y={ROW_ORIGINAL} w={260} label="Line 13" tone="original" />
          <Block x={X0} y={ROW_DUB} w={260} label="Line 12" tone="dub" />
          <Block x={X0 + 260 + gap} y={ROW_DUB} w={250} label="Line 13" tone="dub" />
          <Span x1={X0 + 260} x2={X0 + 260 + gap} y={ROW_DUB + H + 12} label={`Minimum gap ${ms(join.minGap)}`} />
        </>
      );
    }
    case 'pauses': {
      const cut = join.matchSourcePauses ? px(join.unmatchedPause) : px(0.35);
      return (
        <>
          <Block x={X0} y={ROW_ORIGINAL} w={520} label="One line, said without stopping" tone="original" />
          <Block x={X0} y={ROW_DUB} w={210} label="part one" tone="dub" />
          <Block x={X0 + 210 + cut} y={ROW_DUB} w={520 - 210 - cut} label="part two" tone="dub" />
          <Span
            x1={X0 + 210}
            x2={X0 + 210 + cut}
            y={ROW_DUB + H + 12}
            label={join.matchSourcePauses ? `A pause the original never made: cut to ${ms(join.unmatchedPause)}` : 'Kept as voiced'}
          />
        </>
      );
    }
    case 'edges': {
      const hold = px(join.tailHold) + 24;
      return (
        <>
          <Block x={X0} y={ROW_ORIGINAL} w={400} label="Line 7" tone="original" />
          <Block x={X0} y={ROW_DUB} w={360} label="Line 7" tone="dub" />
          <Block x={X0 + 360} y={ROW_DUB} w={hold} tone="faint" />
          <Span x1={X0 + 360} x2={X0 + 360 + hold} y={ROW_DUB + H + 12} label={`Tail to ${join.tailFloorDb} dB, held ${ms(join.tailHold)}`} />
        </>
      );
    }
    case 'fit': {
      const late = px(join.maxLateStart);
      const strict = options.timingProtection === 'strict';
      return (
        <>
          <Block x={X0} y={ROW_ORIGINAL} w={300} label="Line 20" tone="original" />
          <Block x={X0 + 340} y={ROW_ORIGINAL} w={220} label="Line 21" tone="original" />
          <Block x={X0} y={ROW_DUB} w={330 + late} label="Line 20, runs long" tone="dub" />
          <Block x={X0 + 340 + late} y={ROW_DUB} w={220} label={strict ? 'Line 21, held here' : 'Line 21, flagged'} tone="flag" />
          <Guide x={X0 + 340} />
          <Span x1={X0 + 340} x2={X0 + 340 + late} y={ROW_DUB + H + 12} label={`${strict ? 'Kept within' : 'Starts more than'} ${ms(join.maxLateStart)}${strict ? '' : ' late'}`} />
        </>
      );
    }
    case 'grouping': {
      const gap = px(join.unitGap) * 0.7;
      return (
        <>
          <Block x={X0} y={ROW_ORIGINAL} w={200} label="Cue 4" tone="original" />
          <Block x={X0 + 200 + gap} y={ROW_ORIGINAL} w={220} label="Cue 5" tone="original" />
          <Block x={X0} y={ROW_DUB} w={420 + gap} label="Voiced as one line" tone="dub" />
          <Span x1={X0 + 200} x2={X0 + 200 + gap} y={ROW_ORIGINAL - 12} label="" />
          <text x={X0 + 200 + gap / 2} y={ROW_ORIGINAL - 16} textAnchor="middle" className="fill-amber-300 text-[11px]">
            {`Under ${ms(join.unitGap)} apart`}
          </text>
        </>
      );
    }
    case 'review': {
      const join_ = px(join.flagJoin);
      return (
        <>
          <Block x={X0} y={ROW_ORIGINAL} w={280} label="Line 30" tone="original" />
          <Block x={X0 + 340} y={ROW_ORIGINAL} w={240} label="Line 31" tone="original" />
          <Block x={X0} y={ROW_DUB} w={320} label="Line 30" tone="dub" />
          <Block x={X0 + 320 + join_} y={ROW_DUB} w={240} label={join.flagJoin === 0 ? 'Line 31' : 'Line 31, worth a listen'} tone={join.flagJoin === 0 ? 'dub' : 'flag'} />
          <Span x1={X0 + 320} x2={X0 + 320 + join_} y={ROW_DUB + H + 12} label={join.flagJoin === 0 ? 'Tight joins are not flagged' : `A join under ${ms(join.flagJoin)} is flagged`} />
        </>
      );
    }
  }
};

export const SyncSettingsDiagram: React.FC<{ section: SyncJoinSection; options: SyncOptions }> = ({ section, options }) => (
  <figure className="rounded-xl border border-slate-800 bg-slate-950/50 px-4 pt-2 pb-2.5">
    <svg viewBox="0 0 780 132" className="w-full h-auto max-h-36" aria-hidden="true">
      <text x={0} y={ROW_ORIGINAL + 17} className="fill-slate-500 text-[11px]">
        Original
      </text>
      <text x={0} y={ROW_DUB + 17} className="fill-slate-500 text-[11px]">
        Dub
      </text>
      {scene(section, options.join, options)}
    </svg>
    <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
      <span className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-sm bg-slate-700" /> Original speaker
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-sm bg-indigo-600" /> Dub
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-sm bg-amber-400" /> What this section sets
      </span>
      <span className="ml-auto">An example, drawn from your settings</span>
    </figcaption>
  </figure>
);

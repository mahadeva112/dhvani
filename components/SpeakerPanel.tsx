import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Check, CheckCircle2, Download, Layers, Play, Users, X } from 'lucide-react';
import { AudioSegment, DubMixReport, DubStem, MixPeakMode, SpeakerVoice } from '../types';
import { SpeakerSummary, SpeakerSlip, speakerOf } from '../services/speakers';
import { mergeSuggestions, type VoiceMatch } from '../services/voiceMatch';
import type { Voice } from '../services/elevenLabsService';
import type { VoiceRateState } from '../services/voiceRate';

/**
 * The pieces of the wizard that deal with several speakers: who speaks when
 * (Review), which voice speaks for whom (Dub), and what the mix of
 * those voices did. All of them stay out of the way when there is one speaker.
 */

const clock = (seconds: number) => {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};

/** A speaker's name with their colour. */
export const SpeakerChip: React.FC<{ speaker: SpeakerSummary | undefined; name: string; suffix?: string; className?: string }> = ({
  speaker,
  name,
  suffix,
  className = '',
}) => (
  <span
    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11.5px] font-medium whitespace-nowrap ${className}`}
    style={{ color: speaker?.color, borderColor: `${speaker?.color ?? '#64748b'}55`, backgroundColor: `${speaker?.color ?? '#64748b'}14` }}
  >
    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: speaker?.color ?? '#64748b' }} />
    {name}
    {suffix && <span className="text-slate-400 font-normal">{suffix}</span>}
  </span>
);

/* ------------------------------------------------------------------------ */
/* Review                                                                    */
/* ------------------------------------------------------------------------ */

interface SpeakerBarProps {
  speakers: SpeakerSummary[];
  segments: AudioSegment[];
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  /** Speakers whose cues the list shows; empty shows everyone. */
  filter: string[];
  onFilterChange: (filter: string[]) => void;
  slipCount: number;
  /** Whether the list shows only the labels to check; the button toggles it. */
  slipsShown?: boolean;
  onShowSlips: () => void;
  onRenameSpeaker?: (from: string, to: string) => void;
  /** Cue ids that start over another speaker in the original. */
  overlapIds: Set<string>;
  /** How alike each pair of speakers sounds (services/voiceMatch.ts); the alike ones are offered as a merge. */
  voiceMatches?: VoiceMatch[];
  /** Plays a stretch of the original, to hear a speaker before merging. */
  onHearSpeaker?: (speaker: string) => void;
  /** Cues whose voice fits another speaker better than their own label; a button shows only those, and one relabels them all. */
  voiceFlagCount?: number;
  voiceShown?: boolean;
  onShowVoice?: () => void;
  onFixByVoice?: () => void;
}

/**
 * Who speaks when, under the review player: one lane coloured by speaker,
 * a chip per speaker (a click filters the cues to them), and a panel to
 * rename speakers or merge one into another.
 */
export const SpeakerBar: React.FC<SpeakerBarProps> = ({
  speakers,
  segments,
  duration,
  currentTime,
  onSeek,
  filter,
  onFilterChange,
  slipCount,
  slipsShown = false,
  onShowSlips,
  onRenameSpeaker,
  overlapIds,
  voiceMatches = [],
  onHearSpeaker,
  voiceFlagCount = 0,
  voiceShown = false,
  onShowVoice,
  onFixByVoice,
}) => {
  const [managing, setManaging] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const names = useMemo(() => new Set(speakers.map((s) => s.name)), [speakers]);
  const suggestions = useMemo(
    () => mergeSuggestions(voiceMatches).filter((m) => names.has(m.from) && names.has(m.into) && !dismissed.has(`${m.from}|${m.into}`)),
    [voiceMatches, names, dismissed]
  );
  const colorOf = useMemo(() => new Map(speakers.map((s) => [s.name, s.color])), [speakers]);
  const length = Math.max(duration, segments.reduce((max, s) => Math.max(max, s.endTime), 0), 0.001);

  return (
    <section aria-label="Speakers" className="bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider font-semibold text-slate-500 mr-1">
          <Users className="w-3.5 h-3.5" /> {speakers.length} speakers
        </span>
        {speakers.map((s) => {
          const on = filter.includes(s.name);
          return (
            <button
              key={s.name}
              type="button"
              aria-pressed={on}
              onClick={() => onFilterChange(on ? filter.filter((f) => f !== s.name) : [...filter, s.name])}
              title={`${s.cues} cues · ${Math.round(s.seconds)} s. Show only their cues.`}
              className={`rounded-md cursor-default transition-shadow ${on ? 'ring-1 ring-slate-100' : ''}`}
            >
              <SpeakerChip
                speaker={s}
                name={s.name}
                suffix={s.share >= 0.01 ? `${Math.round(s.share * 100)}%` : `${s.seconds.toFixed(1)} s`}
              />
            </button>
          );
        })}
        {filter.length > 0 && (
          <button type="button" onClick={() => onFilterChange([])} className="text-xs text-slate-400 hover:text-slate-200 cursor-default">
            Show everyone
          </button>
        )}
        {slipCount > 0 && (
          <button
            type="button"
            onClick={onShowSlips}
            aria-pressed={slipsShown}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs text-amber-300 hover:text-amber-200 cursor-default ${
              slipsShown ? 'bg-amber-950/50 ring-1 ring-amber-700' : ''
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" /> {slipCount === 1 ? '1 label to check' : `${slipCount} labels to check`}
            {slipsShown && <span className="text-slate-400">· show all</span>}
          </button>
        )}
        {voiceFlagCount > 0 && onShowVoice && (
          <span className={`flex items-center rounded-md text-xs ${voiceShown ? 'bg-amber-950/50 ring-1 ring-amber-700' : ''}`}>
            <button type="button" onClick={onShowVoice} aria-pressed={voiceShown} className="flex items-center gap-1 px-2 py-0.5 text-amber-300 hover:text-amber-200 cursor-default">
              <AlertTriangle className="w-3.5 h-3.5" />
              {voiceFlagCount === 1 ? '1 cue sounds like someone else' : `${voiceFlagCount} cues sound like someone else`}
              {voiceShown && <span className="text-slate-400">· show all</span>}
            </button>
            {onFixByVoice && (
              <button type="button" onClick={onFixByVoice} className="px-2 py-0.5 text-slate-200 hover:text-white border-l border-amber-900/70 cursor-default">
                Relabel by voice
              </button>
            )}
          </span>
        )}
        {onRenameSpeaker && (
          <button
            type="button"
            onClick={() => setManaging((v) => !v)}
            aria-expanded={managing}
            className="ml-auto flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-default"
          >
            <Users className="w-3.5 h-3.5" /> {managing ? 'Done' : 'Manage speakers'}
          </button>
        )}
      </div>

      {/* Who speaks when. Click to jump there. */}
      <div
        role="slider"
        aria-label="Who speaks when"
        aria-valuemin={0}
        aria-valuemax={Math.round(length)}
        aria-valuenow={Math.round(currentTime)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') onSeek(Math.min(length, currentTime + 5));
          if (e.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - 5));
        }}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          onSeek(((e.clientX - box.left) / box.width) * length);
        }}
        className="relative h-3 rounded bg-slate-800/70 cursor-default"
      >
        {segments.map((seg) => (
          <span
            key={seg.id}
            className="absolute top-0.5 h-2 rounded-sm"
            style={{
              left: `${(seg.startTime / length) * 100}%`,
              width: `${Math.max(0.15, ((seg.endTime - seg.startTime) / length) * 100)}%`,
              backgroundColor: colorOf.get(speakerOf(seg)) ?? '#64748b',
              opacity: filter.length === 0 || filter.includes(speakerOf(seg)) ? 0.9 : 0.25,
            }}
          />
        ))}
        {segments
          .filter((seg) => overlapIds.has(String(seg.id)))
          .map((seg) => (
            <span
              key={`ov-${seg.id}`}
              title="Two speakers talk at once here"
              className="absolute -top-0.5 h-4 w-1.5 -ml-0.5 rounded-sm border border-dashed border-amber-400"
              style={{ left: `${(seg.startTime / length) * 100}%` }}
            />
          ))}
        <span className="absolute -top-1 -bottom-1 w-px bg-white/80" style={{ left: `${(Math.min(currentTime, length) / length) * 100}%` }} />
      </div>

      {onRenameSpeaker &&
        suggestions.map((m) => (
          <div key={`${m.from}|${m.into}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-900/70 bg-amber-950/30 px-3 py-2 text-[12.5px] text-amber-200">
            <Users className="w-4 h-4 shrink-0" />
            <span className="flex-1 min-w-[12rem]">
              {m.from} sounds like {m.into} ({m.match}% voice match) and they never talk over each other. Probably one person.
            </span>
            {onHearSpeaker && (
              <>
                <button type="button" onClick={() => onHearSpeaker(m.from)} className="flex items-center gap-1 h-7 px-2 rounded-md border border-amber-900/70 hover:bg-amber-900/30 cursor-default">
                  <Play className="w-3 h-3 fill-current" /> {m.from}
                </button>
                <button type="button" onClick={() => onHearSpeaker(m.into)} className="flex items-center gap-1 h-7 px-2 rounded-md border border-amber-900/70 hover:bg-amber-900/30 cursor-default">
                  <Play className="w-3 h-3 fill-current" /> {m.into}
                </button>
              </>
            )}
            <button type="button" onClick={() => onRenameSpeaker(m.from, m.into)} className="flex items-center gap-1 h-7 px-2.5 rounded-md border border-slate-700 text-slate-100 hover:bg-slate-800 cursor-default">
              <Check className="w-3 h-3" /> Merge into {m.into}
            </button>
            <button
              type="button"
              onClick={() => setDismissed((d) => new Set(d).add(`${m.from}|${m.into}`))}
              className="h-7 px-2.5 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-default"
            >
              Keep separate
            </button>
          </div>
        ))}

      {managing && onRenameSpeaker && (
        <div className="border-t border-slate-800 pt-3 grid gap-2">
          <p className="text-[11.5px] text-slate-500">
            Rename a speaker, or merge one into another when ElevenLabs split one person in two. Every cue they speak moves with them.
          </p>
          {speakers.map((s) => (
            <SpeakerManageRow key={s.name} speaker={s} others={speakers.filter((o) => o.name !== s.name)} onRename={onRenameSpeaker} />
          ))}
        </div>
      )}
    </section>
  );
};

const SpeakerManageRow: React.FC<{ speaker: SpeakerSummary; others: SpeakerSummary[]; onRename: (from: string, to: string) => void }> = ({
  speaker,
  others,
  onRename,
}) => {
  const [name, setName] = useState(speaker.name);
  useEffect(() => setName(speaker.name), [speaker.name]);
  const commit = () => {
    const next = name.trim();
    if (next && next !== speaker.name) onRename(speaker.name, next);
    else setName(speaker.name);
  };
  return (
    <div className="grid grid-cols-[0.75rem_minmax(0,1fr)_auto_minmax(0,11rem)] items-center gap-2.5 text-[13px]">
      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: speaker.color }} />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setName(speaker.name);
        }}
        aria-label={`Name of ${speaker.name}`}
        className="h-8 bg-slate-950 border border-slate-800 rounded-lg px-2.5 text-[13px] text-slate-100 focus:outline-none focus:border-indigo-500"
      />
      <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
        {speaker.cues} cues · {Math.round(speaker.seconds)} s
      </span>
      <select
        value=""
        onChange={(e) => e.target.value && onRename(speaker.name, e.target.value)}
        aria-label={`Merge ${speaker.name} into another speaker`}
        className="h-8 bg-slate-950 border border-slate-800 rounded-lg px-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 cursor-default"
      >
        <option value="">Merge into…</option>
        {others.map((o) => (
          <option key={o.name} value={o.name} className="bg-slate-900">
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
};

/**
 * The bar that appears when cues are ticked: hand them all to one speaker,
 * tick everything the list shows, or let go. It sticks to the top while the
 * list scrolls, so a long selection can be made and applied without scrolling back.
 */
export const CueSelectionBar: React.FC<{
  count: number;
  speakers: SpeakerSummary[];
  onAssign: (speaker: string) => void;
  onSelectShown: () => void;
  shownCount: number;
  onClear: () => void;
}> = ({ count, speakers, onAssign, onSelectShown, shownCount, onClear }) => (
  <div
    role="toolbar"
    aria-label="Selected cues"
    className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-500/50 bg-slate-900/95 px-3 py-2 text-[12.5px] text-slate-200"
  >
    <span className="font-medium tabular-nums">{count === 1 ? '1 cue selected' : `${count} cues selected`}</span>
    <span className="text-slate-500">Set speaker to</span>
    {speakers.map((s) => (
      <button key={s.name} type="button" onClick={() => onAssign(s.name)} className="rounded-md cursor-default hover:brightness-125" title={`Make all ${count} cues ${s.name}`}>
        <SpeakerChip speaker={s} name={s.name} />
      </button>
    ))}
    <span className="ml-auto flex items-center gap-2">
      {count < shownCount && (
        <button type="button" onClick={onSelectShown} className="text-slate-300 hover:text-white cursor-default">
          Select all {shownCount} shown
        </button>
      )}
      <button type="button" onClick={onClear} className="flex items-center gap-1 h-7 px-2 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-default">
        <X className="w-3.5 h-3.5" /> Clear
      </button>
    </span>
  </div>
);

/** Who says a cue, with a menu to hand it to another speaker. */
export const SpeakerPicker: React.FC<{
  value: string;
  speakers: SpeakerSummary[];
  onChange?: (speaker: string) => void;
}> = ({ value, speakers, onChange }) => {
  const speaker = speakers.find((s) => s.name === value);
  if (!onChange) return <SpeakerChip speaker={speaker} name={value} />;
  return (
    <label className="relative inline-flex cursor-default" title="Who says this line">
      <SpeakerChip speaker={speaker} name={value} suffix="▾" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Who says this line"
        className="absolute inset-0 opacity-0 cursor-default"
      >
        {speakers.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
};

/** Under a cue: a probable labelling slip to fix or keep, and an overlap the dub will keep. */
export const SpeakerCueNotes: React.FC<{
  slip?: SpeakerSlip;
  overlap?: { speaker: string; seconds: number };
  onHear?: () => void;
  onAccept?: (speaker: string) => void;
  onKeep?: () => void;
  current: string;
  /** This cue's voice fits another speaker better than its label (services/voiceMatch.ts). */
  voice?: { match: number; suggested: string };
}> = ({ slip, overlap, onHear, onAccept, onKeep, current, voice }) => (
  <>
    {overlap && (
      <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-amber-300/90">
        <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
        Starts {overlap.seconds.toFixed(1)} s before {overlap.speaker} finishes. A synced dub keeps this overlap.
      </p>
    )}
    {voice && !slip && (
      <div className="mt-2 rounded-lg border border-amber-900/70 bg-amber-950/30 px-2.5 py-2 text-[11.5px] text-amber-200">
        <p className="flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          This sounds more like {voice.suggested} than {current} ({voice.match}% match to {current}).
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {onHear && (
            <button type="button" onClick={onHear} className="flex items-center gap-1 h-6 px-2 rounded-md border border-amber-900/70 hover:bg-amber-900/30 cursor-default">
              <Play className="w-3 h-3 fill-current" /> Hear
            </button>
          )}
          {onAccept && (
            <button type="button" onClick={() => onAccept(voice.suggested)} className="flex items-center gap-1 h-6 px-2 rounded-md border border-slate-700 text-slate-100 hover:bg-slate-800 cursor-default">
              <Check className="w-3 h-3" /> Make it {voice.suggested}
            </button>
          )}
          {onKeep && (
            <button type="button" onClick={onKeep} className="h-6 px-2 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-default">
              Keep {current}
            </button>
          )}
        </div>
      </div>
    )}
    {slip && (
      <div className="mt-2 rounded-lg border border-amber-900/70 bg-amber-950/30 px-2.5 py-2 text-[11.5px] text-amber-200">
        <p className="flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          {slip.reason === 'between'
            ? `${slip.suggested} speaks just before and after. This short switch to ${current} is probably a labelling slip.`
            : `${current} says almost nothing else in the recording. This is probably ${slip.suggested}.`}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {onHear && (
            <button type="button" onClick={onHear} className="flex items-center gap-1 h-6 px-2 rounded-md border border-amber-900/70 hover:bg-amber-900/30 cursor-default">
              <Play className="w-3 h-3 fill-current" /> Hear
            </button>
          )}
          {onAccept && (
            <button type="button" onClick={() => onAccept(slip.suggested)} className="flex items-center gap-1 h-6 px-2 rounded-md border border-slate-700 text-slate-100 hover:bg-slate-800 cursor-default">
              <Check className="w-3 h-3" /> Make it {slip.suggested}
            </button>
          )}
          {onKeep && (
            <button type="button" onClick={onKeep} className="h-6 px-2 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-default">
              Keep {current}
            </button>
          )}
        </div>
      </div>
    )}
  </>
);

/* ------------------------------------------------------------------------ */
/* Dub                                                                       */
/* ------------------------------------------------------------------------ */

const voiceName = (voiceId: string, voices: Voice[]) => {
  const voice = voices.find((v) => v.voice_id === voiceId);
  return ((voice?.name || 'Voice not in your library').split(/\s+[-–—|]\s+/)[0] || '').trim();
};

/** A voice's speaking rate after its role: its syllables a second, or that it is being measured. */
const rateNote = (state?: VoiceRateState) =>
  state?.rate ? ` · ${state.rate.syllablesPerSecond.toFixed(1)} syllables/s` : state?.status === 'measuring' ? ' · measuring speed…' : '';

/** Which voice speaks for whom. A speaker with no voice of their own is voiced by the main voice. */
export const CastCard: React.FC<{
  speakers: SpeakerSummary[];
  cast: Record<string, SpeakerVoice> | undefined;
  mainVoiceId: string;
  availableVoices: Voice[];
  disabled?: boolean;
  onPick: (speaker: string) => void;
  onUseMain: (speaker: string) => void;
  /** Each speaker's own voice's speaking rate, by name, and the main voice's (services/voiceRate.ts). */
  rates?: Record<string, VoiceRateState>;
  mainRate?: VoiceRateState;
}> = ({ speakers, cast, mainVoiceId, availableVoices, disabled, onPick, onUseMain, rates, mainRate }) => {
  const ownVoices = speakers.map((s) => cast?.[s.name]?.voiceId || mainVoiceId);
  const shared = new Set(ownVoices).size < speakers.length;
  return (
    <div className="flex flex-col gap-1">
      {speakers.map((s, n) => {
        const own = cast?.[s.name]?.voiceId;
        const voiceId = own || mainVoiceId;
        const name = voiceName(voiceId, availableVoices);
        return (
          <div key={s.name} className="flex items-center gap-2 py-1.5 border-t border-slate-800 first:border-t-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <span className="w-20 shrink-0 truncate text-[13px] text-slate-200" title={s.name}>
              {s.name}
            </span>
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10.5px] font-semibold shrink-0"
              style={{ backgroundColor: `${s.color}26`, color: s.color }}
            >
              {name.charAt(0).toUpperCase()}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[12.5px] text-slate-100 truncate" title={name}>
                {name}
              </span>
              <span className="block text-[10.5px] text-slate-500 tabular-nums">
                {own ? 'Own voice' : 'Main voice'}
                {rateNote(own ? rates?.[s.name] : mainRate)}
              </span>
            </span>
            {own && (
              <button
                type="button"
                onClick={() => onUseMain(s.name)}
                disabled={disabled}
                title="Voice this speaker with the main voice"
                aria-label={`Voice ${s.name} with the main voice`}
                className="p-1 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800 cursor-default disabled:opacity-40"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onPick(s.name)}
              disabled={disabled}
              data-index={n}
              className="px-2.5 py-1 rounded-lg border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-default shrink-0 disabled:opacity-40"
            >
              Change
            </button>
          </div>
        );
      })}
      {shared && (
        <p className="text-[11px] text-amber-300/90 leading-snug pt-1">
          Some speakers share a voice, so they will sound alike. Give each their own to tell them apart.
        </p>
      )}
    </div>
  );
};

/** How a mix that peaks above full scale is written. */
export const MixPeakChoice: React.FC<{ value: MixPeakMode; onChange: (mode: MixPeakMode) => void; disabled?: boolean }> = ({
  value,
  onChange,
  disabled,
}) => (
  <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
    <legend className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">When speakers overlap</legend>
    {(
      [
        { mode: 'float', label: 'Keep 32-bit float', hint: 'The mix is kept exactly as summed. Nothing is turned down, and nothing clips.' },
        { mode: 'lower', label: 'Lower the whole mix', hint: 'Only if it goes over full scale, by one gain for the whole dub. The report says how much.' },
      ] as const
    ).map((o) => (
      <label key={o.mode} className="flex items-start gap-2.5 text-xs cursor-default">
        <input
          type="radio"
          name="dub-mix-peak"
          checked={value === o.mode}
          onChange={() => onChange(o.mode)}
          className="mt-0.5 w-3.5 h-3.5 accent-indigo-500 cursor-default"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-slate-200 font-medium">{o.label}</span>
          <span className="text-[11px] text-slate-500 leading-snug">{o.hint}</span>
        </span>
      </label>
    ))}
  </fieldset>
);

/** What mixing the speakers did, stated plainly. */
export const MixChecks: React.FC<{ mix: DubMixReport; synced?: boolean }> = ({ mix, synced = false }) => {
  const gains = Object.entries(mix.gains || {}).filter(([, db]) => Math.abs(db) >= 0.1);
  const ok = 'text-emerald-400';
  const warn = 'text-amber-400';
  const rows: { tone: string; text: string }[] = [
    {
      tone: ok,
      text: gains.length
        ? `Every line as voiced, with one gain per speaker: ${gains.map(([s, db]) => `${s} ${db > 0 ? '+' : ''}${db.toFixed(1)} dB`).join(', ')}.`
        : 'Every line exactly as voiced: no stretching, no gain and no fades.',
    },
    { tone: ok, text: `${mix.speakers.length} speakers, one track each in Stems.` },
  ];
  if (synced) {
    rows.push(
      (mix.selfOverlaps ?? 0) > 0
        ? { tone: warn, text: `${mix.selfOverlaps} ${mix.selfOverlaps === 1 ? 'place where a speaker runs' : 'places where a speaker runs'} into their own line. Shorten those lines.` }
        : {
            tone: ok,
            text: `No one talks over themself.${mix.overlapsKept ? ` ${mix.overlapsKept} ${mix.overlapsKept === 1 ? 'overlap' : 'overlaps'} kept from the original.` : ''}`,
          }
    );
  }
  if (mix.overFullScale) {
    rows.push(
      mix.peak === 'float'
        ? { tone: warn, text: `The mix peaks at +${(mix.peakDb ?? 0).toFixed(1)} dB at ${clock(mix.peakAt)}, where voices sum. Saved as 32-bit float, so nothing clipped.` }
        : { tone: warn, text: `The mix peaked at +${(mix.peakDb ?? 0).toFixed(1)} dB at ${clock(mix.peakAt)}, so the whole dub was lowered by ${mix.loweredDb.toFixed(1)} dB.` }
    );
  } else if (mix.peakDb !== null) {
    rows.push({ tone: ok, text: `Peaks at ${mix.peakDb.toFixed(1)} dBFS. Nothing goes over full scale.` });
  }
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row, i) => (
        <li key={i} className="flex items-start gap-2 text-[12.5px] text-slate-300">
          {row.tone === ok ? (
            <CheckCircle2 className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${row.tone}`} />
          ) : (
            <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${row.tone}`} />
          )}
          <span>{row.text}</span>
        </li>
      ))}
    </ul>
  );
};

/** One download per speaker's track. */
export const StemDownloads: React.FC<{ stems: DubStem[]; speakers: SpeakerSummary[]; onDownload: (speaker: string) => void }> = ({
  stems,
  speakers,
  onDownload,
}) => (
  <div className="flex flex-col gap-1.5">
    <span className="flex items-center gap-1.5 text-[11.5px] text-slate-400">
      <Layers className="w-3.5 h-3.5" /> Stems: the same length as the dub, so they line up at 0:00
    </span>
    {stems.map((stem) => {
      const speaker = speakers.find((s) => s.name === stem.speaker);
      return (
        <button
          key={stem.speaker}
          type="button"
          onClick={() => onDownload(stem.speaker)}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl border border-slate-800 hover:bg-slate-800/50 text-left cursor-default"
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: speaker?.color ?? '#64748b' }} />
          <span className="flex-1 min-w-0 text-[13px] text-slate-100 truncate">{stem.speaker}</span>
          <span className="font-mono text-[9.5px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">WAV</span>
          <Download className="w-4 h-4 text-slate-500 shrink-0" />
        </button>
      );
    })}
  </div>
);

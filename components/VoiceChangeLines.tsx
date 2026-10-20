import React from 'react';
import { AlertTriangle, Check, Clock, Loader2, Minus, X as XIcon } from 'lucide-react';
import type { Voice } from '../services/elevenLabsService';
import { ORIGINAL_LANE, VOICE_CHANGE_FLAG_SHARE, type LaneClip, type LineProgress } from '../services/voiceChangeService';

/**
 * The voice changer, line by line: who each speaker is changed into, and
 * the dub's lanes as Edit timing has them, each line showing how its change
 * went. Lines never move here; that is the point.
 */

/** What a speaker is changed into: a voice id, or KEEP for their own voice. */
export const KEEP = 'keep';

/** Each speaker's colour, in the order they first speak; the original is grey. */
const SPEAKER_TONES = [
  { avatar: 'bg-teal-500/15 text-teal-300', clip: 'bg-teal-500/20 text-teal-200' },
  { avatar: 'bg-violet-500/15 text-violet-300', clip: 'bg-violet-500/20 text-violet-200' },
  { avatar: 'bg-orange-500/15 text-orange-300', clip: 'bg-orange-500/20 text-orange-200' },
  { avatar: 'bg-sky-500/15 text-sky-300', clip: 'bg-sky-500/20 text-sky-200' },
  { avatar: 'bg-pink-500/15 text-pink-300', clip: 'bg-pink-500/20 text-pink-200' },
];
const ORIGINAL_TONE = { avatar: 'bg-slate-700/60 text-slate-300', clip: 'bg-slate-700/50 text-slate-300' };

export const toneOf = (speakers: string[], speaker: string) =>
  speaker === ORIGINAL_LANE ? ORIGINAL_TONE : SPEAKER_TONES[Math.max(0, speakers.indexOf(speaker)) % SPEAKER_TONES.length];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('') || '?';

const shortName = (name?: string) => (name || '').trim().split(/\s+[-–—|]\s+/)[0];

/** "+4.2%" for a line given back longer, "−3.0%" shorter. */
export const formatChange = (change: number) => `${change >= 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(1)}%`;

/** The speakers of a dub with several, each with the voice they're changed into. */
export const SpeakerVoiceRows: React.FC<{
  speakers: { name: string; lines: number }[];
  voices: Voice[];
  chosen: Record<string, string>;
  onChoose: (speaker: string, voiceId: string) => void;
  onBrowse: (speaker: string) => void;
  hasOriginalClips: boolean;
  disabled: boolean;
}> = ({ speakers, voices, chosen, onChoose, onBrowse, hasOriginalClips, disabled }) => {
  const names = speakers.map((s) => s.name);
  return (
    <div className="flex flex-col gap-2">
      {speakers.map((speaker) => {
        const value = chosen[speaker.name] ?? KEEP;
        const keep = value === KEEP;
        const known = keep || voices.some((v) => v.voice_id === value);
        return (
          <div
            key={speaker.name}
            className={`grid grid-cols-[34px_minmax(0,1fr)] sm:grid-cols-[34px_minmax(0,1fr)_minmax(0,13rem)_auto] gap-x-3 gap-y-2 items-center p-2.5 rounded-xl border ${
              keep ? 'border-slate-800 bg-transparent' : 'border-slate-700 bg-slate-950/60'
            }`}
          >
            <span className={`w-[34px] h-[34px] rounded-full flex items-center justify-center text-[12px] font-semibold ${toneOf(names, speaker.name).avatar}`}>
              {initials(speaker.name)}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-slate-100 truncate">{speaker.name}</span>
              <span className="block text-[11.5px] text-slate-400">
                {speaker.lines} line{speaker.lines === 1 ? '' : 's'}
                {keep ? ' · kept as is' : ''}
              </span>
            </span>
            <select
              aria-label={`Voice for ${speaker.name}`}
              value={value}
              disabled={disabled}
              onChange={(e) => onChoose(speaker.name, e.target.value)}
              className="col-span-2 sm:col-span-1 w-full h-9 bg-slate-950/60 border border-slate-700 focus:border-indigo-500 rounded-[9px] px-2.5 text-[12.5px] text-slate-100 focus:outline-none cursor-default disabled:opacity-50"
            >
              <option value={KEEP} className="bg-slate-900">Keep as is</option>
              {!known && <option value={value} className="bg-slate-900">Chosen voice</option>}
              {voices.map((v) => (
                <option key={v.voice_id} value={v.voice_id} className="bg-slate-900">
                  {shortName(v.name)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onBrowse(speaker.name)}
              className="hidden sm:block h-9 px-2.5 rounded-[9px] border border-slate-800 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 disabled:opacity-40 cursor-default"
            >
              Browse
            </button>
          </div>
        );
      })}
      {hasOriginalClips && (
        <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-3 items-center p-2.5 rounded-xl border border-dashed border-slate-800">
          <span className={`w-[34px] h-[34px] rounded-full flex items-center justify-center text-[12px] font-semibold ${ORIGINAL_TONE.avatar}`}>O</span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-slate-100">Original audio</span>
            <span className="block text-[11.5px] text-slate-400">Clips of the original on the dub keep the original voice</span>
          </span>
        </div>
      )}
    </div>
  );
};

/** Where the latest edits are: the voice changer waits for them, so it changes the dub as it is now. */
export const EditRenderChip: React.FC<{ state: 'ready' | 'pending' | 'rendering' | 'error' }> = ({ state }) =>
  state === 'ready' ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 text-[11.5px] whitespace-nowrap">
      <Check className="w-3.5 h-3.5" /> Latest edits ready
    </span>
  ) : state === 'error' ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-300 text-[11.5px] whitespace-nowrap">
      <AlertTriangle className="w-3.5 h-3.5" /> Edits didn't render: retry in Edit timing
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300 text-[11.5px] whitespace-nowrap">
      <Clock className="w-3.5 h-3.5" /> Rendering your latest edits…
    </span>
  );

/** The dub's lanes, one per speaker, each line where Edit timing has it and how its change went. */
export const LineLanes: React.FC<{
  speakers: string[];
  clips: LaneClip[];
  duration: number;
  progress: Record<string, LineProgress>;
  changing: (speaker: string) => boolean;
}> = ({ speakers, clips, duration, progress, changing }) => {
  const lanes = [...speakers, ...(clips.some((c) => c.speaker === ORIGINAL_LANE) ? [ORIGINAL_LANE] : [])];
  const end = Math.max(duration, ...clips.map((c) => c.end), 1);
  const numbers = new Map(clips.filter((c) => c.speaker !== ORIGINAL_LANE).map((c, n) => [c.key, n + 1]));
  const marks = [0, end / 2, end].map((t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`);
  return (
    <div className="flex flex-col gap-1.5">
      {lanes.map((speaker) => {
        const tone = toneOf(speakers, speaker);
        const kept = speaker !== ORIGINAL_LANE && !changing(speaker);
        return (
          <div key={speaker} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 items-center">
            <span className="text-[11px] text-slate-400 truncate" title={speaker}>
              {speaker === ORIGINAL_LANE ? 'Original' : speaker}
            </span>
            <div className="relative h-[26px] rounded-md bg-slate-900 border border-slate-800 overflow-hidden">
              {clips
                .filter((c) => c.speaker === speaker)
                .map((clip) => {
                  const state = progress[clip.key]?.state;
                  const look =
                    state === 'done'
                      ? 'bg-emerald-500/25 text-emerald-200'
                      : state === 'flag'
                        ? 'bg-amber-500/25 text-amber-200'
                        : state === 'error'
                          ? 'bg-rose-500/25 text-rose-200'
                          : kept
                            ? 'bg-slate-800 text-slate-500'
                            : tone.clip;
                  return (
                    <span
                      key={clip.key}
                      title={numbers.has(clip.key) ? `Line ${numbers.get(clip.key)}` : 'Original audio'}
                      className={`absolute top-[3px] h-[18px] rounded-[4px] px-1 flex items-center gap-0.5 text-[10px] font-medium overflow-hidden whitespace-nowrap transition-colors ${look} ${
                        state === 'changing' ? 'ring-1 ring-indigo-400 animate-pulse' : ''
                      }`}
                      style={{ left: `${(clip.start / end) * 100}%`, width: `max(3px, ${((clip.end - clip.start) / end) * 100}%)` }}
                    >
                      {state === 'done' && <Check className="w-2.5 h-2.5 shrink-0" />}
                      {state === 'flag' && <AlertTriangle className="w-2.5 h-2.5 shrink-0" />}
                      {numbers.has(clip.key) ? numbers.get(clip.key) : ''}
                    </span>
                  );
                })}
            </div>
          </div>
        );
      })}
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
        <span />
        <span className="flex justify-between text-[10px] text-slate-500 font-mono tabular-nums">
          {marks.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </span>
      </div>
    </div>
  );
};

/** How the run went: a bar, three counts, and the lines to check. */
export const LineRunSummary: React.FC<{
  keys: string[];
  clips: LaneClip[];
  progress: Record<string, LineProgress>;
  running: boolean;
}> = ({ keys, clips, progress, running }) => {
  const numbers = new Map(clips.filter((c) => c.speaker !== ORIGINAL_LANE).map((c, n) => [c.key, { n: n + 1, speaker: c.speaker }]));
  const states = keys.map((key) => progress[key]?.state ?? 'waiting');
  const finished = states.filter((s) => s !== 'waiting' && s !== 'changing').length;
  const fitted = states.filter((s) => s === 'done').length;
  const flagged = keys.filter((key) => progress[key]?.state === 'flag');
  const silent = states.filter((s) => s === 'silent').length;
  const pct = keys.length ? Math.round((finished / keys.length) * 100) : 0;
  return (
    <div className="flex flex-col gap-2.5" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-[12.5px] text-slate-300">
        {running ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" /> : <Check className="w-3.5 h-3.5 text-emerald-400" />}
        {running ? `Changing line ${Math.min(finished + 1, keys.length)} of ${keys.length}…` : `${fitted + flagged.length} of ${keys.length} lines changed, each where it was`}
      </div>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full rounded-full bg-indigo-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Changed', value: `${fitted + flagged.length}/${keys.length}`, tone: 'text-slate-100' },
          { label: 'Fitted in place', value: String(fitted), tone: 'text-emerald-300' },
          { label: 'To check', value: String(flagged.length), tone: flagged.length ? 'text-amber-300' : 'text-slate-100' },
        ].map((m) => (
          <div key={m.label} className="rounded-[10px] bg-slate-900 border border-slate-800 px-2.5 py-2">
            <span className={`block text-[17px] font-semibold tabular-nums ${m.tone}`}>{m.value}</span>
            <span className="block text-[11px] text-slate-400">{m.label}</span>
          </div>
        ))}
      </div>
      {flagged.map((key) => {
        const line = numbers.get(key);
        const change = progress[key]?.change ?? 0;
        return (
          <div key={key} className="flex items-start gap-2 px-2.5 py-2 rounded-[10px] bg-amber-500/10 border border-amber-500/25 text-[12px] text-amber-100">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-px" />
            <span className="min-w-0">
              Line {line?.n ?? '?'}
              {line ? ` · ${line.speaker}` : ''}: came back {formatChange(change)} {change >= 0 ? 'longer' : 'shorter'}, fitted all the same.{' '}
              <span className="text-amber-200/80">Listen to it; the old voice is in its takes.</span>
            </span>
          </div>
        );
      })}
      {silent > 0 && (
        <div className="flex items-start gap-2 px-2.5 py-2 rounded-[10px] bg-slate-900 border border-slate-800 text-[12px] text-slate-300">
          <Minus className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-px" />
          {silent} line{silent === 1 ? '' : 's'} came back silent and kept the old voice.
        </div>
      )}
      {!running && states.includes('error') && (
        <div className="flex items-start gap-2 px-2.5 py-2 rounded-[10px] bg-rose-500/10 border border-rose-500/25 text-[12px] text-rose-100">
          <XIcon className="w-3.5 h-3.5 text-rose-300 shrink-0 mt-px" />
          Some lines weren't changed. Those changed are in the dub; run it again for the rest.
        </div>
      )}
    </div>
  );
};

export { VOICE_CHANGE_FLAG_SHARE };

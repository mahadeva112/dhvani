import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Play, RotateCcw, Trash2 } from 'lucide-react';
import type { SpeakerGender, SpeakerOwnSettings, SpeakerProfile, SpeakerVoice } from '../types';
import { applySavedCast, castEntries, deleteSavedCast, loadSavedCasts, saveCast, type SavedCast } from '../services/savedCasts';

/**
 * The Cast's speaker card (Mock B): opens under the picked speaker's row with
 * their original voice to hear, who they are for the translation, and voice
 * settings of their own. A setting left alone is the main voice's.
 */

export interface OwnSettingControl {
  key: keyof SpeakerOwnSettings;
  label: string;
  /** The main voice's value, used while the speaker has none of their own. */
  main: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  /** Why the setting does nothing on this model, when it does nothing. */
  ignored?: string;
}

const GENDERS: { id: SpeakerGender; label: string }[] = [
  { id: 'man', label: 'Man' },
  { id: 'woman', label: 'Woman' },
];

export const genderShort = (gender?: SpeakerGender) => (gender === 'woman' ? 'Woman' : gender === 'man' ? 'Man' : '');

export const SpeakerCastCard: React.FC<{
  speaker: string;
  profile?: SpeakerProfile;
  /** Whether the dub language shows a speaker's gender in their words (speakerGenderMatters). */
  showGender: boolean;
  targetLanguage: string;
  controls: OwnSettingControl[];
  onHear?: () => void;
  onChange: (patch: Partial<SpeakerProfile> | null) => void;
}> = ({ speaker, profile, showGender, targetLanguage, controls, onHear, onChange }) => {
  const hasOwn = controls.some((c) => profile?.[c.key] !== undefined);
  return (
    <div className="mx-1 mb-1.5 mt-0.5 rounded-xl border border-edge bg-slate-950/70 px-3 py-2.5 flex flex-col gap-2.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 flex-wrap">
        {onHear && (
          <button
            type="button"
            onClick={onHear}
            title={`Play ${speaker}'s longest line in the original`}
            className="h-7 px-2.5 rounded-lg border border-edge text-[11.5px] text-slate-200 hover:bg-slate-800 flex items-center gap-1.5 cursor-default"
          >
            <Play className="w-3 h-3 fill-current" /> Hear in the original
          </button>
        )}
        {showGender && (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-slate-500">Speaks as</span>
            <span role="radiogroup" aria-label={`${speaker} speaks as`} className="flex bg-slate-950 border border-edge rounded-lg p-0.5 gap-0.5">
              {GENDERS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  role="radio"
                  aria-checked={profile?.gender === g.id}
                  onClick={() => onChange({ gender: profile?.gender === g.id ? undefined : g.id })}
                  title={
                    profile?.gender === g.id
                      ? 'Click again to clear'
                      : `The ${targetLanguage} translation and Grammar check say ${speaker}'s words about themself as a ${g.label.toLowerCase()}`
                  }
                  className={`h-6 px-2 rounded-md text-[11.5px] font-medium cursor-default transition-colors ${
                    profile?.gender === g.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </span>
          </span>
        )}
      </div>
      {showGender && !profile?.gender && (
        <p className="text-[11px] text-slate-500 leading-snug -mt-1">
          In {targetLanguage} a speaker's "I" shows if they are a man or a woman. Set it before you translate.
        </p>
      )}

      {controls.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">{speaker}'s own settings</span>
          {controls.map((c) => {
            const own = profile?.[c.key];
            const value = own ?? c.main;
            return (
              <div key={c.key} className="flex items-center gap-2.5" title={c.ignored || (own === undefined ? `The main voice's ${c.label.toLowerCase()}` : undefined)}>
                <span className="w-[68px] shrink-0 flex items-center gap-1.5 text-[11.5px] text-slate-400">
                  {c.label}
                  {own !== undefined && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-label="Own setting" />}
                </span>
                <input
                  type="range"
                  min={c.min}
                  max={c.max}
                  step={c.step}
                  value={value}
                  disabled={Boolean(c.ignored)}
                  onChange={(e) => onChange({ [c.key]: Number(e.target.value) })}
                  aria-label={`${speaker}'s ${c.label.toLowerCase()}`}
                  className="flex-1 min-w-0 accent-indigo-500 disabled:opacity-40"
                />
                <span className={`w-11 shrink-0 text-right font-mono text-[11px] tabular-nums ${own !== undefined ? 'text-amber-300' : 'text-slate-500'}`}>
                  {c.format(value)}
                </span>
              </div>
            );
          })}
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-[11px] text-slate-500 leading-snug">{hasOwn ? 'From the next Dub & sync.' : 'Same as the main voice.'}</span>
            {hasOwn && (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="ml-auto h-6 px-2 rounded-md border border-edge text-[11px] text-slate-300 hover:bg-slate-800 flex items-center gap-1 cursor-default"
              >
                <RotateCcw className="w-3 h-3" /> Reset to main voice
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * The Cast header's saved-cast menu: put a saved cast on the speakers of the
 * same name, or save this one for the next project with the same people.
 */
export const SavedCastMenu: React.FC<{
  speakers: string[];
  cast?: Record<string, SpeakerVoice>;
  profiles?: Record<string, SpeakerProfile>;
  onApply: (next: { cast: Record<string, SpeakerVoice>; speakerProfiles: Record<string, SpeakerProfile> }) => void;
}> = ({ speakers, cast, profiles, onApply }) => {
  const [open, setOpen] = useState(false);
  const [casts, setCasts] = useState<SavedCast[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setCasts(loadSavedCasts());
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 5000);
    return () => window.clearTimeout(t);
  }, [note]);

  const entries = castEntries(speakers, cast, profiles);
  const canSave = Object.keys(entries).length > 0;

  const save = () => {
    if (!name.trim() || !canSave) return;
    setCasts(saveCast(name, entries));
    setNote(`Saved "${name.trim()}"`);
    setNaming(false);
    setName('');
    setOpen(false);
  };

  const apply = (saved: SavedCast) => {
    const next = applySavedCast(saved, speakers, cast, profiles);
    setOpen(false);
    if (next.matched === 0) {
      setNote(`No speaker here is named as in "${saved.name}". Rename the speakers first.`);
      return;
    }
    onApply({ cast: next.cast, speakerProfiles: next.speakerProfiles });
    setNote(`"${saved.name}": ${next.matched} of ${speakers.length} speakers`);
  };

  return (
    <div ref={box} className="relative flex items-center gap-2 min-w-0">
      {note && <span className="text-[10.5px] text-slate-400 truncate">{note}</span>}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Use a saved cast, or save this one for the next project with the same people"
        className="shrink-0 h-6 px-2 rounded-md border border-edge text-[11px] text-slate-300 hover:bg-slate-800 flex items-center gap-1 cursor-default"
      >
        Saved casts <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-30 w-64 rounded-xl border border-edge bg-slate-950 shadow-2xl p-1 flex flex-col">
          {casts.length === 0 ? (
            <p className="px-2.5 py-2 text-[11.5px] text-slate-500">No saved casts yet.</p>
          ) : (
            casts.map((c) => (
              <div key={c.name} className="group flex items-center rounded-lg hover:bg-slate-800">
                <button type="button" onClick={() => apply(c)} className="flex-1 min-w-0 text-left px-2.5 py-1.5 cursor-default">
                  <span className="block truncate text-[12.5px] text-slate-100">{c.name}</span>
                  <span className="block truncate text-[10.5px] text-slate-500">{Object.keys(c.speakers).join(', ')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCasts(deleteSavedCast(c.name))}
                  title={`Remove "${c.name}"`}
                  aria-label={`Remove saved cast ${c.name}`}
                  className="mr-1 p-1 rounded-md text-slate-600 opacity-0 group-hover:opacity-100 hover:text-rose-300 cursor-default"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
          <div className="border-t border-edge mt-1 pt-1">
            {naming ? (
              <form
                className="flex items-center gap-1 px-1 py-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  save();
                }}
              >
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
                  placeholder="Name, e.g. Weekly Panel"
                  maxLength={60}
                  className="flex-1 min-w-0 h-7 rounded-md bg-slate-900 border border-edge px-2 text-[12px] text-slate-100 focus:outline-none focus:border-indigo-500"
                />
                <button type="submit" disabled={!name.trim()} aria-label="Save cast" className="h-7 w-7 rounded-md bg-indigo-500 text-white flex items-center justify-center disabled:opacity-40 cursor-default">
                  <Check className="w-3.5 h-3.5" />
                </button>
              </form>
            ) : (
              <button
                type="button"
                disabled={!canSave}
                onClick={() => setNaming(true)}
                title={canSave ? 'Keep these voices, genders and settings by speaker name' : 'Give a speaker a voice or a gender first'}
                className="w-full text-left px-2.5 py-1.5 rounded-lg text-[12.5px] text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent cursor-default"
              >
                Save this cast…
              </button>
            )}
            <p className="px-2.5 pb-1.5 pt-0.5 text-[10.5px] text-slate-500 leading-snug">A saved cast goes on speakers with the same name. Nothing changes until you pick one.</p>
          </div>
        </div>
      )}
    </div>
  );
};

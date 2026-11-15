import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Play, Square } from 'lucide-react';
import { synthesizeSamplePreview, type ElevenLabsVoiceSettings } from '../services/elevenLabsService';
import type { CartesiaVoicePrefs } from '../services/cartesiaService';
import { reportError } from '../services/errorPopup';

/**
 * Reads made here, by voice, model, settings and text, so playing the same
 * line again is free. Kept until the app closes.
 */
const reads = new Map<string, string>();
const READS_KEPT = 30;

export interface VoiceTryLineProps {
  apiKey: string;
  voiceId: string;
  modelId?: string;
  voiceSettings?: ElevenLabsVoiceSettings | null;
  cartesia?: CartesiaVoicePrefs;
  /** What the voice reads. */
  text: string;
  /** The card's title, e.g. "Hear Rachel on your script". */
  title: string;
  /** Names what is read, e.g. "Line 1" or "Sample". */
  label: string;
}

/**
 * The picked voice reading one line of the dub, so it can be heard on the
 * user's own words before anything is dubbed. One short read on a click;
 * nothing is read on its own.
 */
export const VoiceTryLine: React.FC<VoiceTryLineProps> = ({ apiKey, voiceId, modelId, voiceSettings, cartesia, text, title, label }) => {
  const [state, setState] = useState<'idle' | 'reading' | 'playing'>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const key = JSON.stringify([voiceId, modelId || '', voiceSettings || null, cartesia || null, text]);
  const readBefore = reads.has(key);

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setState('idle');
  };

  // A new voice or line stops the old one.
  useEffect(() => stop, [key]);

  const play = async () => {
    if (state === 'playing') return stop();
    if (state === 'reading') return;
    try {
      let url = reads.get(key);
      if (!url) {
        setState('reading');
        const blob = await synthesizeSamplePreview(apiKey, voiceId, text, modelId, voiceSettings ?? null, cartesia);
        url = URL.createObjectURL(blob);
        reads.set(key, url);
        for (const old of [...reads.keys()].slice(0, Math.max(0, reads.size - READS_KEPT))) {
          URL.revokeObjectURL(reads.get(old)!);
          reads.delete(old);
        }
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        if (audioRef.current === audio) stop();
      };
      setState('playing');
      await audio.play();
    } catch (e) {
      setState('idle');
      reportError(e, { title: 'The voice could not read the line' });
    }
  };

  return (
    <div className="p-3 rounded-xl border border-edge bg-slate-950/40">
      <div className="text-[11px] text-slate-400">{title}</div>
      <p className="mt-1.5 text-[12.5px] text-slate-200 leading-snug line-clamp-2" title={text}>
        “{text}”
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={play}
          disabled={!apiKey && !readBefore}
          className="h-7 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-[12px] font-medium text-slate-100 flex items-center gap-1.5 cursor-default"
          title={state === 'playing' ? 'Stop' : `Hear the voice read ${label.toLowerCase()}`}
        >
          {state === 'reading' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : state === 'playing' ? (
            <Square className="w-3 h-3 fill-current" />
          ) : (
            <Play className="w-3 h-3 fill-current" />
          )}
          {label}
        </button>
        <span className="text-[11px] text-slate-500">
          {state === 'reading' ? 'Reading…' : readBefore ? 'Plays again free' : 'Uses a few credits'}
        </span>
      </div>
    </div>
  );
};

import React, { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileJson, FolderOpen, Loader2 } from 'lucide-react';
import { CenteredPanel } from './CenteredPanel';
import type { ProjectJsonData, SourceMedia } from '../services/projectArchive';
import { hasTranscript } from '../services/steps';

/** The audio's length may differ by this much from the one transcribed and still be the same file. */
const SAME_LENGTH_SECONDS = 0.5;

const formatLength = (seconds: number) => {
  const t = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

export interface PendingProjectJson {
  fileName: string;
  project: ProjectJsonData;
  sourceMedia: SourceMedia;
}

interface OpenProjectJsonPanelProps {
  pending: PendingProjectJson | null;
  /** Reads the picked media and gives its length in seconds; throws when it can't be read. */
  measure: (file: File) => Promise<number>;
  /** Makes the project with this media. */
  onOpen: (file: File) => Promise<void>;
  onCancel: () => void;
}

/**
 * Opening a Dhvani JSON project: the file holds the transcript and the work
 * on it, not the audio, so the user picks the original again. Its length is
 * checked against the one the transcript was timed on.
 */
export const OpenProjectJsonPanel: React.FC<OpenProjectJsonPanelProps> = ({ pending, measure, onOpen, onCancel }) => {
  const [media, setMedia] = useState<{ file: File; length: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<'reading' | 'opening' | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const close = () => {
    if (working === 'opening') return;
    setMedia(null);
    setError(null);
    onCancel();
  };

  if (!pending) return null;

  const { project, sourceMedia } = pending;
  const segments = project.segments || [];
  const translated = project.targetSource !== 'pending' && segments.some((s) => (s.textTarget || s.targetText || '').trim());
  const name = project.name?.trim() || sourceMedia.name.replace(/\.[^.]+$/, '') || pending.fileName.replace(/\.dhvani\.json$|\.json$/i, '');
  const expected = sourceMedia.duration;
  const lengthOff = media && expected ? Math.abs(media.length - expected) > SAME_LENGTH_SECONDS : false;

  const pick = async (file: File) => {
    setError(null);
    setMedia(null);
    setWorking('reading');
    try {
      setMedia({ file, length: await measure(file) });
    } catch (err: any) {
      setError(`That file couldn't be read as audio or video${err?.message ? ` (${String(err.message).replace(/\.$/, '')})` : ''}. Choose the original media.`);
    } finally {
      setWorking(null);
    }
  };

  const open = async () => {
    if (!media) return;
    setWorking('opening');
    try {
      await onOpen(media.file);
      setMedia(null);
    } catch (err: any) {
      setError(err?.message || 'The project could not be opened.');
    } finally {
      setWorking(null);
    }
  };

  return (
    <CenteredPanel open onClose={close} label={`Open ${name}`} className="max-w-[27rem] p-5 gap-3">
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0">
          <FileJson className="w-4 h-4 text-indigo-300" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-slate-100 truncate">Open “{name}”</div>
          <div className="text-[11.5px] text-slate-400 truncate">{pending.fileName}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
          <div className="font-mono text-[15px] font-semibold text-slate-100 tabular-nums">{segments.length}</div>
          <div className="text-[10.5px] text-slate-500">{segments.length === 1 ? 'segment' : 'segments'}</div>
        </div>
        <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
          <div className="font-mono text-[15px] font-semibold text-slate-100 tabular-nums">{expected ? formatLength(expected) : '—'}</div>
          <div className="text-[10.5px] text-slate-500">long</div>
        </div>
        <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
          <div className="text-[13px] font-semibold text-slate-100 mt-0.5 truncate">{project.detectedLanguage || project.sourceLanguage || 'Transcript'}</div>
          <div className="text-[10.5px] text-slate-500">{translated ? `translated to ${project.language}` : 'not translated'}</div>
        </div>
      </div>

      <p className="text-[12px] text-slate-300 leading-relaxed">
        This file holds the transcript, not the audio. Choose{' '}
        {sourceMedia.name ? <span className="font-mono text-[11.5px] px-1 py-px rounded bg-slate-800">{sourceMedia.name}</span> : 'the original audio or video'} to
        finish opening it. It opens as a new project{hasTranscript(segments) ? ', on Review' : ''}.
      </p>

      <input
        ref={input}
        type="file"
        accept="audio/*,video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void pick(file);
        }}
      />

      {working === 'reading' && (
        <div role="status" className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-800 text-[11.5px] text-slate-300">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          Reading the media…
        </div>
      )}
      {media && !lengthOff && (
        <div role="status" className="flex items-center gap-2 p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] text-[11.5px] text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {media.file.name} · {formatLength(media.length)}
            {expected ? ' · same length as when it was transcribed' : ''}
          </span>
        </div>
      )}
      {media && lengthOff && (
        <div role="alert" className="flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] text-[11.5px] text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
          <span>
            {media.file.name} is {formatLength(media.length)}, but the transcript was timed on {formatLength(expected!)} of media. The segments
            won't line up with it. Choose the original, or open it anyway.
          </span>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[11.5px] text-rose-300">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <button type="button" onClick={close} className="h-9 px-3 rounded-lg text-[12.5px] text-slate-300 hover:bg-slate-800 cursor-default">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={working !== null}
          className={`h-9 px-3 flex items-center gap-1.5 rounded-lg text-[12.5px] cursor-default disabled:opacity-50 ${
            media ? 'border border-slate-700 hover:bg-slate-800 text-slate-200' : 'bg-indigo-600 hover:bg-indigo-500 text-white font-semibold'
          }`}
        >
          <FolderOpen className="w-4 h-4" aria-hidden="true" />
          {media ? 'Choose another' : 'Choose audio'}
        </button>
        {media && (
          <button
            type="button"
            onClick={() => void open()}
            disabled={working !== null}
            className="h-9 px-3.5 flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[12.5px] font-semibold text-white cursor-default disabled:opacity-60"
          >
            {working === 'opening' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {lengthOff ? 'Open anyway' : 'Open project'}
          </button>
        )}
      </div>
    </CenteredPanel>
  );
};

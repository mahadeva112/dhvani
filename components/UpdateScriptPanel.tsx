import React from 'react';
import { AlertTriangle, FileJson } from 'lucide-react';
import { CenteredPanel } from './CenteredPanel';
import type { AudioSegment } from '../types';

export interface ScriptUpdatePreview {
  fileName: string;
  /** The project the script goes on. */
  projectName: string;
  /** Cues the script changed, added and removed. */
  changed: number;
  added: number;
  removed: number;
  /** Cues changed here only, kept. */
  keptHere: number;
  /** Cues changed on both sides (the script's used), and script changes to cues joined away here (not used). */
  conflicts: AudioSegment[];
  notApplied: AudioSegment[];
  /** Synced lines the next Sync voices again. */
  linesToVoice: number;
  hasDub: boolean;
  noBase: boolean;
  transcribedAgain: boolean;
  /** The media's length here and the one the script was timed on, when they differ. */
  lengthOff: { here: number; script: number } | null;
  /** Why the update can't be put on, when it can't. */
  problem: string | null;
}

interface UpdateScriptPanelProps {
  preview: ScriptUpdatePreview | null;
  onUpdate: () => void;
  /** Opens the file as a new project instead. */
  onOpenAsNew: () => void;
  onCancel: () => void;
}

const formatLength = (seconds: number) => {
  const t = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(t / 60);
  return `${m}:${String(t % 60).padStart(2, '0')}`;
};

const lineText = (s: AudioSegment) => (s.textTarget || s.targetText || s.textSource || s.originalText || '').trim();

const Count: React.FC<{ value: number; label: string }> = ({ value, label }) => (
  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
    <div className="font-mono text-[15px] font-semibold text-slate-100 tabular-nums">{value}</div>
    <div className="text-[10.5px] text-slate-500">{label}</div>
  </div>
);

const CueList: React.FC<{ cues: AudioSegment[] }> = ({ cues }) => (
  <ul className="mt-1 space-y-0.5">
    {cues.slice(0, 4).map((s) => (
      <li key={String(s.id)} className="truncate text-slate-300">
        <span className="font-mono text-slate-500">{formatLength(s.startTime)}</span> {lineText(s) || '(empty)'}
      </li>
    ))}
    {cues.length > 4 && <li className="text-slate-500">and {cues.length - 4} more</li>}
  </ul>
);

/**
 * Update script: a newer Dhvani JSON put on a project being dubbed. The
 * script's changes replace the cues they touch; everything else here stays,
 * and only the touched lines are voiced again, on the next Sync.
 */
export const UpdateScriptPanel: React.FC<UpdateScriptPanelProps> = ({ preview, onUpdate, onOpenAsNew, onCancel }) => {
  if (!preview) return null;
  const p = preview;
  const scriptChanges = p.changed + p.added + p.removed;

  return (
    <CenteredPanel open onClose={onCancel} label={`Update script of ${p.projectName}`} className="max-w-[29rem] p-5 gap-3">
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0">
          <FileJson className="w-4 h-4 text-indigo-300" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-slate-100 truncate">Update script of “{p.projectName}”</div>
          <div className="text-[11.5px] text-slate-400 truncate">{p.fileName}</div>
        </div>
      </div>

      {p.problem ? (
        <div role="alert" className="flex items-start gap-2 p-2.5 rounded-lg border border-rose-500/30 bg-rose-500/[0.07] text-[11.5px] text-rose-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
          <span>{p.problem}</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Count value={scriptChanges} label={scriptChanges === 1 ? 'cue from the script' : 'cues from the script'} />
            <Count value={p.keptHere} label="kept from here" />
            <Count value={p.hasDub ? p.linesToVoice : 0} label={p.hasDub ? 'lines voiced again' : 'no dub yet'} />
          </div>

          <p className="text-[12px] text-slate-300 leading-relaxed">
            {scriptChanges === 0
              ? 'The script has no changes for this project.'
              : `The script's wording and timing replace the cues it changed${p.added || p.removed ? ` (${p.added} new, ${p.removed} gone)` : ''}. Every other cue, take and timing edit stays as it is.`}{' '}
            {p.hasDub && p.linesToVoice > 0 && 'The changed lines are voiced again on the next Sync; nothing is voiced now.'} You can undo it in Review.
          </p>

          {p.noBase && (
            <p className="text-[11.5px] text-slate-400 leading-relaxed">
              This project has no record of an earlier script file, so the file's version of every cue is used, including any you changed here.
            </p>
          )}
          {p.transcribedAgain && (
            <div role="alert" className="flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] text-[11.5px] text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
              <span>Most cues no longer line up: this script looks transcribed again. Almost every dubbed line would be voiced again.</span>
            </div>
          )}
          {p.lengthOff && (
            <div role="alert" className="flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] text-[11.5px] text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
              <span>
                The script was timed on {formatLength(p.lengthOff.script)} of media, but this project's is {formatLength(p.lengthOff.here)}. Its cues may not line up.
              </span>
            </div>
          )}
          {p.conflicts.length > 0 && (
            <div className="p-2.5 rounded-lg border border-slate-800 text-[11.5px] text-slate-400">
              Changed here and in the script; the script's version is used:
              <CueList cues={p.conflicts} />
            </div>
          )}
          {p.notApplied.length > 0 && (
            <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] text-[11.5px] text-amber-200/90">
              The script changed {p.notApplied.length === 1 ? 'a cue' : 'cues'} you joined into another here. They stay as here; check them by hand:
              <CueList cues={p.notApplied} />
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="h-9 px-3 rounded-lg text-[12.5px] text-slate-300 hover:bg-slate-800 cursor-default">
          Cancel
        </button>
        <button
          type="button"
          onClick={onOpenAsNew}
          className="h-9 px-3 rounded-lg border border-slate-700 hover:bg-slate-800 text-[12.5px] text-slate-200 cursor-default"
        >
          Open as new project
        </button>
        {!p.problem && (
          <button
            type="button"
            onClick={onUpdate}
            disabled={scriptChanges === 0}
            className="h-9 px-3.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[12.5px] font-semibold text-white cursor-default disabled:opacity-50"
          >
            Update script
          </button>
        )}
      </div>
    </CenteredPanel>
  );
};

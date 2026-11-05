import React from 'react';
import { RotateCcw } from 'lucide-react';
import { CenteredPanel } from './CenteredPanel';

export interface SyncFromScratchState {
  /** Cues in the script, and their characters: what voicing every line again costs. */
  lines: number;
  characters: number;
  /** Lines with hand edits or locks in Edit timing (clips of the original aside). */
  edited: number;
  /** Lines playing a take picked in the T window. */
  picked: number;
  /** Lines moved or cut on Review's dub lane. */
  placed: number;
  /** Lines retaken, or with a take chosen in Review. */
  retakes: number;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Before Sync from scratch: what it drops, and that every line is voiced
 * again. Sync again keeps all of this; this starts the dub over from the
 * script with the settings as they are now.
 */
export const SyncFromScratchConfirm: React.FC<{
  confirm: SyncFromScratchState | null;
  onSync: () => void;
  onCancel: () => void;
}> = ({ confirm, onSync, onCancel }) => {
  if (!confirm) return null;
  const drops = [
    confirm.edited > 0 && `Hand edits and locks in Edit timing on ${count(confirm.edited, 'line', 'lines')}`,
    confirm.picked > 0 && `Takes picked in the T window on ${count(confirm.picked, 'line', 'lines')}`,
    confirm.placed > 0 && `Places on Review’s dub lane for ${count(confirm.placed, 'line', 'lines')}`,
    confirm.retakes > 0 && `Retakes and chosen takes on ${count(confirm.retakes, 'line', 'lines')}`,
  ].filter((item): item is string => Boolean(item));

  return (
    <CenteredPanel open onClose={onCancel} label="Sync from scratch" className="max-w-[29rem] p-5 gap-3">
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-lg bg-slate-950 border border-rose-500/40 flex items-center justify-center shrink-0">
          <RotateCcw className="w-4 h-4 text-rose-300" aria-hidden="true" />
        </span>
        <div className="text-[14px] font-semibold text-slate-100">Sync from scratch</div>
      </div>

      <p className="text-[12px] text-slate-300 leading-relaxed">
        Every line is voiced again with new takes and placed by Sync itself, with the settings as they are now. Sync again keeps what was
        voiced before; this doesn’t. The script, translation, voices and settings stay as they are.
      </p>

      {drops.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-[11.5px] text-slate-400">These go:</span>
          <ul className="flex flex-col gap-1 text-[12px]">
            {drops.map((item) => (
              <li key={item} className="rounded-md bg-slate-950/70 border border-slate-800 px-2.5 py-1.5 text-slate-300">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-[11.5px] text-amber-300/90 leading-relaxed">
        Voices {count(confirm.lines, 'line', 'lines')} again: about {confirm.characters.toLocaleString()} characters on your voice plan.
      </p>

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <button type="button" autoFocus onClick={onCancel} className="h-9 px-3 rounded-lg text-[12.5px] text-slate-300 hover:bg-slate-800 cursor-default">
          Cancel
        </button>
        <button
          type="button"
          onClick={onSync}
          className="h-9 px-3.5 flex items-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-[12.5px] font-semibold text-white cursor-default"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Sync from scratch
        </button>
      </div>
    </CenteredPanel>
  );
};

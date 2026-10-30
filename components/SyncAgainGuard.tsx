import React from 'react';
import { Lock } from 'lucide-react';
import { CenteredPanel } from './CenteredPanel';
import type { UnlockedEdit } from '../services/syncAgainGuard';

/** Lines listed by name; the rest are counted. */
const SHOWN = 6;

export interface SyncAgainGuardState {
  /** Unlocked lines with hand edits or a take picked in the T window, each with its number in the script. */
  lines: (UnlockedEdit & { number: number })[];
  /** Edited or picked lines voiced again anyway, whose edits and take go whatever is picked. */
  voicedAgain: number;
}

/**
 * Before Sync again: the unlocked lines it would place itself, with the hand
 * edits that would go and the T window takes it would move. Locking keeps
 * them where they are; Sync anyway places them, as Sync always has; Cancel
 * leaves everything.
 */
export const SyncAgainGuard: React.FC<{
  guard: SyncAgainGuardState | null;
  onLockAndSync: () => void;
  onSyncAnyway: () => void;
  onCancel: () => void;
}> = ({ guard, onLockAndSync, onSyncAnyway, onCancel }) => {
  if (!guard) return null;
  const n = guard.lines.length;
  const one = n === 1;

  return (
    <CenteredPanel open onClose={onCancel} label="Sync again" className="max-w-[29rem] p-5 gap-3">
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-lg bg-slate-950 border border-amber-500/40 flex items-center justify-center shrink-0">
          <Lock className="w-4 h-4 text-amber-300" aria-hidden="true" />
        </span>
        <div className="text-[14px] font-semibold text-slate-100">
          {one ? '1 line isn’t locked' : `${n} lines aren’t locked`}
        </div>
      </div>

      <p className="text-[12px] text-slate-300 leading-relaxed">
        Sync again places unlocked lines itself: timing edits go, and a take picked in the T window stays but can move. Lock {one ? 'it' : 'them'} to
        keep {one ? 'it' : 'them'} where {one ? 'it is' : 'they are'}, with the same take. A locked line doesn’t make room if the line before it gets
        longer. You can unlock a line in Edit timing any time.
      </p>

      <ul className="flex flex-col gap-1 text-[12px]">
        {guard.lines.slice(0, SHOWN).map((line) => (
          <li key={line.key} className="flex items-baseline gap-2.5 rounded-md bg-slate-950/70 border border-slate-800 px-2.5 py-1.5">
            <span className="font-mono text-[11.5px] text-indigo-300 tabular-nums shrink-0">{String(line.number).padStart(2, '0')}</span>
            <span className="text-slate-300 min-w-0">{line.changes.join(' · ')}</span>
          </li>
        ))}
        {n > SHOWN && <li className="px-2.5 text-slate-500">and {n - SHOWN} more</li>}
      </ul>

      {guard.voicedAgain > 0 && (
        <p className="text-[11.5px] text-slate-400 leading-relaxed">
          {guard.voicedAgain === 1 ? '1 other edited line is' : `${guard.voicedAgain} other edited lines are`} voiced again with new words or a new take, so{' '}
          {guard.voicedAgain === 1 ? 'its edits and take go' : 'their edits and takes go'} either way.
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="h-9 px-3 rounded-lg text-[12.5px] text-slate-300 hover:bg-slate-800 cursor-default">
          Cancel
        </button>
        <button
          type="button"
          onClick={onSyncAnyway}
          className="h-9 px-3 rounded-lg border border-rose-500/40 hover:bg-rose-500/10 text-[12.5px] text-rose-200 cursor-default"
        >
          Sync anyway
        </button>
        <button
          type="button"
          autoFocus
          onClick={onLockAndSync}
          className="h-9 px-3.5 flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[12.5px] font-semibold text-white cursor-default"
        >
          <Lock className="w-3.5 h-3.5" aria-hidden="true" /> {one ? 'Lock it and Sync' : `Lock ${n} and Sync`}
        </button>
      </div>
    </CenteredPanel>
  );
};

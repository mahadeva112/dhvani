import React from 'react';
import { Check, X } from 'lucide-react';

interface ProjectNameFieldProps {
  initial: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}

/** Renames a project in place: Enter or the tick saves, Escape or the cross leaves the name as it was. */
export const ProjectNameField: React.FC<ProjectNameFieldProps> = ({ initial, onSave, onCancel }) => {
  const [value, setValue] = React.useState(initial);
  const save = () => {
    const name = value.trim();
    if (name && name !== initial) onSave(name);
    else onCancel();
  };

  return (
    <span className="flex items-center gap-1 min-w-0">
      <input
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Kept here, so Escape doesn't also close the menu or window around it.
          e.stopPropagation();
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') onCancel();
        }}
        onClick={(e) => e.stopPropagation()}
        maxLength={120}
        aria-label="Project name"
        className="min-w-0 flex-1 h-7 px-2 rounded-md bg-slate-950 border border-indigo-500 text-[13px] text-slate-100 outline-none"
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          save();
        }}
        aria-label="Save name"
        className="w-7 h-7 flex items-center justify-center rounded-md text-emerald-300 hover:bg-slate-800 cursor-pointer shrink-0"
      >
        <Check className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCancel();
        }}
        aria-label="Keep the old name"
        className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 cursor-pointer shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </span>
  );
};

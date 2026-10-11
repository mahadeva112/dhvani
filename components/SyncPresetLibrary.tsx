import React, { useRef, useState } from 'react';
import type { SyncOptions } from '../services/syncService';

type SavedPreset = { name: string; options: SyncOptions };
const KEY = 'dhvani_named_sync_presets';
const readLibrary = (value: unknown, normalize: (value: unknown) => SyncOptions): SavedPreset[] => {
  if (!Array.isArray(value)) throw new Error('Choose a DHVANI sync preset file.');
  return value.slice(0, 30).map((item) => {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || !item.options || typeof item.options !== 'object') throw new Error('This file contains an invalid preset.');
    return { name: item.name.trim().slice(0, 60), options: normalize(item.options) };
  });
};

export const SyncPresetLibrary: React.FC<{
  options: SyncOptions;
  onChange: React.Dispatch<React.SetStateAction<SyncOptions>>;
  normalize: (value: unknown) => SyncOptions;
  disabled: boolean;
}> = ({ options, onChange, normalize, disabled }) => {
  const [presets, setPresets] = useState<SavedPreset[]>(() => {
    try { return readLibrary(JSON.parse(localStorage.getItem(KEY) || '[]'), normalize); } catch { return []; }
  });
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const save = (next: SavedPreset[]) => {
    try { localStorage.setItem(KEY, JSON.stringify(next)); setPresets(next); return true; }
    catch { setMessage('Presets could not be saved on this device.'); return false; }
  };
  const exportPresets = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'dhvani-sync-presets', version: 1, presets }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'dhvani-sync-presets.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const button = 'h-8 px-2 rounded-lg border border-slate-700 text-[12px] text-slate-200 hover:bg-slate-800 disabled:opacity-40 cursor-pointer';
  return <details className="border-t border-slate-800 pt-2">
    <summary className="text-[13px] font-medium text-slate-200 cursor-pointer">My sync presets</summary>
    <div className="flex flex-col gap-2 pt-2">
      <p className="text-[11.5px] text-slate-400">Save these sync settings with a name. Settings are also remembered separately for each project.</p>
      <p className="text-[11.5px] text-slate-400">Saved presets stay on this computer. To use them on another one, Export them here and Import the file there.</p>
      <label htmlFor="sync-saved-preset" className="text-[12px] text-slate-400">Saved preset</label>
      <select id="sync-saved-preset" value={selected} disabled={disabled} className="h-9 bg-slate-950 border border-slate-800 rounded-lg px-2 text-[13px] text-slate-200"
        onChange={(e) => {
          setSelected(e.target.value);
          const preset = presets.find((p) => p.name === e.target.value);
          if (preset) { onChange(normalize(preset.options)); setMessage(`Applied ${preset.name}.`); }
        }}>
        <option value="">Choose a saved preset</option>
        {presets.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
      </select>
      <label htmlFor="sync-preset-name" className="text-[12px] text-slate-400">New preset name</label>
      <input id="sync-preset-name" value={name} maxLength={60} disabled={disabled} onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Bengali narration" className="h-9 bg-slate-950 border border-slate-800 rounded-lg px-2 text-[13px] text-slate-200" />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled || !name.trim() || presets.length >= 30} className={button} onClick={() => {
          const label = name.trim();
          if (presets.some((p) => p.name === label)) { setMessage('Use a new name, or remove the existing preset first.'); return; }
          if (save([...presets, { name: label, options: normalize(options) }])) { setSelected(label); setName(''); setMessage('Preset saved.'); }
        }}>Save current</button>
        <button type="button" className={button} disabled={disabled || !selected} onClick={() => {
          if (save(presets.filter((p) => p.name !== selected))) { setSelected(''); setMessage('Preset removed.'); }
        }}>Remove</button>
        <button type="button" className={button} disabled={disabled || !presets.length} onClick={exportPresets}>Export</button>
        <button type="button" className={button} disabled={disabled} onClick={() => input.current?.click()}>Import</button>
      </div>
      <input ref={input} type="file" accept=".json,application/json" className="hidden" disabled={disabled} onChange={async (event) => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        try {
          if (file.size > 256000) throw new Error('Preset files must be smaller than 256 KB.');
          const data = JSON.parse(await file.text());
          if (data.format !== 'dhvani-sync-presets' || data.version !== 1) throw new Error('Choose a DHVANI sync preset file.');
          const imported = readLibrary(data.presets, normalize);
          const next = [...presets];
          let added = 0;
          for (const preset of imported) {
            if (!next.some((p) => p.name === preset.name) && next.length < 30) { next.push(preset); added++; }
          }
          if (save(next)) setMessage(`Imported ${added} presets. Existing names were kept.`);
        } catch (error) { setMessage(error instanceof Error ? error.message : 'The preset file could not be read.'); }
      }} />
      {message && <p role="status" className="text-[11.5px] text-indigo-300">{message}</p>}
    </div>
  </details>;
};

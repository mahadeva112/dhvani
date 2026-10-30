import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import type { ProbeStatus } from '../services/providerDetect';

/**
 * The pieces API settings is built from: the check results, the step cards of
 * the pipeline, a speed sparkline, and drop-downs that open over the window
 * rather than inside it, so opening one never makes the window scroll.
 */

export interface DetectionRow {
  id: 'elevenlabs' | 'translation' | 'cartesia';
  label: string;
  status: ProbeStatus;
  message: string;
  models: string[];
  model?: string;
  url?: string;
  /** How long the service took to answer the check. */
  latencyMs?: number;
}

export interface DetectionResult {
  elevenlabs: DetectionRow;
  translation: DetectionRow;
  /** Cartesia is optional; absent on an older backend. */
  cartesia?: DetectionRow;
  mode: 'gateway' | 'google';
  checkedAt: string;
}

/* ------------------------------------------------------------------ */
/* Check history: the last few answer times per service, for the sparklines. */

const HISTORY_KEY = 'dhvani_check_times';
const HISTORY_LENGTH = 12;

export type CheckHistory = Partial<Record<DetectionRow['id'], number[]>>;

export const readCheckHistory = (): CheckHistory => {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
};

/** Adds every working row's answer time to the history and returns the new history. */
export const recordCheckTimes = (result: DetectionResult): CheckHistory => {
  const history = readCheckHistory();
  for (const row of [result.elevenlabs, result.translation, result.cartesia]) {
    if (!row || row.status !== 'ok' || typeof row.latencyMs !== 'number') continue;
    history[row.id] = [...(history[row.id] || []), row.latencyMs].slice(-HISTORY_LENGTH);
  }
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {}
  return history;
};

/** 182 -> "182 ms", 2176 -> "2.2 s". */
export const formatLatency = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

/** "api.elevenlabs.io" from a base URL, or the fallback when it is blank or not a URL. */
export const hostOf = (url: string | undefined, fallback: string) => {
  try {
    return url?.trim() ? new URL(url.trim().includes('://') ? url.trim() : `http://${url.trim()}`).host : fallback;
  } catch {
    return fallback;
  }
};

/** "3 s ago", "4 min ago". */
export const agoLabel = (iso: string | undefined, now: number) => {
  if (!iso) return '';
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return seconds < 5 ? 'just now' : seconds < 60 ? `${seconds} s ago` : `${Math.round(seconds / 60)} min ago`;
};

/* ------------------------------------------------------------------ */

/** A small line of the last answer times, newest on the right. Nothing for fewer than two. */
export const Sparkline: React.FC<{ values: number[]; active?: boolean }> = ({ values, active }) => {
  if (values.length < 2) return <div className="h-5" />;
  const w = 120;
  const h = 20;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const points = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / (max - min || 1)) * (h - 4)}`).join(' ');
  const colour = active ? '#818cf8' : '#475569';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-5" aria-hidden="true">
      <polygon points={`0,${h} ${points} ${w},${h}`} fill={colour} opacity={0.15} />
      <polyline points={points} fill="none" stroke={colour} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

/* ------------------------------------------------------------------ */

/**
 * A panel that opens over everything, next to its anchor: below it when there
 * is room, above it when there is not. It sits in a portal with a fixed
 * position, so the window under it never grows or scrolls. A click outside it
 * or Escape closes it.
 */
export const Popover: React.FC<{
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** Its width; the anchor's own width when omitted. */
  width?: number;
  children: React.ReactNode;
  label: string;
}> = ({ anchor, open, onClose, width, children, label }) => {
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const box = anchor.current?.getBoundingClientRect();
      if (!box) return;
      const gap = 6;
      const margin = 12;
      const w = Math.min(width ?? box.width, window.innerWidth - margin * 2);
      const left = Math.max(margin, Math.min(box.left, window.innerWidth - w - margin));
      const below = window.innerHeight - box.bottom - gap - margin;
      const above = box.top - gap - margin;
      const height = panel.current?.offsetHeight ?? 0;
      const goUp = height > below && above > below;
      const maxHeight = Math.max(160, goUp ? above : below);
      const top = goUp ? Math.max(margin, box.top - gap - Math.min(height, maxHeight)) : box.bottom + gap;
      setPlace({ top, left, width: w, maxHeight });
    };
    measure();
    // Measured again once the panel has its height, then on any resize or scroll.
    const frame = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, anchor, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      style={place ? { top: place.top, left: place.left, width: place.width, maxHeight: place.maxHeight } : { visibility: 'hidden', top: 0, left: 0 }}
      className="fixed z-[80] flex flex-col rounded-xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl shadow-black/70 overflow-hidden tools-hub-preview-in"
    >
      {children}
    </div>,
    document.body
  );
};

/* ------------------------------------------------------------------ */
/* The model list: long lists stay usable with search, filters, a Recent group and pinned provider headings. */

export type ModelTag = 'Fast' | 'Best' | 'Cheap';

/** A rough guide from the model's name alone; the footer of the list says so. */
export const modelTag = (model: string): ModelTag | null => {
  const name = model.split('/').pop()!.toLowerCase();
  if (/nano|micro|lite|-8b|-20b/.test(name)) return 'Cheap';
  if (/flash|-mini|haiku|small|scout|turbo/.test(name)) return 'Fast';
  if (/pro|opus|large|max|405b|120b|sonnet|ultra/.test(name)) return 'Best';
  return null;
};

const TAG_STYLE: Record<ModelTag, string> = {
  Fast: 'bg-sky-500/15 text-sky-300',
  Best: 'bg-violet-500/15 text-violet-300',
  Cheap: 'bg-emerald-500/15 text-emerald-300',
};

const RECENT_KEY = 'dhvani_recent_gateway_models';

const readRecent = (): string[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter((m) => typeof m === 'string') : [];
  } catch {
    return [];
  }
};

const rememberRecent = (model: string) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([model, ...readRecent().filter((m) => m !== model)].slice(0, 5)));
  } catch {}
};

/** "vertex_ai/gemini-3.7-flash" -> ["vertex_ai", "gemini-3.7-flash"]; no prefix -> ["", model]. */
const splitModel = (model: string): [string, string] => {
  const at = model.indexOf('/');
  return at > 0 ? [model.slice(0, at), model.slice(at + 1)] : ['', model];
};

/**
 * The model field. It stays a text box, so any name can be typed, and opens a
 * list of what the endpoint offers: typing filters it, the arrow keys move,
 * Enter picks. The list scrolls inside itself; the window does not.
 */
export const ModelPicker: React.FC<{
  id: string;
  value: string;
  models: string[];
  onChange: (model: string) => void;
  className: string;
  placeholder?: string;
}> = ({ id, value, models, onChange, className, placeholder }) => {
  const field = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // What was typed since the list opened; the list shows everything until then.
  const [query, setQuery] = useState<string | null>(null);
  const [filter, setFilter] = useState<'All' | ModelTag>('All');
  const [hi, setHi] = useState(0);

  const groups = useMemo(() => {
    const q = (query ?? '').trim().toLowerCase();
    const shown = models.filter((m) => (!q || m.toLowerCase().includes(q)) && (filter === 'All' || modelTag(m) === filter));
    const out: { label: string; items: string[] }[] = [];
    if (!q && filter === 'All') {
      const recent = readRecent().filter((m) => models.includes(m)).slice(0, 3);
      if (recent.length) out.push({ label: 'Recent', items: recent });
    }
    const byProvider = new Map<string, string[]>();
    for (const m of shown) {
      const [provider] = splitModel(m);
      byProvider.set(provider, [...(byProvider.get(provider) || []), m]);
    }
    for (const [provider, items] of byProvider) out.push({ label: provider || 'Models', items });
    return out;
  }, [models, query, filter, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const close = () => {
    setOpen(false);
    setQuery(null);
  };
  const pick = (model: string) => {
    onChange(model);
    rememberRecent(model);
    close();
  };

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-model-index="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (!flat.length) return;
      setHi((h) => (h + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length);
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (flat[hi]) pick(flat[hi]);
      else close();
    } else if (e.key === 'Tab') {
      close();
    }
  };

  let index = -1;
  return (
    <>
      <div ref={field} className="relative">
        <input
          ref={input}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          value={query ?? value}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value);
            setHi(0);
            setOpen(true);
          }}
          onFocus={() => models.length > 0 && setOpen(true)}
          onClick={() => models.length > 0 && setOpen(true)}
          onKeyDown={onKey}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className={`${className} pr-9`}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show the models"
          onClick={() => {
            if (open) close();
            else {
              setOpen(true);
              input.current?.focus();
            }
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-200 cursor-default"
        >
          <ChevronsUpDown className="w-3.5 h-3.5" />
        </button>
      </div>

      <Popover anchor={field} open={open && models.length > 0} onClose={close} width={460} label="Models">
        <div className="shrink-0 flex items-center gap-2 px-3 h-9 border-b border-slate-800 text-[11.5px] text-slate-500">
          <Search className="w-3.5 h-3.5" />
          <span className="flex-1 truncate">{query?.trim() ? `Matching “${query.trim()}”` : 'Type in the field to search'}</span>
          <span className="shrink-0">{flat.length === models.length ? `${models.length} models` : `${flat.length} of ${models.length}`}</span>
        </div>
        <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-slate-800">
          {(['All', 'Fast', 'Best', 'Cheap'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setFilter(f);
                setHi(0);
              }}
              className={`h-6 px-2.5 rounded-md text-[11.5px] cursor-default ${filter === f ? 'bg-indigo-500/25 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div ref={listRef} id={`${id}-list`} role="listbox" className="min-h-0 flex-1 max-h-[16rem] overflow-y-auto overscroll-contain [scrollbar-width:thin]">
          {flat.length === 0 && <p className="px-3 py-6 text-center text-[12px] text-slate-500">No model matches. Enter keeps what you typed.</p>}
          {groups.map((group) => (
            <div key={group.label}>
              <div className="sticky top-0 z-10 flex items-center justify-between px-3 h-7 bg-slate-900 border-b border-slate-800/70 text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">
                {group.label}
                <span className="normal-case tracking-normal font-normal">{group.items.length}</span>
              </div>
              {group.items.map((model) => {
                index += 1;
                const i = index;
                const [provider, name] = splitModel(model);
                const tag = modelTag(model);
                return (
                  <button
                    key={`${group.label}-${model}`}
                    type="button"
                    role="option"
                    aria-selected={model === value}
                    data-model-index={i}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => hi !== i && setHi(i)}
                    onClick={() => pick(model)}
                    className={`w-full flex items-center gap-2 px-3 h-8 text-left cursor-default ${
                      i === hi ? 'bg-slate-800 text-white' : model === value ? 'bg-indigo-500/10' : ''
                    }`}
                  >
                    <span className="flex-1 min-w-0 font-mono text-[11.5px] truncate">
                      {provider && <span className="text-slate-500">{provider}/</span>}
                      {name}
                    </span>
                    {tag && <span className={`shrink-0 text-[10px] px-1.5 rounded ${TAG_STYLE[tag]}`}>{tag}</span>}
                    {model === value ? <Check className="w-3.5 h-3.5 shrink-0 text-indigo-300" /> : <span className="w-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="shrink-0 flex items-center gap-3 px-3 h-8 border-t border-slate-800 text-[10.5px] text-slate-500">
          <span className="whitespace-nowrap">↑ ↓ move · Enter pick</span>
          <span className="ml-auto truncate">Fast, Best and Cheap are a guide from the name</span>
        </div>
      </Popover>
    </>
  );
};

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  /** Shown after the label, dimmer: a language's own script, a count. */
  hint?: string;
  /** One line under or beside the label: what picking it does. */
  description?: string;
  /** A dot in this colour before the label, e.g. a speaker's colour. */
  color?: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Read by screen readers when there is no visible label pointing at `id`. */
  ariaLabel?: string;
  id?: string;
  disabled?: boolean;
  /** Shown on the button when no option has the value. */
  placeholder?: string;
  /** Values picked lately, listed first under Recent while nothing is typed. */
  recent?: string[];
  /** Keeps the last few picks on this computer under this name, for Recent. */
  rememberAs?: string;
  /** Typing to find: on by default once there are more than 7 options. */
  searchable?: boolean;
  /** Three options or fewer as a row of buttons instead of a list. */
  segmented?: boolean;
  /** sm: a 28 px button for tight rows; md: the usual 36 px one. */
  size?: 'sm' | 'md';
  /** Classes for the button (or the segmented row): width, margins. */
  className?: string;
  /** The list's width when it should be wider than the button, in px. */
  menuWidth?: number;
  title?: string;
}

const norm = (s: string) => s.toLowerCase();

/** "Hindi (हिन्दी)" -> label Hindi, hint हिन्दी: the app's language lists as options. */
export const languageOptions = (languages: ({ code: string; label: string } | string)[]): SelectOption[] =>
  languages.map((lang) => {
    const code = typeof lang === 'string' ? lang : lang.code;
    const text = typeof lang === 'string' ? lang : lang.label;
    const m = text.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    return m ? { value: code, label: m[1], hint: m[2] } : { value: code, label: text };
  });

const RECENT_PREFIX = 'dhvani_recent_pick_';
const readRecent = (key: string | undefined): string[] => {
  if (!key) return [];
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_PREFIX + key) || '[]');
    return Array.isArray(list) ? list.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
};
const saveRecent = (key: string | undefined, value: string) => {
  if (!key) return;
  try {
    localStorage.setItem(RECENT_PREFIX + key, JSON.stringify([value, ...readRecent(key).filter((v) => v !== value)].slice(0, 3)));
  } catch {
    /* Storage off: no Recent group. */
  }
};

/** The matched part of `text` in the accent colour. */
const Highlight: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  if (!query) return <>{text}</>;
  const at = norm(text).indexOf(norm(query));
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="text-indigo-200 font-semibold">{text.slice(at, at + query.length)}</span>
      {text.slice(at + query.length)}
    </>
  );
};

/**
 * The app's dropdown, in place of the browser's own list: a list in the
 * app's colours that opens under its button, with typing to find, Recent
 * first. Short lists can be a row of
 * buttons instead (`segmented`).
 */
export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  ariaLabel,
  id,
  disabled = false,
  placeholder = 'Choose…',
  recent: recentProp,
  rememberAs,
  searchable,
  segmented = false,
  size = 'md',
  className = '',
  menuWidth,
  title,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; top: number; width: number; up: boolean; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const current = options.find((o) => o.value === value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recent = useMemo(() => recentProp ?? readRecent(rememberAs), [recentProp, rememberAs, open]);
  const canSearch = searchable ?? options.length > 7;

  // Recent first (while nothing is typed), then everything that matches.
  const rows = useMemo(() => {
    const q = norm(query.trim());
    const match = (o: SelectOption) => !q || norm(`${o.label} ${o.hint ?? ''} ${o.description ?? ''}`).includes(q);
    const all = options.filter(match);
    const groups: { title: string | null; items: SelectOption[] }[] = [];
    const recentItems = !q && recent ? recent.map((v) => options.find((o) => o.value === v)).filter((o): o is SelectOption => Boolean(o)) : [];
    if (recentItems.length > 0 && options.length > 7) groups.push({ title: 'Recent', items: recentItems });
    groups.push({ title: recentItems.length > 0 && options.length > 7 ? 'All' : q ? `${all.length} found` : null, items: all });
    return groups;
  }, [options, query, recent]);
  const flat = useMemo(() => rows.flatMap((g) => g.items), [rows]);

  const close = (refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) buttonRef.current?.focus();
  };
  const pick = (o: SelectOption | undefined) => {
    if (!o || o.disabled) return;
    if (o.value !== value) onChange(o.value);
    saveRecent(rememberAs, o.value);
    close();
  };
  const openMenu = () => {
    if (disabled) return;
    setQuery('');
    setOpen(true);
  };

  // Where the list goes: under the button, or over it when there is no room below.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(r.width, menuWidth ?? 0, 180);
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 260 && above > below;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setPlace({ left, top: up ? r.top - 6 : r.bottom + 6, width, up, maxHeight: Math.max(160, Math.min(420, up ? above : below)) });
    };
    measure();
    window.addEventListener('resize', measure);
    // Any scroll moves the button: follow it, unless the scroll is inside the list.
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      measure();
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, menuWidth]);

  // Opening: the picked row is the active one, in view; typing goes to the find box.
  useEffect(() => {
    if (!open) return;
    const at = flat.findIndex((o) => o.value === value);
    setActive(at >= 0 ? at : 0);
    requestAnimationFrame(() => {
      (canSearch ? inputRef.current : menuRef.current)?.focus();
      listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  // A click anywhere else closes the list. Clicks inside it stay inside, so a
  // window or menu around the button doesn't take them as a click outside.
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const keep = (e: Event) => e.stopPropagation();
    menu?.addEventListener('mousedown', keep);
    menu?.addEventListener('pointerdown', keep);
    const away = (e: MouseEvent) => {
      if (buttonRef.current?.contains(e.target as Node)) return;
      close(false);
    };
    document.addEventListener('mousedown', away);
    return () => {
      menu?.removeEventListener('mousedown', keep);
      menu?.removeEventListener('pointerdown', keep);
      document.removeEventListener('mousedown', away);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, place === null]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    // The keys belong to the list while it is open, not to a window behind it.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(flat.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(flat[active]);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  const dot = (o: SelectOption | undefined) =>
    o?.color ? <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: o.color }} aria-hidden="true" /> : null;

  if (segmented && options.length <= 3) {
    return (
      <div role="radiogroup" aria-label={ariaLabel} id={id} title={title} className={`flex bg-slate-950 border border-edge rounded-lg p-0.5 gap-0.5 ${className}`}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled || o.disabled}
              onClick={() => !on && onChange(o.value)}
              title={o.description}
              className={`flex-1 min-w-0 ${size === 'sm' ? 'h-6 text-[11.5px]' : 'h-8 text-[12.5px]'} px-2.5 rounded-md font-medium flex items-center justify-center gap-1.5 truncate transition-colors disabled:opacity-50 cursor-default ${
                on ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {dot(o)}
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  let n = -1;
  const menu =
    open && place
      ? createPortal(
          <div
            ref={menuRef}
            tabIndex={-1}
            onKeyDown={onMenuKey}
            style={{
              position: 'fixed',
              left: place.left,
              width: place.width,
              ...(place.up ? { bottom: window.innerHeight - place.top } : { top: place.top }),
            }}
            className="z-[1000] rounded-xl border border-edge bg-[#16171a] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.95)] overflow-hidden flex flex-col focus:outline-none animate-in fade-in zoom-in-95 duration-100"
          >
            {canSearch && (
              <div className="shrink-0 flex items-center gap-2 px-3 h-10 border-b border-edge">
                <Search className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Type to find…"
                  aria-label="Find"
                  aria-controls={listId}
                  aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
                  className="flex-1 min-w-0 bg-transparent text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
                />
              </div>
            )}
            <div ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} className="overflow-y-auto overscroll-contain custom-scrollbar py-1" style={{ maxHeight: place.maxHeight - (canSearch ? 40 : 0) }}>
              {rows.map((group, g) => (
                <div key={g} role="group" aria-label={group.title ?? undefined}>
                  {group.title && <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">{group.title}</div>}
                  {group.items.map((o) => {
                    n += 1;
                    const row = n;
                    const on = o.value === value;
                    const hot = row === active;
                    return (
                      <div
                        key={`${g}-${o.value}`}
                        id={`${listId}-${row}`}
                        data-row={row}
                        role="option"
                        aria-selected={on}
                        aria-disabled={o.disabled || undefined}
                        onMouseMove={() => !hot && setActive(row)}
                        onClick={() => pick(o)}
                        className={`mx-1 px-2.5 min-h-8 py-1.5 rounded-md flex items-center gap-2.5 text-[13px] ${
                          o.disabled ? 'opacity-40' : hot ? 'bg-indigo-500/15 text-white' : 'text-slate-200'
                        }`}
                      >
                        {dot(o)}
                        <span className="flex-1 min-w-0">
                          <span className="block truncate">
                            <Highlight text={o.label} query={query.trim()} />
                            {o.hint && (
                              <span className="ml-1.5 text-slate-500">
                                <Highlight text={o.hint} query={query.trim()} />
                              </span>
                            )}
                          </span>
                          {o.description && <span className="block text-[11.5px] text-slate-500 leading-snug whitespace-normal">{o.description}</span>}
                        </span>
                        {on ? (
                          <span className="shrink-0 flex items-center gap-1 text-[10.5px] text-indigo-300">
                            <Check className="w-3.5 h-3.5" aria-hidden="true" />
                            Picked
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
              {flat.length === 0 && <div className="px-3 py-4 text-[12px] text-slate-500">Nothing matches “{query.trim()}”</div>}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        disabled={disabled}
        title={title}
        aria-label={ariaLabel ? `${ariaLabel}: ${current?.label ?? placeholder}` : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (open) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openMenu();
          } else if (canSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Typing on the button opens the list with that letter in the find box.
            e.preventDefault();
            openMenu();
            setQuery(e.key);
          }
        }}
        className={`min-w-0 flex items-center gap-2 text-left border rounded-lg bg-slate-950 transition-colors disabled:opacity-50 disabled:hover:border-edge cursor-default ${
          size === 'sm' ? 'h-7 pl-2 pr-1.5 text-[12px]' : 'h-9 pl-3 pr-2 text-[13px]'
        } ${open ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-edge hover:border-slate-600'} ${className}`}
      >
        {dot(current)}
        <span className={`flex-1 min-w-0 truncate ${current ? 'text-slate-100 font-medium' : 'text-slate-500'}`}>
          {current ? current.label : placeholder}
          {current?.hint && <span className="ml-1.5 font-normal text-slate-500">{current.hint}</span>}
        </span>
        <ChevronDown
          className={`shrink-0 ${size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} transition-transform ${open ? 'rotate-180 text-indigo-300' : 'text-slate-500'}`}
          aria-hidden="true"
        />
      </button>
      {menu}
    </>
  );
};

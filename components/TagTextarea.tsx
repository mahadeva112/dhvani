import React, { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isTagName, TAG_LIBRARY } from '../server/lib/lineTags.js';
import { PAUSE_MARK } from '../server/lib/linePauses.js';

/** What the retake window can do to the words from outside them: put a tag where the caret is. */
export interface TagTextareaHandle {
  insertTag: (tag: string) => void;
  /** Types `[` where the caret is and offers the tags, as typing it would. */
  openTags: () => void;
  /** Puts these tags at the start of the line, in place of the tags it starts with. */
  leadWith: (tags: string[]) => void;
  focus: () => void;
}

/** One bracket as the words show it: a tag, a pause mark, a bracket the voice would read aloud, or one never closed. */
const marked = (text: string): React.ReactNode[] => {
  const out: React.ReactNode[] = [];
  const re = /\[[^\]\[\n]*\]|\[[^\]\[\n]*/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push(text.slice(at, m.index));
    const s = m[0];
    const closed = s.endsWith(']');
    const inner = closed ? s.slice(1, -1) : s.slice(1);
    const kind = !closed ? 'open' : new RegExp(PAUSE_MARK.source, 'i').test(s) ? 'pause' : isTagName(inner) ? 'tag' : 'foreign';
    // Colour only: anything that changed a letter's width would part the words from the caret.
    const cls =
      kind === 'tag'
        ? 'rounded-sm bg-indigo-500/30 text-indigo-200'
        : kind === 'pause'
          ? 'rounded-sm bg-sky-500/20 text-sky-200'
          : kind === 'foreign'
            ? 'rounded-sm bg-amber-500/25 text-amber-200'
            : 'text-rose-300 underline decoration-wavy decoration-rose-500';
    out.push(<span key={m.index} className={cls}>{s}</span>);
    at = m.index! + s.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
};

/**
 * The words of a retake, with the tags typed in them shown as tags. Typing
 * `[` offers the tags to pick from (arrows and Enter, or a click), and any
 * English tag may be typed instead. A textarea over a copy of its words that
 * carries the colours, so typing, selecting and undo stay the textarea's own.
 */
export const TagTextarea = forwardRef<
  TagTextareaHandle,
  {
    id: string;
    value: string;
    onChange: (value: string) => void;
    onBlur?: () => void;
    /** The user's own tags, offered after the library's. */
    ownTags: string[];
    /** A tag picked that is not in the library or the user's own: kept with the user's own. */
    onNewTag?: (tag: string) => void;
    large?: boolean;
  }
>(({ id, value, onChange, onBlur, ownTags, onNewTag, large = false }, ref) => {
  const area = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{ filter: string; from: number } | null>(null);
  const [active, setActive] = useState(0);

  // As tall as its words, so the coloured copy behind never has to scroll with it.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value, large]);

  const options = useMemo(() => {
    if (!menu) return [];
    const f = menu.filter.trim().toLowerCase();
    const groups = [...TAG_LIBRARY, { group: 'Your tags', tags: ownTags.filter((t) => !TAG_LIBRARY.some((g) => g.tags.includes(t))) }]
      .map((g) => ({ group: g.group, tags: g.tags.filter((t) => !f || t.includes(f)) }))
      .filter((g) => g.tags.length > 0);
    const known = groups.some((g) => g.tags.includes(f));
    return [...groups.flatMap((g) => g.tags.map((tag) => ({ group: g.group, tag, own: false }))), ...(f && !known && isTagName(f) ? [{ group: '', tag: f, own: true }] : [])];
  }, [menu, ownTags]);

  /** Opens the menu when the caret is just after an unclosed `[` and English letters. */
  const watchCaret = (el: HTMLTextAreaElement) => {
    const before = el.value.slice(0, el.selectionStart);
    const m = /\[([a-zA-Z' -]{0,30})$/.exec(before);
    if (m && el.selectionStart === el.selectionEnd) {
      setMenu({ filter: m[1], from: el.selectionStart - m[0].length });
      setActive(0);
    } else setMenu(null);
  };

  /** Writes `[tag] ` at `from`, over whatever is between it and the caret, and puts the caret after it. */
  const put = (tag: string, from: number, to: number) => {
    const el = area.current;
    const text = el?.value ?? value;
    const lead = from > 0 && !/\s/.test(text[from - 1]) ? ' ' : '';
    const trail = /^\s/.test(text.slice(to)) ? '' : ' ';
    const next = `${text.slice(0, from)}${lead}[${tag}]${trail}${text.slice(to)}`;
    const caret = from + lead.length + tag.length + 2 + trail.length;
    onChange(next);
    setMenu(null);
    if (!TAG_LIBRARY.some((g) => g.tags.includes(tag)) && !ownTags.includes(tag)) onNewTag?.(tag);
    requestAnimationFrame(() => {
      if (!area.current) return;
      area.current.focus();
      area.current.setSelectionRange(caret, caret);
    });
  };

  useImperativeHandle(ref, () => ({
    insertTag: (tag) => {
      const el = area.current;
      // With words selected, the tag goes before them.
      const at = el ? el.selectionStart : value.length;
      put(tag, at, at);
    },
    openTags: () => {
      const el = area.current;
      const text = el?.value ?? value;
      const at = el ? el.selectionStart : text.length;
      const lead = at > 0 && !/\s/.test(text[at - 1]) ? ' ' : '';
      const from = at + lead.length;
      // With words selected, the `[` goes before them.
      onChange(`${text.slice(0, at)}${lead}[${text.slice(at)}`);
      setMenu({ filter: '', from });
      setActive(0);
      requestAnimationFrame(() => {
        if (!area.current) return;
        area.current.focus();
        area.current.setSelectionRange(from + 1, from + 1);
      });
    },
    leadWith: (tags) => {
      const rest = value.replace(/^(\s*\[[a-zA-Z][a-zA-Z' -]{0,38}\])+\s*/, '');
      onChange(`${tags.map((t) => `[${t}]`).join(' ')} ${rest}`.trim());
    },
    focus: () => area.current?.focus(),
  }));

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menu || options.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      put(options[Math.min(active, options.length - 1)].tag, menu.from, e.currentTarget.selectionStart);
    } else if (e.key === 'Escape') {
      // Closes the menu only, not the window it is in.
      e.preventDefault();
      e.stopPropagation();
      setMenu(null);
    }
  };

  const text = large ? 'text-[14.5px] leading-relaxed' : 'text-[13.5px] leading-snug';
  const box = `w-full rounded-md ${large ? 'px-2.5 py-2' : 'px-2 py-1.5'} whitespace-pre-wrap break-words`;
  let lastGroup = '';
  return (
    <div className="relative">
      <div aria-hidden="true" className={`${box} ${text} absolute inset-0 border border-transparent bg-slate-900 text-slate-100 overflow-hidden pointer-events-none`}>
        {marked(value)}
        {value.endsWith('\n') ? '​' : ''}
      </div>
      <textarea
        ref={area}
        id={id}
        value={value}
        rows={large ? 3 : 2}
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          watchCaret(e.target);
        }}
        onSelect={(e) => watchCaret(e.currentTarget)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // A click in the menu lands before the blur would close it.
          setTimeout(() => setMenu(null), 150);
          onBlur?.();
        }}
        className={`${box} ${text} relative block resize-none overflow-hidden bg-transparent text-transparent caret-slate-100 border border-slate-800 focus:outline-none focus:border-indigo-500 selection:bg-indigo-500/40`}
      />
      {menu && options.length > 0 && (
        <div role="listbox" aria-label="Tags" className="absolute z-20 left-1 top-full mt-1 w-[19rem] max-h-64 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60 p-2">
          {options.map((o, i) => {
            const head = o.group !== lastGroup && o.group;
            lastGroup = o.group;
            return (
              <React.Fragment key={`${o.group}:${o.tag}`}>
                {head && <div className="text-[10.5px] uppercase tracking-wide font-semibold text-slate-500 mt-1 first:mt-0 mb-0.5">{o.group}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    put(o.tag, menu.from, area.current?.selectionStart ?? menu.from);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`w-full text-left rounded px-1.5 py-0.5 text-[12.5px] cursor-default ${i === active ? 'bg-indigo-500/25 text-indigo-100' : 'text-slate-200'}`}
                >
                  {o.own ? <>Use your own tag <span className="font-mono text-indigo-200">[{o.tag}]</span></> : <span className="font-mono">[{o.tag}]</span>}
                </button>
              </React.Fragment>
            );
          })}
          <p className="mt-1.5 text-[11px] text-slate-500">↑ ↓ to move · Enter to put it in · any English tag can be typed</p>
        </div>
      )}
    </div>
  );
});
TagTextarea.displayName = 'TagTextarea';

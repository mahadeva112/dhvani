import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Download, Lock, PenLine } from 'lucide-react';
import { AudioSegment } from '../../types';
import { DocumentSegmentSpan, placeCaret } from './DocumentSegmentSpan';
import { PASSAGE_PAUSES, buildPassages } from './passages';

type MarkerStyle = 'off' | 'dots' | 'numbers';
type Pane = 'source' | 'target';
type PaceLevel = 'natural' | 'tight' | 'fast';
type ParagraphStyle = 'one' | 'speaker' | 'pause';

export interface DocumentPacing {
  level: PaceLevel;
  cps: number;
  /** Seconds the line ends before the original speaker stops, when it ends early. */
  endsEarlyBy: number | null;
}

interface DocumentSettings {
  markers: MarkerStyle;
  /** Roman typing turns into the dub language's script. */
  phonetic: boolean;
  linkedScroll: boolean;
  followPlayback: boolean;
  paragraphs: ParagraphStyle;
  /** Too fast, tight and ends-early lines are marked in the dub text. */
  paceMarks: boolean;
}

const SETTINGS_KEY = 'dhvani_document_view';
const DEFAULT_SETTINGS: DocumentSettings = {
  markers: 'dots',
  phonetic: true,
  linkedScroll: true,
  followPlayback: true,
  paragraphs: 'pause',
  paceMarks: true,
};

const PARAGRAPH_STYLES: { id: ParagraphStyle; label: string; title: string }[] = [
  { id: 'one', label: 'One block', title: 'The whole script as one paragraph' },
  { id: 'speaker', label: 'By speaker', title: 'A new paragraph when the speaker changes' },
  { id: 'pause', label: 'By pause', title: 'A new paragraph where the original speaker pauses, or the speaker changes' },
];

const loadSettings = (): DocumentSettings => {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Before paragraph styles there was only a per-speaker switch.
      if (!parsed.paragraphs && parsed.speakerParagraphs) parsed.paragraphs = 'speaker';
      delete parsed.speakerParagraphs;
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {}
  return DEFAULT_SETTINGS;
};

// CSS Custom Highlight names, styled in index.css.
const MATCH_HIGHLIGHT = 'dhvani-doc-match';
const CURRENT_MATCH_HIGHLIGHT = 'dhvani-doc-match-current';
/** Where on screen the two columns are lined up, as a share of the column's height. */
const READING_LINE = 0.25;

const formatTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

/** Scrolls a column so an element sits in its middle; nothing happens when it's already comfortably in view. */
const scrollIntoColumn = (column: HTMLElement, el: HTMLElement, behavior: ScrollBehavior, force = false) => {
  const colRect = column.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  if (!force && rect.top >= colRect.top + 56 && rect.bottom <= colRect.bottom - 24) return;
  column.scrollTo({
    top: column.scrollTop + rect.top - colRect.top - column.clientHeight / 2 + Math.min(rect.height, column.clientHeight) / 2,
    behavior,
  });
};

const isShown = (el: HTMLElement | null): el is HTMLElement => Boolean(el && el.getClientRects().length > 0);

export interface ContinuousDocumentHandle {
  /** Scrolls both columns to a segment; with focus, puts the caret in its dub text. */
  reveal: (id: string | number, options?: { focus?: boolean }) => void;
  /** The segment last typed into, for tools that act on "this cue" such as the phonetic keyboard. */
  lastFocusedSegment: () => AudioSegment | null;
  /** Steps through search matches: 1 next, -1 previous. */
  stepMatch: (direction: -1 | 1) => void;
  scrollToEdge: (edge: 'top' | 'bottom') => void;
}

interface ContinuousDocumentViewProps {
  ref?: React.Ref<ContinuousDocumentHandle>;
  segments: AudioSegment[];
  sourceLanguage: string;
  targetLanguage: string;
  getSourceText: (seg: AudioSegment) => string;
  getTargetText: (seg: AudioSegment) => string;
  onUpdateSegment: (id: string | number, updates: Partial<AudioSegment>) => void;
  /** How the dub line fits its cue, for the pace marks and the pacing filter. */
  getPacing: (seg: AudioSegment) => DocumentPacing;
  /** Paragraphs By pause start where the original pauses longer than this, in seconds. */
  passagePause: number;
  onPassagePauseChange: (pause: number) => void;
  /** The Review step's pacing filter; here it dims other sentences rather than removing them from the text. */
  pacingFilter: 'all' | 'risk' | 'tight' | 'short' | 'fix';
  /** For the Lines to fix filter: the cue is in a sync line likely too long or ending early. */
  inLineToFix?: (segment: AudioSegment) => boolean;
  searchQuery: string;
  activeSegmentId: string | number | null;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  /** Prose size in px, set by the Review step's text size control. */
  fontSize?: number;
  /** Saves the dub script as a text file, offered beside Copy on the dub column. */
  onSaveScript?: () => void;
}

/**
 * The script as a continuous document: each language reads as running prose,
 * while every sentence stays its own segment, edited and saved on its own
 * through the same onUpdateSegment the other Review views use.
 */
export function ContinuousDocumentView({
  ref,
  segments,
  sourceLanguage,
  targetLanguage,
  getSourceText,
  getTargetText,
  onUpdateSegment,
  getPacing,
  passagePause,
  onPassagePauseChange,
  pacingFilter,
  inLineToFix,
  searchQuery,
  fontSize = 15,
  activeSegmentId,
  isPlaying,
  onSeek,
  onSaveScript,
}: ContinuousDocumentViewProps) {
  const [settings, setSettings] = useState<DocumentSettings>(loadSettings);
  const updateSettings = (patch: Partial<DocumentSettings>) =>
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  // Narrow screens show one language at a time.
  const [pane, setPane] = useState<Pane>('target');

  const rootRef = useRef<HTMLDivElement>(null);
  const columnRefs = { source: useRef<HTMLDivElement>(null), target: useRef<HTMLDivElement>(null) };
  const column = (p: Pane) => columnRefs[p].current;

  const latest = useRef({ segments, onUpdateSegment, onSeek });
  latest.current = { segments, onUpdateSegment, onSeek };
  const indexById = useMemo(() => new Map(segments.map((seg, i) => [String(seg.id), i])), [segments]);

  // ---------------------------------------------------------------------------
  // Editing: one segment at a time, through the shared source of truth.
  // ---------------------------------------------------------------------------
  const focusedId = useRef<string | number | null>(null);
  const lastFocusedId = useRef<string | number | null>(null);

  const handleCommit = useCallback((id: string | number, text: string) => {
    latest.current.onUpdateSegment(id, { textTarget: text, targetText: text });
  }, []);

  const targetSpan = (id: string | number) =>
    column('target')?.querySelector<HTMLElement>(`[data-seg-id="${CSS.escape(String(id))}"]`) ?? null;

  const handleNavigate = useCallback((id: string | number, direction: -1 | 1, caret: 'start' | 'end') => {
    const col = column('target');
    if (!col) return;
    const spans = Array.from(col.querySelectorAll<HTMLElement>('[data-seg-id][contenteditable]'));
    const next = spans[spans.findIndex((el) => el.dataset.segId === String(id)) + direction];
    if (!next) return;
    placeCaret(next, caret);
    scrollIntoColumn(col, next, 'smooth');
  }, []);

  // Hovering or editing a sentence lights up its pair in the other language.
  const pairIds = useRef<{ hover: string | null; focus: string | null }>({ hover: null, focus: null });
  const paintPairs = () => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll('[data-pair]').forEach((el) => el.removeAttribute('data-pair'));
    for (const id of new Set([pairIds.current.hover, pairIds.current.focus])) {
      if (id === null) continue;
      root.querySelectorAll(`[data-seg-id="${CSS.escape(id)}"]`).forEach((el) => el.setAttribute('data-pair', ''));
    }
  };

  const handleFocusChange = useCallback((id: string | number, focused: boolean) => {
    focusedId.current = focused ? id : null;
    if (focused) lastFocusedId.current = id;
    pairIds.current.focus = focused ? String(id) : null;
    paintPairs();
  }, []);

  const handleRootMouseOver = (e: React.MouseEvent) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-seg-id]')?.dataset.segId ?? null;
    if (id === pairIds.current.hover) return;
    pairIds.current.hover = id;
    paintPairs();
  };

  // Clicking a source sentence opens its dub text for editing, unless text is being selected to copy.
  const handleSourceClick = useCallback((id: string | number) => {
    if (!window.getSelection()?.isCollapsed) return;
    setPane('target');
    // After the target column is on screen.
    setTimeout(() => {
      const el = targetSpan(id);
      const col = column('target');
      if (!el || !col) return;
      placeCaret(el, 'end');
      scrollIntoColumn(col, el, 'smooth');
    }, 0);
  }, []);

  // ---------------------------------------------------------------------------
  // Linked scroll: the columns keep the same segment on the reading line.
  // ---------------------------------------------------------------------------
  // Scroll events caused by our own scrolling are ignored until this time.
  const quietUntil = useRef<Record<Pane, number>>({ source: 0, target: 0 });
  const scrollFrame = useRef<number | null>(null);

  const alignColumns = (from: Pane) => {
    const to: Pane = from === 'source' ? 'target' : 'source';
    const a = column(from);
    const b = column(to);
    if (!isShown(a) || !isShown(b)) return;

    let top: number;
    if (a.scrollTop <= 0) top = 0;
    else if (a.scrollTop + a.clientHeight >= a.scrollHeight - 2) top = b.scrollHeight;
    else {
      const aRect = a.getBoundingClientRect();
      const line = aRect.top + a.clientHeight * READING_LINE;
      const spans = a.querySelectorAll<HTMLElement>('[data-seg-id]');
      // The first sentence that reaches below the reading line, found by bisection.
      let lo = 0;
      let hi = spans.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (spans[mid].getBoundingClientRect().bottom > line) hi = mid;
        else lo = mid + 1;
      }
      const anchor = spans[lo];
      const pair = anchor && b.querySelector<HTMLElement>(`[data-seg-id="${CSS.escape(anchor.dataset.segId || '')}"]`);
      if (!anchor || !pair) return;
      const rect = anchor.getBoundingClientRect();
      const through = rect.height > 0 ? Math.min(1, Math.max(0, (line - rect.top) / rect.height)) : 0;
      const pairRect = pair.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      const pairPoint = pairRect.top - bRect.top + b.scrollTop + through * pairRect.height;
      top = pairPoint - b.clientHeight * READING_LINE;
    }
    quietUntil.current[to] = performance.now() + 120;
    b.scrollTop = top;
  };

  const handleColumnScroll = (from: Pane) => {
    if (!settings.linkedScroll || performance.now() < quietUntil.current[from]) return;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      alignColumns(from);
    });
  };

  const reveal = (id: string | number, behavior: ScrollBehavior = 'smooth', force = false) => {
    const key = CSS.escape(String(id));
    for (const p of ['source', 'target'] as const) {
      const col = column(p);
      const el = col?.querySelector<HTMLElement>(`[data-seg-id="${key}"]`);
      if (!isShown(col) || !el) continue;
      quietUntil.current[p] = performance.now() + 900;
      scrollIntoColumn(col, el, behavior, force);
    }
  };

  // Follow playback, but never pull the page out from under someone typing.
  useEffect(() => {
    if (!settings.followPlayback || !isPlaying || activeSegmentId === null || focusedId.current !== null) return;
    reveal(activeSegmentId);
  }, [activeSegmentId, isPlaying, settings.followPlayback]);

  // ---------------------------------------------------------------------------
  // Search: matches are highlighted in place, so the document stays whole.
  // ---------------------------------------------------------------------------
  const query = searchQuery.trim().toLowerCase();
  const matchRanges = useRef<Range[]>([]);
  const [matchCount, setMatchCount] = useState(0);
  const [matchIndex, setMatchIndex] = useState(0);
  // Bumped whenever the ranges are rebuilt, so the current-match highlight follows edits.
  const [matchVersion, setMatchVersion] = useState(0);
  const highlights = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

  useEffect(() => setMatchIndex(0), [query]);

  useEffect(() => {
    const ranges: Range[] = [];
    if (query) {
      // In reading order: each segment's source sentence, then its dub, across the columns that are on screen.
      const shown = (['source', 'target'] as const).map(column).filter(isShown);
      const spansBySegment = new Map<string, HTMLElement[]>();
      for (const col of shown) {
        col.querySelectorAll<HTMLElement>('[data-seg-id]').forEach((el) => {
          const id = el.dataset.segId || '';
          spansBySegment.set(id, [...(spansBySegment.get(id) || []), el]);
        });
      }
      for (const seg of segments) {
        for (const span of spansBySegment.get(String(seg.id)) || []) {
          const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = (node.textContent || '').toLowerCase();
            for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + query.length)) {
              const range = document.createRange();
              range.setStart(node, at);
              range.setEnd(node, at + query.length);
              ranges.push(range);
            }
          }
        }
      }
    }
    matchRanges.current = ranges;
    setMatchCount(ranges.length);
    setMatchVersion((v) => v + 1);
    if (!highlights) return;
    CSS.highlights.set(MATCH_HIGHLIGHT, new Highlight(...ranges));
    return () => {
      CSS.highlights.delete(MATCH_HIGHLIGHT);
    };
  }, [query, segments, settings.markers, settings.paragraphs, settings.paceMarks, passagePause, pane, highlights]);

  const currentMatch = matchCount > 0 ? Math.min(matchIndex, matchCount - 1) : -1;

  useEffect(() => {
    if (!highlights) return;
    const range = currentMatch >= 0 ? matchRanges.current[currentMatch] : null;
    if (range) CSS.highlights.set(CURRENT_MATCH_HIGHLIGHT, new Highlight(range));
    else CSS.highlights.delete(CURRENT_MATCH_HIGHLIGHT);
  }, [currentMatch, matchVersion, highlights]);

  // Brings the current match into view when the search or the chosen match changes, not on every edit.
  useEffect(() => {
    const range = currentMatch >= 0 ? matchRanges.current[currentMatch] : null;
    const span = range?.startContainer.parentElement?.closest<HTMLElement>('[data-seg-id]');
    const col = span?.closest<HTMLElement>('[data-doc-column]');
    if (span && col && focusedId.current === null) scrollIntoColumn(col, span, 'smooth');
  }, [currentMatch, query]);

  useEffect(
    () => () => {
      if (highlights) CSS.highlights.delete(CURRENT_MATCH_HIGHLIGHT);
    },
    [highlights]
  );

  const stepMatch = (direction: -1 | 1) => {
    if (matchCount === 0) return;
    setMatchIndex((i) => (Math.min(i, matchCount - 1) + direction + matchCount) % matchCount);
  };

  useImperativeHandle(ref, () => ({
    reveal: (id, options) => {
      if (options?.focus) setPane('target');
      setTimeout(() => {
        reveal(id, 'smooth', true);
        const el = options?.focus ? targetSpan(id) : null;
        if (el) placeCaret(el, 'end');
      }, 0);
    },
    lastFocusedSegment: () =>
      lastFocusedId.current === null
        ? null
        : latest.current.segments.find((seg) => seg.id === lastFocusedId.current) ?? null,
    stepMatch,
    scrollToEdge: (edge) => {
      for (const p of ['source', 'target'] as const) {
        const col = column(p);
        if (!col) continue;
        quietUntil.current[p] = performance.now() + 900;
        col.scrollTo({ top: edge === 'top' ? 0 : col.scrollHeight, behavior: 'smooth' });
      }
    },
  }));

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------
  /** Runs of segments shown as one paragraph: the whole script, one run per speaker, or one per passage. */
  const paragraphs = useMemo(() => {
    if (settings.paragraphs === 'pause') return buildPassages(segments, passagePause).map((p) => p.cues);
    if (settings.paragraphs === 'one') return [segments];
    const runs: AudioSegment[][] = [];
    segments.forEach((seg, i) => {
      if (i > 0 && (seg.speaker || '') === (segments[i - 1].speaker || '')) runs[runs.length - 1].push(seg);
      else runs.push([seg]);
    });
    return runs;
  }, [segments, settings.paragraphs, passagePause]);

  const pacing = useMemo(() => new Map(segments.map((seg) => [String(seg.id), getPacing(seg)])), [segments, getPacing]);
  const pacingOf = (seg: AudioSegment) => pacing.get(String(seg.id)) ?? getPacing(seg);

  const isDimmed = (seg: AudioSegment) => {
    if (pacingFilter === 'all') return false;
    if (pacingFilter === 'fix') return !inLineToFix?.(seg);
    const p = pacingOf(seg);
    if (pacingFilter === 'short') return p.endsEarlyBy === null;
    return pacingFilter === 'risk' ? p.level !== 'fast' : p.level !== 'tight';
  };

  const spanClass = (seg: AudioSegment, editable: boolean) => {
    const classes = ['doc-seg rounded-[3px] transition-colors outline-none [box-decoration-break:clone]'];
    classes.push(editable ? 'cursor-text text-slate-100' : 'cursor-pointer text-slate-300');
    if (seg.id === activeSegmentId) classes.push('doc-seg-active');
    if (isDimmed(seg)) classes.push('opacity-35');
    if (editable && settings.paceMarks) {
      const p = pacingOf(seg);
      if (p.level === 'fast') classes.push('doc-pace-fast');
      else if (p.level === 'tight') classes.push('doc-pace-tight');
      else if (p.endsEarlyBy !== null) classes.push('doc-pace-early');
    }
    return classes.join(' ');
  };

  /** The number a pace mark carries after its line: how fast it reads, or how early it ends. */
  const renderPaceChip = (seg: AudioSegment) => {
    if (!settings.paceMarks) return null;
    const p = pacingOf(seg);
    const number = (indexById.get(String(seg.id)) ?? 0) + 1;
    const duration = Math.max(0, seg.endTime - seg.startTime);
    const chip =
      p.level === 'fast'
        ? {
            text: `${Math.round(p.cps)} cps`,
            className: 'bg-rose-500/15 text-rose-300',
            title: `Cue ${number} is too fast: ${Math.round(p.cps)} characters a second in ${duration.toFixed(1)}s (natural is up to 14). Play from here`,
          }
        : p.level === 'natural' && p.endsEarlyBy !== null
          ? {
              text: `+${p.endsEarlyBy.toFixed(1)}s`,
              className: 'bg-sky-500/15 text-sky-300',
              title: `Cue ${number} ends about ${p.endsEarlyBy.toFixed(1)}s before the original speaker stops. Play from here`,
            }
          : null;
    if (!chip) return null;
    return (
      <button
        type="button"
        tabIndex={-1}
        contentEditable={false}
        onClick={() => latest.current.onSeek(seg.startTime)}
        className={`select-none ml-1 px-1 rounded font-mono text-[10.5px] align-[1px] leading-none py-0.5 cursor-pointer hover:brightness-125 ${chip.className}`}
        title={chip.title}
      >
        {chip.text}
      </button>
    );
  };

  /** Where the flagged lines are across the whole script, placed by how far into the dub text they sit. */
  const paceMap = useMemo(() => {
    const total = segments.reduce((sum, seg) => sum + getTargetText(seg).length + 1, 0) || 1;
    let at = 0;
    const marks: { id: string | number; top: number; kind: 'fast' | 'tight' | 'early' }[] = [];
    for (const seg of segments) {
      const p = pacingOf(seg);
      const kind = p.level === 'fast' ? 'fast' : p.level === 'tight' ? 'tight' : p.endsEarlyBy !== null ? 'early' : null;
      if (kind) marks.push({ id: seg.id, top: (at / total) * 100, kind });
      at += getTargetText(seg).length + 1;
    }
    return marks;
  }, [segments, pacing]);

  const renderMarker = (seg: AudioSegment) => {
    if (settings.markers === 'off') return null;
    const number = (indexById.get(String(seg.id)) ?? 0) + 1;
    return (
      <button
        type="button"
        tabIndex={-1}
        onClick={() => latest.current.onSeek(seg.startTime)}
        className={`doc-marker select-none mr-1 text-slate-500 hover:text-indigo-300 cursor-pointer ${
          settings.markers === 'numbers' ? 'align-[1px] font-mono text-[10px]' : 'text-lg leading-none align-[-1px]'
        }`}
        title={`Cue ${number} · ${formatTime(seg.startTime)}–${formatTime(seg.endTime)} · play from here`}
        aria-label={`Play cue ${number} from ${formatTime(seg.startTime)}`}
      >
        {settings.markers === 'numbers' ? number : '·'}
      </button>
    );
  };

  // Copies a whole column as plain text, one paragraph per speaker run when those are shown.
  const [copied, setCopied] = useState<Pane | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);
  const copyColumn = async (p: Pane) => {
    const text = paragraphs
      .map((run) =>
        run
          .map((seg) => (p === 'target' ? getTargetText(seg) : getSourceText(seg)).trim())
          .filter(Boolean)
          .join(' ')
      )
      .filter(Boolean)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Where the async clipboard is refused (an embedded browser, a page without focus), copy through a selection.
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      if (!ok) return;
    }
    setCopied(p);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 1500);
  };

  const renderColumn = (p: Pane) => {
    const editable = p === 'target';
    const language = editable ? targetLanguage : sourceLanguage;
    const characters = segments.reduce(
      (sum, seg) => sum + (editable ? getTargetText(seg) : getSourceText(seg)).length,
      0
    );
    return (
      <div
        ref={columnRefs[p]}
        data-doc-column={p}
        onScroll={() => handleColumnScroll(p)}
        className={`relative min-h-0 overflow-y-auto overscroll-contain custom-scrollbar ${
          pane === p ? 'block' : 'hidden'
        } lg:block ${editable ? '' : 'lg:border-r border-slate-800'}`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-5 sm:px-7 py-2.5 bg-slate-900 border-b border-slate-800/60 text-[11px]">
          <span className={`font-medium ${editable ? 'text-indigo-300' : 'text-slate-400'}`}>
            {language || (editable ? 'Dub script' : 'Original')}
            <span className="text-slate-500 font-normal"> · {editable ? 'dub script' : 'source'}</span>
            <span className="ml-2 font-mono text-[10.5px] text-slate-500 font-normal tabular-nums">
              {characters.toLocaleString()} chars
            </span>
          </span>
          <span className="flex items-center gap-3 text-slate-500">
            <span className="hidden xl:flex items-center gap-1 whitespace-nowrap">
              {editable ? <PenLine className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
              {editable ? 'Click any sentence to edit' : 'Read only'}
            </span>
            <button
              type="button"
              onClick={() => copyColumn(p)}
              className="flex items-center gap-1 px-1.5 py-0.5 -my-0.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer transition-colors"
              title={`Copy the whole ${editable ? 'dub script' : 'source'}. To copy part of it, select the text and press Ctrl+C.`}
            >
              {copied === p ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copied === p ? 'Copied' : 'Copy'}
            </button>
            {editable && onSaveScript && (
              <button
                type="button"
                onClick={onSaveScript}
                className="flex items-center gap-1 px-1.5 py-0.5 -my-0.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer transition-colors"
                title="Save the dub script as a .txt file. More formats are under the script in the Dub step."
              >
                <Download className="w-3 h-3" />
                Save .txt
              </button>
            )}
          </span>
        </div>
        <div lang={language || undefined} className="px-5 sm:px-7 pt-4 pb-16 max-w-[68ch] space-y-5">
          {paragraphs.map((run) => (
            <div key={String(run[0].id)}>
              {settings.paragraphs !== 'one' && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => latest.current.onSeek(run[0].startTime)}
                  className="mb-1 flex items-center gap-1.5 text-[10.5px] text-slate-500 hover:text-indigo-300 cursor-pointer select-none"
                  title="Play from the start of this paragraph"
                >
                  <span className="font-mono tabular-nums">{formatTime(run[0].startTime)}</span>
                  {run[0].speaker && (
                    <span className="uppercase tracking-wider font-semibold">· {run[0].speaker}</span>
                  )}
                </button>
              )}
              <p className="leading-[1.9]" style={{ fontSize: `${fontSize}px` }}>
                {run.map((seg, i) => (
                  <React.Fragment key={String(seg.id)}>
                    {i > 0 && ' '}
                    {renderMarker(seg)}
                    <DocumentSegmentSpan
                      segmentId={seg.id}
                      value={editable ? getTargetText(seg) : getSourceText(seg)}
                      editable={editable}
                      className={spanClass(seg, editable)}
                      placeholder={editable ? `Cue ${(indexById.get(String(seg.id)) ?? 0) + 1} is empty` : undefined}
                      title={editable ? `Cue ${(indexById.get(String(seg.id)) ?? 0) + 1}, ${targetLanguage}` : undefined}
                      phoneticLanguage={editable && settings.phonetic ? targetLanguage : null}
                      onCommit={editable ? handleCommit : undefined}
                      onNavigate={editable ? handleNavigate : undefined}
                      onFocusChange={editable ? handleFocusChange : undefined}
                      onClick={editable ? undefined : handleSourceClick}
                    />
                    {editable && renderPaceChip(seg)}
                  </React.Fragment>
                ))}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const toggles: { key: 'phonetic' | 'linkedScroll' | 'followPlayback' | 'paceMarks'; label: string; title?: string }[] = [
    { key: 'phonetic', label: 'Phonetic typing', title: `Type Roman letters and get ${targetLanguage || 'the dub language'} as you go` },
    { key: 'linkedScroll', label: 'Linked scroll' },
    { key: 'followPlayback', label: 'Follow playback' },
    {
      key: 'paceMarks',
      label: 'Pace marks',
      title: 'Mark dub lines that are too fast (red wave), tight (amber dots) or end early (blue dashes)',
    },
  ];

  const segmentedClass = (on: boolean) =>
    `px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
      on ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
    }`;

  return (
    <div
      ref={rootRef}
      onMouseOver={handleRootMouseOver}
      onMouseLeave={() => {
        pairIds.current.hover = null;
        paintPairs();
      }}
      className="h-full min-h-[420px] flex flex-col bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden"
    >
      {/* Reading options */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 sm:px-4 py-2 border-b border-slate-800 text-[11px] text-slate-400">
        <div className="flex items-center gap-2">
          <span>Markers</span>
          <div role="group" aria-label="Segment markers" className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5 gap-0.5">
            {(['off', 'dots', 'numbers'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={settings.markers === m}
                onClick={() => updateSettings({ markers: m })}
                className={`capitalize ${segmentedClass(settings.markers === m)}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span>Paragraphs</span>
          <div role="group" aria-label="Paragraphs" className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5 gap-0.5">
            {PARAGRAPH_STYLES.map(({ id, label, title }) => (
              <button
                key={id}
                type="button"
                aria-pressed={settings.paragraphs === id}
                onClick={() => updateSettings({ paragraphs: id })}
                className={segmentedClass(settings.paragraphs === id)}
                title={title}
              >
                {label}
              </button>
            ))}
          </div>
          {settings.paragraphs === 'pause' && (
            <div
              role="group"
              aria-label="Pause that starts a paragraph"
              className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5 gap-0.5"
              title="How long the original speaker has to pause for a new paragraph"
            >
              {PASSAGE_PAUSES.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={passagePause === p}
                  onClick={() => onPassagePauseChange(p)}
                  className={`font-mono tabular-nums ${segmentedClass(passagePause === p)}`}
                >
                  {p}s
                </button>
              ))}
            </div>
          )}
        </div>
        {toggles.map(({ key, label, title }) => (
          <label key={key} title={title} className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200">
            <input
              type="checkbox"
              checked={settings[key]}
              onChange={(e) => updateSettings({ [key]: e.target.checked })}
              className="accent-indigo-500 cursor-pointer"
            />
            {label}
          </label>
        ))}

        {query && (
          <div className="ml-auto flex items-center gap-1">
            <span className="tabular-nums text-slate-400">
              {matchCount === 0 ? 'No matches' : `${currentMatch + 1} of ${matchCount}`}
            </span>
            <button
              type="button"
              onClick={() => stepMatch(-1)}
              className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
              aria-label="Previous match"
              title="Previous match (Shift+Enter in search)"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => stepMatch(1)}
              className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
              aria-label="Next match"
              title="Next match (Enter in search)"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* One language at a time on narrow screens */}
      <div role="group" aria-label="Language" className="lg:hidden flex gap-1 px-3 pt-2">
        {(['source', 'target'] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={pane === p}
            onClick={() => setPane(p)}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
              pane === p ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {p === 'source' ? sourceLanguage || 'Original' : targetLanguage || 'Dub script'}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 min-h-0 grid grid-cols-1 lg:grid-cols-2">
          {renderColumn('source')}
          {renderColumn('target')}
        </div>
        {settings.paceMarks && paceMap.length > 0 && (
          <div
            className="relative w-3 shrink-0 my-2 mr-1 border-l border-slate-800"
            role="group"
            aria-label="Flagged lines across the script"
          >
            {paceMap.map((m) => {
              const number = (indexById.get(String(m.id)) ?? 0) + 1;
              const label = m.kind === 'fast' ? 'too fast' : m.kind === 'tight' ? 'tight' : 'ends early';
              return (
                <button
                  key={String(m.id)}
                  type="button"
                  tabIndex={-1}
                  onClick={() => reveal(m.id, 'smooth', true)}
                  className={`absolute left-0.5 w-2 h-1 rounded-sm cursor-pointer hover:h-1.5 ${
                    m.kind === 'fast' ? 'bg-rose-400' : m.kind === 'tight' ? 'bg-amber-400' : 'bg-sky-400'
                  }`}
                  style={{ top: `${m.top}%` }}
                  title={`Cue ${number}, ${label}`}
                  aria-label={`Go to cue ${number}, ${label}`}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

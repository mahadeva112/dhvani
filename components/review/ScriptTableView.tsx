import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Download, Keyboard, Pause, Play } from 'lucide-react';
import { AudioSegment } from '../../types';
import { scrollWithin } from '../scrollWithin';
import { SCRIPT_PALETTES, getIndicLanguageConfig } from '../../services/indicTransliteration';
import { PASSAGE_PAUSES, buildPassages, loadPassageLayout, savePassageLayout, type PassageLayout } from './passages';
import { usePhoneticTyping } from './usePhoneticTyping';
import {
  DOCX_MIME,
  WORD_PARAGRAPH_SIZES,
  buildScriptDocx,
  loadWordParagraphSize,
  saveWordParagraphSize,
  scriptDocxFileName,
  scriptDocxRows,
  type WordParagraphSize,
} from '../../services/scriptDocx';
import { saveFileAs } from '../../services/saveFile';

export interface LinePacing {
  level: 'natural' | 'tight' | 'fast';
  cps: number;
  /** Seconds the line ends before the original speaker stops, when it ends early. */
  endsEarlyBy: number | null;
}

const formatTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

/** A cue's text as one line of the passage cell; a line break inside a cue would shift every line after it. */
const asLine = (text: string) => text.replace(/\s*\n\s*/g, ' ');

// Shared by the textarea and the copy behind it, so the pace marks sit exactly under the words.
const CELL_TEXT = 'px-3 py-2.5 leading-[1.75] whitespace-pre-wrap break-words [overflow-wrap:anywhere]';

// The light wash on the line being heard, in both layouts.
const PLAYING_WASH = 'bg-amber-200/[0.14]';

const LAYOUTS: { id: PassageLayout; label: string; title: string }[] = [
  { id: 'lines', label: 'Lines', title: 'One line per cue, to edit the dub' },
  { id: 'paragraph', label: 'Paragraph', title: 'Each passage as running text, to read along while it plays' },
];

/**
 * The bar on the playing line of a cell. It glides from line to line, and
 * measures the lines of its sibling marked data-lines, so it fits a line that wraps.
 */
function PlayingLineBar({ index, text }: { index: number; text: string }) {
  const barRef = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const bar = barRef.current;
    const lines = bar?.parentElement?.querySelector<HTMLElement>('[data-lines]');
    if (!bar || !lines) return;
    const place = () => {
      const line = lines.children[index] as HTMLElement | undefined;
      if (!line) return;
      bar.style.transform = `translateY(${line.offsetTop}px)`;
      bar.style.height = `${line.offsetHeight}px`;
    };
    if (placed.current) place();
    else {
      // Lands on the first line it shows without gliding in from the top.
      bar.style.transition = 'none';
      place();
      void bar.offsetHeight;
      bar.style.transition = '';
      placed.current = true;
    }
    const observer = new ResizeObserver(place);
    observer.observe(lines);
    return () => observer.disconnect();
  }, [index, text]);
  return (
    <div
      ref={barRef}
      aria-hidden
      className={`absolute inset-x-0 top-0 pointer-events-none border-l-[3px] border-amber-300 ${PLAYING_WASH} transition-[transform,height] duration-[450ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none`}
    />
  );
}

interface ScriptTableViewProps {
  segments: AudioSegment[];
  /** Passages shown: those with at least one of these cues, so search and the pacing filter still narrow the table. */
  visibleIds: Set<string>;
  sourceLanguage: string;
  targetLanguage: string;
  getSourceText: (seg: AudioSegment) => string;
  getTargetText: (seg: AudioSegment) => string;
  /** Writes several cues' dub lines in one change. */
  onUpdateLines: (lines: { id: string | number; text: string }[]) => void;
  /** How a line fits its cue, worked out from the text being typed. */
  getPacing: (seg: AudioSegment, text: string) => LinePacing;
  passagePause: number;
  onPassagePauseChange: (pause: number) => void;
  activeSegmentId: string | number | null;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  /** Plays the original from a passage's start and stops at its end. */
  onPlayPassage: (start: number, end: number) => void;
  onTogglePlay: () => void;
  fontSize?: number;
  /** The Word file's heading, e.g. the media's name. */
  exportTitle?: string;
}

/**
 * The script as a plain table, one row per passage: the original's lines
 * beside one editable cell of dub text, one line per cue. Edits go back to
 * the cues when the cell loses focus, and only when every cue still has its line.
 */
export function ScriptTableView({
  segments,
  visibleIds,
  sourceLanguage,
  targetLanguage,
  getSourceText,
  getTargetText,
  onUpdateLines,
  getPacing,
  passagePause,
  onPassagePauseChange,
  activeSegmentId,
  isPlaying,
  onSeek,
  onPlayPassage,
  onTogglePlay,
  fontSize = 15,
  exportTitle,
}: ScriptTableViewProps) {
  const passages = useMemo(() => buildPassages(segments, passagePause), [segments, passagePause]);
  const shown = passages.filter((p) => p.cues.some((seg) => visibleIds.has(String(seg.id))));

  // Text being typed, or kept because its lines no longer match the cues, by passage.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [layout, setLayout] = useState<PassageLayout>(loadPassageLayout);
  const changeLayout = (next: PassageLayout) => {
    setLayout(next);
    savePassageLayout(next);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  // The cell being typed in, so the signs row can write at its caret.
  const typingRef = useRef<{ ta: HTMLTextAreaElement; key: string } | null>(null);
  // Set by Esc: the blur that follows must not save the draft it is throwing away.
  const discardingRef = useRef<string | null>(null);
  const phonetic = usePhoneticTyping(targetLanguage);
  const langConfig = getIndicLanguageConfig(targetLanguage);
  const palette = SCRIPT_PALETTES[langConfig.script] || SCRIPT_PALETTES.Devanagari;
  const signs = [...palette.matras, langConfig.purnaViram || '।', '॥', '₹'];

  const setDraft = (key: string) => (text: string) => setDrafts((d) => ({ ...d, [key]: text }));

  /** Writes a sign at the caret of the cell being typed in. */
  const insertSign = (sign: string) => {
    const typing = typingRef.current;
    if (!typing) return;
    const { ta, key } = typing;
    const start = ta.selectionStart;
    setDraft(key)(ta.value.substring(0, start) + sign + ta.value.substring(ta.selectionEnd));
    setTimeout(() => ta.setSelectionRange(start + sign.length, start + sign.length), 0);
  };

  const savedText = (cues: AudioSegment[]) => cues.map((seg) => asLine(getTargetText(seg))).join('\n');

  const dropDraft = (key: string) =>
    setDrafts((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });

  const commit = (key: string, cues: AudioSegment[]) => {
    const draft = drafts[key];
    if (draft === undefined) return;
    const lines = draft.split('\n');
    if (lines.length !== cues.length) return; // kept, with a note, until the lines match again
    const changed = cues
      .map((seg, i) => ({ id: seg.id, text: lines[i], before: asLine(getTargetText(seg)) }))
      .filter((l) => l.text !== l.before)
      .map(({ id, text }) => ({ id, text }));
    if (changed.length > 0) onUpdateLines(changed);
    dropDraft(key);
  };

  // Follow playback to the passage being heard, but never while someone is typing.
  const activeKey = useMemo(
    () => passages.find((p) => p.cues.some((seg) => seg.id === activeSegmentId))?.key ?? null,
    [passages, activeSegmentId]
  );
  useEffect(() => {
    if (!isPlaying || !activeKey || editing) return;
    scrollWithin(rootRef.current?.querySelector(`[data-passage="${CSS.escape(activeKey)}"]`), 'nearest', true);
  }, [activeKey, isPlaying, editing]);

  /** A passage as running text: each cue's line flows on from the last, the one being heard washed. */
  const paragraph = (cues: AudioSegment[], textOf: (seg: AudioSegment) => string, lang: string) => (
    <div className={`${CELL_TEXT} whitespace-normal`} lang={lang || undefined}>
      {cues.map((seg, i) => (
        <React.Fragment key={String(seg.id)}>
          {i > 0 && ' '}
          <span
            onClick={() => window.getSelection()?.isCollapsed && onSeek(seg.startTime)}
            className={`rounded-sm [box-decoration-break:clone] cursor-default transition-colors duration-[450ms] motion-reduce:transition-none ${
              seg.id === activeSegmentId
                ? `${PLAYING_WASH} text-white shadow-[inset_0_-2px_0_rgb(252_211_77/0.7)]`
                : 'hover:bg-white/[0.06] hover:text-slate-100'
            }`}
            title={`${formatTime(seg.startTime)} · play from here`}
          >
            {asLine(textOf(seg))}
          </span>
        </React.Fragment>
      ))}
    </div>
  );

  /** Every passage, not just those shown, as a Word table: the original's paragraph left, the dub's right. */
  const [savingWord, setSavingWord] = useState(false);
  const [wordSize, setWordSize] = useState<WordParagraphSize>(loadWordParagraphSize);
  const [wordError, setWordError] = useState<string | null>(null);
  const saveWord = async () => {
    setSavingWord(true);
    setWordError(null);
    const build = async () =>
      new Blob(
        [
          await buildScriptDocx({
            title: exportTitle || `${targetLanguage || 'Dub'} script`,
            sourceLanguage,
            targetLanguage,
            rows: scriptDocxRows(segments, getSourceText, getTargetText, passagePause, wordSize),
          }),
        ],
        { type: DOCX_MIME }
      );
    try {
      await saveFileAs(build, scriptDocxFileName(targetLanguage), { description: 'Word document', mime: DOCX_MIME, extension: '.docx' });
    } catch (err) {
      console.warn('Saving the Word script failed:', err);
      setWordError(`Couldn't save the Word file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingWord(false);
    }
  };

  const markClass = (p: LinePacing) =>
    p.level === 'fast' ? 'bg-rose-500/25 rounded-sm' : p.level === 'tight' ? 'bg-amber-400/15 rounded-sm' : '';

  return (
    <div ref={rootRef}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 border-b border-slate-800 text-[11px] text-slate-400">
        <span title="A new passage starts where the original speaker pauses this long, or the speaker changes">
          Split at original pauses over
        </span>
        <div role="group" aria-label="Pause that starts a passage" className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5 gap-0.5">
          {PASSAGE_PAUSES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={passagePause === p}
              onClick={() => onPassagePauseChange(p)}
              className={`px-2 py-0.5 rounded-md font-mono tabular-nums cursor-default transition-colors ${
                passagePause === p ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {p}s
            </button>
          ))}
        </div>
        <div role="group" aria-label="Passage layout" className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5 gap-0.5">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={layout === l.id}
              onClick={() => changeLayout(l.id)}
              title={l.title}
              className={`px-2 py-0.5 rounded-md cursor-default transition-colors ${
                layout === l.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={saveWord}
          disabled={savingWord}
          className="h-6 px-2 rounded-md border border-slate-800 flex items-center gap-1 font-medium text-slate-400 hover:text-slate-200 transition-colors cursor-default disabled:opacity-50"
          title={`Save as a Word file: the script in paragraphs, ${sourceLanguage || 'the original'} on the left, ${targetLanguage || 'the dub'} on the right`}
        >
          <Download className="w-3 h-3" />
          Word
        </button>
        <div role="group" aria-label="Word paragraph size" className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5 gap-0.5">
          {WORD_PARAGRAPH_SIZES.map((size) => (
            <button
              key={size.id}
              type="button"
              aria-pressed={wordSize === size.id}
              onClick={() => {
                setWordSize(size.id);
                saveWordParagraphSize(size.id);
              }}
              title={`Word file: ${size.hint}`}
              className={`px-2 py-0.5 rounded-md cursor-default transition-colors ${
                wordSize === size.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {size.label}
            </button>
          ))}
        </div>
        {wordError && <span className="text-rose-300">{wordError}</span>}
        <span className="ml-auto text-slate-500">
          {layout === 'lines' ? 'One line per cue · Esc undoes the cell' : 'Click a line to play from it · edit in Lines'}
        </span>
        {layout === 'lines' && (
        <button
          type="button"
          onClick={phonetic.toggle}
          aria-pressed={phonetic.enabled}
          className={`h-6 px-2 rounded-md border flex items-center gap-1 font-medium transition-colors cursor-default ${
            phonetic.enabled ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300' : 'border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
          title={`Type Roman letters and get ${langConfig.nativeName} as you go (Ctrl+G)`}
        >
          <Keyboard className="w-3 h-3" />
          Phonetic {phonetic.enabled ? langConfig.nativeName : 'off'}
        </button>
        )}
      </div>
      <div className="p-3 sm:p-4">
      <table className="w-full table-fixed border-collapse text-slate-200" style={{ fontSize: `${fontSize}px` }}>
        <colgroup>
          <col className="w-[5.5rem]" />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr className="text-left text-[11px] font-semibold text-slate-400">
            <th className="border border-slate-700/70 bg-slate-950/60 px-3 py-2 font-semibold">Passage</th>
            <th className="border border-slate-700/70 bg-slate-950/60 px-3 py-2 font-semibold">{sourceLanguage || 'Original'}</th>
            <th className="border border-slate-700/70 bg-slate-950/60 px-3 py-2 font-semibold">{targetLanguage || 'Dub script'}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((passage) => {
            const { key, cues } = passage;
            const value = drafts[key] ?? savedText(cues);
            const lines = value.split('\n');
            const mismatch = lines.length !== cues.length;
            const paces = cues.map((seg, i) => getPacing(seg, lines[i] ?? ''));
            const fast = paces.filter((p) => p.level === 'fast').length;
            const tight = paces.filter((p) => p.level === 'tight').length;
            const start = cues[0].startTime;
            const end = cues[cues.length - 1].endTime;
            const playingIndex = key === activeKey ? cues.findIndex((seg) => seg.id === activeSegmentId) : -1;
            const playingHere = playingIndex !== -1 && isPlaying;
            return (
              <tr key={key} data-passage={key} className={key === activeKey ? 'bg-indigo-500/[0.06]' : ''}>
                <td className="border border-slate-700/70 px-3 py-2.5 align-top text-[11px] text-slate-500">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[13px] font-semibold text-slate-200">{passage.index + 1}</span>
                    <button
                      type="button"
                      onClick={() => (playingHere ? onTogglePlay() : onPlayPassage(start, end))}
                      aria-label={playingHere ? `Pause passage ${passage.index + 1}` : `Play passage ${passage.index + 1}`}
                      title={playingHere ? 'Pause' : 'Play this passage'}
                      className={`w-7 h-7 rounded-full border flex items-center justify-center transition-colors cursor-default ${
                        playingHere
                          ? 'border-slate-300 bg-slate-100 text-slate-900'
                          : 'border-slate-700 text-slate-300 hover:border-slate-400 hover:text-white'
                      }`}
                    >
                      {playingHere ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current ml-px" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSeek(start)}
                    className="mt-1 block text-left font-mono tabular-nums leading-relaxed hover:text-indigo-300 cursor-default"
                    title="Play this passage"
                  >
                    {formatTime(start)}
                    <br />
                    {formatTime(end)}
                  </button>
                  <div className="mt-1">
                    {cues.length} {cues.length === 1 ? 'line' : 'lines'}
                  </div>
                  {fast > 0 && <div className="mt-1 text-rose-300">{fast} too fast</div>}
                  {tight > 0 && <div className="mt-0.5 text-amber-300/90">{tight} tight</div>}
                </td>

                {layout === 'paragraph' ? (
                  <>
                    <td className="border border-slate-700/70 align-top text-slate-400">
                      {paragraph(cues, getSourceText, sourceLanguage)}
                    </td>
                    <td className="border border-slate-700/70 align-top text-slate-100">
                      {paragraph(cues, getTargetText, targetLanguage)}
                      {drafts[key] !== undefined && (
                        <div className="px-3 pb-2.5 text-[11.5px] text-amber-300/90">Unsaved changes in Lines</div>
                      )}
                    </td>
                  </>
                ) : (
                <>
                <td className="border border-slate-700/70 align-top text-slate-400">
                  <div className="relative">
                  {playingIndex !== -1 && <PlayingLineBar index={playingIndex} text={value} />}
                  <div data-lines className={CELL_TEXT} lang={sourceLanguage || undefined}>
                    {cues.map((seg) => (
                      <div
                        key={String(seg.id)}
                        onClick={() => window.getSelection()?.isCollapsed && onSeek(seg.startTime)}
                        className={`relative cursor-default transition-colors duration-[450ms] hover:text-slate-200 ${seg.id === activeSegmentId ? 'text-white' : ''}`}
                        title={`${formatTime(seg.startTime)} · play from here`}
                      >
                        {asLine(getSourceText(seg)) || ' '}
                      </div>
                    ))}
                  </div>
                  </div>
                </td>

                <td className="border border-slate-700/70 align-top p-0 focus-within:outline focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-indigo-500">
                  <div className="relative grid" lang={targetLanguage || undefined}>
                    {playingIndex !== -1 && <PlayingLineBar index={playingIndex} text={value} />}
                    {/* The same text, invisible, behind the textarea: it sizes the cell, carries the pace marks and places the playing bar. */}
                    <div data-lines aria-hidden className={`${CELL_TEXT} [grid-area:1/1] text-transparent pointer-events-none select-none`}>
                      {lines.map((line, i) => (
                        <div key={i}>
                          {/* An empty line still takes a line's height, as it does in the textarea. */}
                          <span className={i < cues.length ? markClass(paces[i]) : ''}>{line || '\u200b'}</span>
                        </div>
                      ))}
                    </div>
                    <textarea
                      value={value}
                      spellCheck={false}
                      rows={1}
                      onFocus={(e) => {
                        typingRef.current = { ta: e.currentTarget, key };
                        setEditing(key);
                      }}
                      onChange={(e) => setDraft(key)(e.target.value)}
                      onBlur={() => {
                        phonetic.dismiss();
                        setEditing(null);
                        if (discardingRef.current === key) discardingRef.current = null;
                        else commit(key, cues);
                      }}
                      onKeyUp={phonetic.onKeyUp}
                      data-review-text
                      onKeyDown={(e) => {
                        if (phonetic.onKeyDown(e, setDraft(key))) return;
                        // Ctrl+Z first throws away what is being typed here; once the cell is as saved, it steps back the script's history.
                        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && drafts[key] !== undefined) {
                          e.preventDefault();
                          dropDraft(key);
                          return;
                        }
                        if (e.key === 'Escape') {
                          discardingRef.current = key;
                          dropDraft(key);
                          e.currentTarget.blur();
                        }
                      }}
                      aria-label={`Passage ${passage.index + 1}, ${targetLanguage || 'dub script'}, one line per cue`}
                      className={`${CELL_TEXT} relative [grid-area:1/1] w-full h-full resize-none overflow-hidden bg-transparent text-slate-100 outline-none caret-indigo-300`}
                    />
                  </div>
                  {mismatch && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2.5 text-[11.5px] text-rose-300">
                      <span>
                        {lines.length} lines here, this passage has {cues.length} {cues.length === 1 ? 'cue' : 'cues'}. Make
                        it one line per cue to save.
                      </span>
                      <button
                        type="button"
                        onClick={() => dropDraft(key)}
                        className="text-slate-300 underline underline-offset-2 hover:text-slate-100 cursor-default"
                      >
                        Undo changes
                      </button>
                    </div>
                  )}
                </td>
                </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {/* Signs that are awkward to spell in Roman letters, while a cell is being typed in. */}
      {editing && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-1 px-4 py-2 border-t border-slate-800 bg-slate-950/95 backdrop-blur-sm">
          <span className="mr-1.5 text-[11px] text-slate-500">Signs</span>
          {signs.map((sign) => (
            <button
              key={sign}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // keeps the caret in the cell
                insertSign(sign);
              }}
              className="min-w-[2rem] h-8 px-1.5 rounded-md border border-slate-800 bg-slate-900 text-slate-100 text-base hover:border-indigo-500/40 hover:bg-indigo-500/10 cursor-default"
              lang={targetLanguage || undefined}
            >
              {/* Vowel signs sit on a placeholder circle, as on a keyboard. */}
              {palette.matras.includes(sign) ? `◌${sign}` : sign}
            </button>
          ))}
        </div>
      )}

      {/* Suggestions for the Roman word at the caret */}
      {phonetic.popup && typingRef.current && (
        <div
          role="listbox"
          aria-label={`Spellings of ${phonetic.popup.word}`}
          className="fixed z-50 min-w-[12rem] max-w-[22rem] rounded-xl border border-slate-700 bg-slate-950 p-1.5 shadow-2xl shadow-black/60"
          style={{ left: Math.min(phonetic.popup.x - 8, window.innerWidth - 360), top: phonetic.popup.y + 4 }}
        >
          <div className="px-1 pb-1 font-mono text-[11px] text-slate-500">{phonetic.popup.word}</div>
          <div className="flex flex-wrap gap-1" lang={targetLanguage || undefined}>
            {phonetic.popup.suggestions.map((s, i) => (
              <button
                key={`${i}-${s}`}
                type="button"
                role="option"
                aria-selected={i === phonetic.popup!.selected}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const typing = typingRef.current;
                  if (typing) phonetic.pick(typing.ta, setDraft(typing.key), i);
                }}
                className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[15px] cursor-default ${
                  i === phonetic.popup!.selected ? 'bg-indigo-500/25 text-white' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span className="font-mono text-[10px] text-slate-500">{i + 1}</span>
                {s}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex gap-3 border-t border-slate-800 px-1 pt-1 text-[10.5px] text-slate-500">
            <span>Space use</span>
            <span>1–5 pick</span>
            <span>Esc keep English</span>
          </div>
        </div>
      )}
    </div>
  );
}

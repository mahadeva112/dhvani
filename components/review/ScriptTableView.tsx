import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, Download, Keyboard, Languages, Loader2, Pause, Play } from 'lucide-react';
import { AudioSegment } from '../../types';
import { scrollWithin } from '../scrollWithin';
import { SCRIPT_PALETTES, getIndicLanguageConfig, transliterateTextSmart, transliterateWordOffline } from '../../services/indicTransliteration';
import { polishIndicDialogueWithAI } from '../../services/geminiService';
import { buildScriptParagraphs, scriptParagraphSeconds } from './passages';
import { usePhoneticTyping, type PhoneticField } from './usePhoneticTyping';
import { inlineField, placeCaret } from './inlineField';
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
  /** The sync line the cue is in, when the pace is that line's Sync fit: its cues are counted once. */
  lineKey?: string;
  /** Seconds the line ends before the original speaker stops, when it ends early. */
  endsEarlyBy: number | null;
}

const formatTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

const formatLength = (sec: number) => (sec >= 90 ? `${Math.round(sec / 60)} min` : `${Math.round(sec)} s`);

/** A cue's text as one sentence of the paragraph; a cue is one line, so a break inside it is read as a space. */
const asLine = (text: string) => text.replace(/\s*\n\s*/g, ' ');

const CELL_TEXT = 'px-3 py-2.5 leading-[1.75] break-words [overflow-wrap:anywhere]';

// The light wash on the line being heard.
const PLAYING_WASH = 'bg-amber-200/[0.14]';

/**
 * A dub sentence typed straight into, as in a document. The browser keeps the
 * text while it is typed; only a change from outside (a phonetic word, a sign,
 * an undo) is written back into it, so the caret is never disturbed by typing.
 */
function InlineLine({ text, cueId, ...rest }: { text: string; cueId: string } & Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== text) el.textContent = text;
  }, [text]);
  return (
    <span
      ref={ref}
      data-dub-cue={cueId}
      data-review-text
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      {...rest}
    />
  );
}

interface ScriptTableViewProps {
  segments: AudioSegment[];
  /** Paragraphs shown: those with at least one of these cues, so search and the pacing filter still narrow the table. */
  visibleIds: Set<string>;
  sourceLanguage: string;
  targetLanguage: string;
  getSourceText: (seg: AudioSegment) => string;
  getTargetText: (seg: AudioSegment) => string;
  /** Writes several cues' dub lines in one change. */
  onUpdateLines: (lines: { id: string | number; text: string }[]) => void;
  /** How a line fits its cue, worked out from the text being typed. */
  getPacing: (seg: AudioSegment, text: string) => LinePacing;
  /** What the lines marked fast are called: "too fast" by characters, "too long" by the Sync fit. */
  fastLabel?: string;
  /** The pause the Word file's short passages split at, set in the Cues table. */
  passagePause: number;
  activeSegmentId: string | number | null;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  /** Plays the original from a paragraph's start and stops at its end. */
  onPlayPassage: (start: number, end: number) => void;
  onTogglePlay: () => void;
  fontSize?: number;
  /** The Word file's heading, e.g. the media's name. */
  exportTitle?: string;
  /** The Word file's name without ".docx": the project's name. */
  exportFileStem: string;
  /** Opens the on-screen phonetic keyboard on a line, as from a cue in the Cues table. */
  onOpenKeyboard?: (seg: AudioSegment) => void;
}

/**
 * The script as a plain table of long paragraphs, sized from the script's
 * length: the original's running text beside the dub's, which is typed
 * straight into like a document. Each sentence stays its own cue's line,
 * saved a second after typing stops and when the caret leaves it.
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
  fastLabel = 'too fast',
  passagePause,
  activeSegmentId,
  isPlaying,
  onSeek,
  onPlayPassage,
  onTogglePlay,
  fontSize = 15,
  exportTitle,
  exportFileStem,
  onOpenKeyboard,
}: ScriptTableViewProps) {
  // The getter is a new function each render; the paragraphs only change with the cues.
  const sourceOf = useRef(getSourceText);
  sourceOf.current = getSourceText;
  const passages = useMemo(() => buildScriptParagraphs(segments, (seg) => sourceOf.current(seg)), [segments]);
  const paragraphLength = useMemo(() => scriptParagraphSeconds(segments), [segments]);
  const shown = passages.filter((p) => p.cues.some((seg) => visibleIds.has(String(seg.id))));
  const multiSpeaker = useMemo(() => new Set(segments.map((seg) => seg.speaker || '')).size > 1, [segments]);

  // The dub line being typed in: what it says now, and what was last saved of it.
  const [edit, setEdit] = useState<{ id: string; text: string; base: string } | null>(null);
  const editRef = useRef(edit);
  editRef.current = edit;
  const rootRef = useRef<HTMLDivElement>(null);
  // The line being typed in, so the signs row can write at its caret.
  const typingRef = useRef<{ field: PhoneticField; key: string } | null>(null);
  // Set by Esc: the blur that follows must not save the text it is throwing away.
  const discardingRef = useRef<string | null>(null);
  // The line that last lost focus, so opening the next one doesn't save it twice.
  const closedRef = useRef<string | null>(null);
  const autosave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const phonetic = usePhoneticTyping(targetLanguage);
  const langConfig = getIndicLanguageConfig(targetLanguage);
  const palette = SCRIPT_PALETTES[langConfig.script] || SCRIPT_PALETTES.Devanagari;
  const signs = [...palette.matras, langConfig.purnaViram || '।', '॥', '₹'];

  const savedOf = (seg: AudioSegment) => asLine(getTargetText(seg));
  const segOf = (id: string) => segments.find((s) => String(s.id) === id);

  /** Writes a line to its cue; `finished` also drops the space a word ended with Enter leaves behind. */
  const save = (seg: AudioSegment, typed: string, finished: boolean) => {
    const text = finished ? typed.replace(/\s+$/, '') : typed;
    if (text !== savedOf(seg)) onUpdateLines([{ id: seg.id, text }]);
    return text;
  };

  // What the unmount needs, as it is now.
  const latest = useRef({ save, segOf });
  latest.current = { save, segOf };
  useEffect(
    () => () => {
      clearTimeout(autosave.current);
      const e = editRef.current;
      const seg = e && closedRef.current !== e.id ? latest.current.segOf(e.id) : undefined;
      if (e && seg) latest.current.save(seg, e.text, true);
    },
    []
  );

  /** Takes what is typed: a cue is one line, so a line break becomes a space. Saved a second after typing stops. */
  const typed = (id: string) => (raw: string) => {
    const text = raw.replace(/[ \t]*\n[ \t]*/g, ' ');
    setEdit((e) => (e && e.id === id ? { ...e, text } : e));
    clearTimeout(autosave.current);
    autosave.current = setTimeout(() => {
      const e = editRef.current;
      const seg = e && e.id === id ? segOf(id) : undefined;
      if (!e || !seg) return;
      save(seg, e.text, false);
      setEdit((cur) => (cur && cur.id === id ? { ...cur, base: e.text } : cur));
    }, 1000);
  };

  // A change from outside (Ctrl+Z through the script's history) reaches the line being typed in, when nothing is waiting to be saved.
  useEffect(() => {
    const e = editRef.current;
    const seg = e ? segOf(e.id) : undefined;
    if (!e || !seg || e.text !== e.base) return;
    const saved = savedOf(seg);
    if (saved !== e.base) setEdit({ ...e, text: saved, base: saved });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments]);

  /** Writes a sign at the caret of the line being typed in. */
  const insertSign = (sign: string) => {
    const typing = typingRef.current;
    if (!typing) return;
    const { field, key } = typing;
    const start = field.selectionStart;
    typed(key)(field.value.substring(0, start) + sign + field.value.substring(field.selectionEnd));
    setTimeout(() => field.setSelectionRange(start + sign.length, start + sign.length), 0);
  };

  /** Starts typing in a line; one still open (it never lost focus) is saved first. */
  const open = (seg: AudioSegment) => {
    const id = String(seg.id);
    const e = editRef.current;
    if (e?.id === id) return;
    const prev = e && closedRef.current !== e.id ? segOf(e.id) : undefined;
    if (e && prev) save(prev, e.text, true);
    clearTimeout(autosave.current);
    closedRef.current = null;
    const saved = savedOf(seg);
    setEdit({ id, text: saved, base: saved });
  };

  const close = (seg: AudioSegment) => {
    const id = String(seg.id);
    clearTimeout(autosave.current);
    phonetic.dismiss();
    if (typingRef.current?.key === id) typingRef.current = null;
    const e = editRef.current;
    closedRef.current = id;
    setEdit((cur) => (cur && cur.id === id ? null : cur));
    if (discardingRef.current === id) discardingRef.current = null;
    else if (e && e.id === id) save(seg, e.text, true);
  };

  /** The dub lines on the page, in reading order. */
  const allLines = () => Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-dub-cue]') ?? []);
  const step = (from: HTMLElement, by: 1 | -1, at: 'start' | 'end') => {
    const lines = allLines();
    const next = lines[lines.indexOf(from) + by];
    if (!next) return false;
    placeCaret(next, at === 'start' ? 0 : (next.textContent || '').length);
    return true;
  };

  const onLineKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>, seg: AudioSegment) => {
    const id = String(seg.id);
    const el = e.currentTarget;
    const field = inlineField(el);
    // Ctrl+Space plays and pauses without leaving the line, so it can be heard while it is typed:
    // from this line's start (to its paragraph's end), or on from where it was paused inside this line.
    if (e.key === ' ' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      phonetic.dismiss();
      if (isPlaying || seg.id === activeSegmentId) {
        onTogglePlay();
      } else {
        const passage = passages.find((p) => p.cues.some((c) => c.id === seg.id));
        onPlayPassage(seg.startTime, passage ? passage.cues[passage.cues.length - 1].endTime : seg.endTime);
      }
      return;
    }
    if (phonetic.onKeyDown(e, typed(id), field)) return;
    const cur = editRef.current;
    // Ctrl+Z first takes back what was typed since the line last saved; after that it steps back the script's history.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && cur && cur.id === id && cur.text !== cur.base) {
      e.preventDefault();
      clearTimeout(autosave.current);
      setEdit({ ...cur, text: cur.base });
      setTimeout(() => placeCaret(el, cur.base.length), 0);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      discardingRef.current = id;
      el.blur();
      return;
    }
    if (e.key === 'Enter') {
      // A cue is one line: Enter goes on to the next one.
      e.preventDefault();
      if (!step(el, 1, 'start')) el.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const at = field.selectionStart;
    const collapsed = at === field.selectionEnd;
    const end = field.value.length;
    // The caret runs on from one sentence into the next, as in a document; nothing is ever joined or cut.
    if (collapsed && (e.key === 'ArrowRight' || e.key === 'Delete') && at === end) {
      if (step(el, 1, 'start')) e.preventDefault();
    } else if (collapsed && (e.key === 'ArrowLeft' || e.key === 'Backspace') && at === 0) {
      if (step(el, -1, 'end')) e.preventDefault();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Up and down move within the sentence; at its first or last row they go on to the one before or after.
      setTimeout(() => {
        if (document.activeElement === el && field.selectionStart === at) step(el, e.key === 'ArrowDown' ? 1 : -1, e.key === 'ArrowDown' ? 'start' : 'end');
      }, 0);
    }
  };

  // The line last highlighted, by playback, a click in the original or typing: a paragraph's play
  // button plays on from it. A paragraph heard to its end forgets it, so the next play starts the paragraph over.
  const resumeRef = useRef<string | null>(null);
  const wasPlaying = useRef(isPlaying);
  useEffect(() => {
    if (activeSegmentId != null) resumeRef.current = String(activeSegmentId);
  }, [activeSegmentId]);
  useEffect(() => {
    if (edit) resumeRef.current = edit.id;
  }, [edit?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (wasPlaying.current && !isPlaying) {
      const p = passages.find((q) => q.cues.some((c) => String(c.id) === resumeRef.current));
      if (p && String(p.cues[p.cues.length - 1].id) === resumeRef.current && activeSegmentId == null) resumeRef.current = null;
    }
    wasPlaying.current = isPlaying;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);
  /** Plays a paragraph from the line last highlighted in it, or from its start. */
  const playParagraph = (cues: AudioSegment[]) => {
    const from = cues.find((c) => String(c.id) === resumeRef.current) ?? cues[0];
    onPlayPassage(from.startTime, cues[cues.length - 1].endTime);
  };

  // Follow playback to the paragraph being heard, but never while someone is typing.
  const activeKey = useMemo(
    () => passages.find((p) => p.cues.some((seg) => seg.id === activeSegmentId))?.key ?? null,
    [passages, activeSegmentId]
  );
  useEffect(() => {
    if (!isPlaying || activeSegmentId == null || edit) return;
    // Paragraphs run for minutes, so it is the line being heard that is kept in view, not the row.
    scrollWithin(rootRef.current?.querySelector(`[data-src-cue="${CSS.escape(String(activeSegmentId))}"]`), 'nearest', true);
  }, [activeSegmentId, isPlaying, edit]);

  /** Where the speaker changes inside a paragraph, their name before their first line. */
  const speakerMark = (cues: AudioSegment[], i: number) =>
    multiSpeaker && cues[i].speaker && (i === 0 || (cues[i - 1].speaker || '') !== cues[i].speaker) ? (
      <span contentEditable={false} className="mr-1 select-none rounded bg-slate-800/80 px-1 py-px text-[10.5px] font-semibold text-slate-400">
        {cues[i].speaker}
      </span>
    ) : null;

  /** The original as running text: each cue's line flows on from the last, the one being heard washed. */
  const sourceParagraph = (cues: AudioSegment[]) => (
    <div className={CELL_TEXT} lang={sourceLanguage || undefined}>
      {cues.map((seg, i) => (
        <React.Fragment key={String(seg.id)}>
          {i > 0 && ' '}
          {speakerMark(cues, i)}
          <span
            data-src-cue={String(seg.id)}
            onClick={() => window.getSelection()?.isCollapsed && onSeek(seg.startTime)}
            className={`rounded-sm [box-decoration-break:clone] cursor-default transition-colors duration-[450ms] motion-reduce:transition-none ${
              seg.id === activeSegmentId
                ? `${PLAYING_WASH} text-white shadow-[inset_0_-2px_0_rgb(252_211_77/0.7)]`
                : edit?.id === String(seg.id)
                  ? 'bg-indigo-400/[0.18] text-white shadow-[inset_0_-2px_0_rgb(165_180_252/0.8)]'
                  : 'hover:bg-white/[0.06] hover:text-slate-100'
            }`}
            title={`${formatTime(seg.startTime)} · play from here`}
          >
            {asLine(getSourceText(seg))}
          </span>
        </React.Fragment>
      ))}
    </div>
  );

  const markClass = (p: LinePacing) => (p.level === 'fast' ? 'bg-rose-500/25' : p.level === 'tight' ? 'bg-amber-400/15' : '');

  /**
   * The dub as running text typed straight into, like a document: click
   * anywhere in a sentence and type there. Each sentence is its cue's line,
   * so typing never joins two cues or splits one.
   */
  const dubParagraph = (cues: AudioSegment[], paces: LinePacing[], passageNumber: number) => (
    <div className={CELL_TEXT} lang={targetLanguage || undefined}>
      {cues.map((seg, i) => {
        const id = String(seg.id);
        const typing = edit?.id === id;
        return (
          <React.Fragment key={id}>
            {i > 0 && ' '}
            {speakerMark(cues, i)}
            <InlineLine
              cueId={id}
              text={typing && edit ? edit.text : savedOf(seg)}
              aria-label={`Paragraph ${passageNumber}, line at ${formatTime(seg.startTime)}, ${targetLanguage || 'dub script'}`}
              title={`${formatTime(seg.startTime)}–${formatTime(seg.endTime)}`}
              onFocus={(e) => {
                // While nothing plays, the player moves to the line clicked into: its original is
                // highlighted beside it, and play starts there. Playing on is never interrupted.
                if (!isPlaying && seg.id !== activeSegmentId) onSeek(seg.startTime);
                open(seg);
                typingRef.current = { field: inlineField(e.currentTarget), key: id };
              }}
              onInput={(e) => typed(id)(e.currentTarget.textContent || '')}
              onBlur={() => close(seg)}
              onPaste={(e) => {
                // Pasted text joins the line as words: no line breaks, no formatting.
                e.preventDefault();
                document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' '));
              }}
              onKeyDown={(e) => onLineKeyDown(e, seg)}
              onKeyUp={(e) => phonetic.onKeyUp(e, inlineField(e.currentTarget))}
              className={`rounded-sm [box-decoration-break:clone] cursor-text outline-none caret-indigo-300 transition-colors duration-[450ms] motion-reduce:transition-none empty:inline-block empty:min-w-[3ch] empty:align-bottom empty:h-[1.4em] empty:border-b empty:border-dashed empty:border-slate-600 ${markClass(
                paces[i]
              )} ${
                seg.id === activeSegmentId && !typing
                  ? `${PLAYING_WASH} text-white shadow-[inset_0_-2px_0_rgb(252_211_77/0.7)]`
                  : typing
                    ? 'bg-indigo-400/[0.10] text-white'
                    : 'hover:bg-white/[0.04]'
              }`}
            />
          </React.Fragment>
        );
      })}
    </div>
  );

  // The line being typed in, for the bar along the bottom.
  const editSeg = edit ? segOf(edit.id) : undefined;
  const editPace = edit && editSeg ? getPacing(editSeg, edit.text) : null;

  // The Cues table's line tools: every Roman word at once, and AI polish, opt-in as there.
  const [aiPolishOn, setAiPolishOn] = useState(false);
  const [lineBusy, setLineBusy] = useState<'convert' | 'polish' | null>(null);
  const [lineNote, setLineNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(noteTimer.current), []);
  const showNote = (note: string) => {
    setLineNote(note);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setLineNote(null), 4000);
  };
  /** Puts a whole new text in a line: into the typing when it is still open, else straight into its cue. */
  const replaceLine = (id: string, text: string) => {
    const seg = segOf(id);
    if (!seg) return;
    if (editRef.current?.id === id) {
      typed(id)(text);
      setTimeout(() => {
        const el = rootRef.current?.querySelector<HTMLElement>(`[data-dub-cue="${CSS.escape(id)}"]`);
        if (el && document.activeElement === el) placeCaret(el, text.length);
      }, 0);
    } else if (text !== savedOf(seg)) onUpdateLines([{ id: seg.id, text }]);
  };
  const convertLine = async () => {
    const e = editRef.current;
    if (!e || lineBusy) return;
    setLineBusy('convert');
    let text: string;
    try {
      text = await transliterateTextSmart(e.text, targetLanguage);
    } catch {
      text = transliterateWordOffline(e.text, targetLanguage);
    } finally {
      setLineBusy(null);
    }
    // Typing on while it converted keeps what was typed.
    if (editRef.current?.id === e.id && editRef.current.text !== e.text) return;
    replaceLine(e.id, asLine(text));
  };
  const polishLine = async () => {
    const e = editRef.current;
    if (!e || !e.text.trim() || lineBusy) return;
    setLineBusy('polish');
    try {
      const res = await polishIndicDialogueWithAI(e.text, langConfig.name, `Dialogue cue for Indic dubbing in ${langConfig.nativeName}`);
      if (editRef.current?.id === e.id && editRef.current.text !== e.text) return;
      if (res.correctedText) {
        replaceLine(e.id, asLine(res.correctedText));
        showNote(res.notes || `Polished ${langConfig.nativeName} spelling and nuances`);
      }
    } catch {
      showNote('AI Polish unavailable. Check internet or API key.');
    } finally {
      setLineBusy(null);
    }
  };
  // Bar buttons keep the caret in the line.
  const keepCaret = (e: React.MouseEvent) => e.preventDefault();
  const barButton = 'h-7 px-2 rounded-md border flex items-center gap-1 text-[11px] font-medium transition-colors cursor-default disabled:opacity-50';

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
      await saveFileAs(build, scriptDocxFileName(exportFileStem), { description: 'Word document', mime: DOCX_MIME, extension: '.docx' });
    } catch (err) {
      console.warn('Saving the Word script failed:', err);
      setWordError(`Couldn't save the Word file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingWord(false);
    }
  };

  return (
    <div ref={rootRef}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 border-b border-edge text-[11px] text-slate-400">
        <span title="Paragraphs are sized from the script's length (a sixth of it, between one and three minutes) and end where the original pauses">
          Paragraphs of about {formatLength(paragraphLength)} · {passages.length} {passages.length === 1 ? 'paragraph' : 'paragraphs'}
        </span>
        <button
          type="button"
          onClick={saveWord}
          disabled={savingWord}
          className="h-6 px-2 rounded-md border border-edge flex items-center gap-1 font-medium text-slate-400 hover:text-slate-200 transition-colors cursor-default disabled:opacity-50"
          title={`Save as a Word file: the script in paragraphs, ${sourceLanguage || 'the original'} on the left, ${targetLanguage || 'the dub'} on the right`}
        >
          <Download className="w-3 h-3" />
          Word
        </button>
        <div role="group" aria-label="Word paragraph size" className="flex bg-slate-950 border border-edge rounded-lg p-0.5 gap-0.5">
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
        <span className="ml-auto text-slate-500">Type straight into the dub · click the original to play from there</span>
        <button
          type="button"
          onClick={phonetic.toggle}
          aria-pressed={phonetic.enabled}
          className={`h-6 px-2 rounded-md border flex items-center gap-1 font-medium transition-colors cursor-default ${
            phonetic.enabled ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300' : 'border-edge text-slate-400 hover:text-slate-200'
          }`}
          title={`Type Roman letters and get ${langConfig.nativeName} as you go (Ctrl+G)`}
        >
          <Keyboard className="w-3 h-3" />
          Phonetic {phonetic.enabled ? langConfig.nativeName : 'off'}
        </button>
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
              <th className="border border-slate-700/70 bg-slate-950/60 px-3 py-2 font-semibold">Paragraph</th>
              <th className="border border-slate-700/70 bg-slate-950/60 px-3 py-2 font-semibold">{sourceLanguage || 'Original'}</th>
              <th className="border border-slate-700/70 bg-slate-950/60 px-3 py-2 font-semibold">{targetLanguage || 'Dub script'}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((passage) => {
              const { key, cues } = passage;
              const paces = cues.map((seg) => getPacing(seg, edit && edit.id === String(seg.id) ? edit.text : savedOf(seg)));
              const count = (level: LinePacing['level']) =>
                new Set(paces.map((p, i) => (p.level === level ? p.lineKey ?? `cue-${i}` : null)).filter(Boolean)).size;
              const fast = count('fast');
              const tight = count('tight');
              const start = cues[0].startTime;
              const end = cues[cues.length - 1].endTime;
              const playingHere = key === activeKey && isPlaying;
              return (
                <tr key={key} data-passage={key} className={key === activeKey ? 'bg-indigo-500/[0.06]' : ''}>
                  <td className="border border-slate-700/70 px-3 py-2.5 align-top text-[11px] text-slate-500">
                    <div className="sticky top-2">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[13px] font-semibold text-slate-200">{passage.index + 1}</span>
                        <button
                          type="button"
                          onClick={() => (playingHere ? onTogglePlay() : playParagraph(cues))}
                          aria-label={playingHere ? `Pause paragraph ${passage.index + 1}` : `Play paragraph ${passage.index + 1}`}
                          title={playingHere ? 'Pause' : 'Play this paragraph from the line last highlighted in it'}
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
                        title="Go to the start of this paragraph"
                      >
                        {formatTime(start)}
                        <br />
                        {formatTime(end)}
                      </button>
                      <div className="mt-1">{formatLength(Math.max(0, end - start))}</div>
                      <div className="mt-0.5">
                        {cues.length} {cues.length === 1 ? 'line' : 'lines'}
                      </div>
                      {fast > 0 && <div className="mt-1 text-rose-300">{fast} {fastLabel}</div>}
                      {tight > 0 && <div className="mt-0.5 text-amber-300/90">{tight} tight</div>}
                    </div>
                  </td>
                  <td className="border border-slate-700/70 align-top text-slate-400">{sourceParagraph(cues)}</td>
                  <td className="border border-slate-700/70 align-top text-slate-100">{dubParagraph(cues, paces, passage.index + 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* While a line is typed in: where it is, how it fits, and signs that are awkward to spell in Roman letters. */}
      {edit && editSeg && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-1 px-4 py-2 border-t border-edge bg-slate-950/95 backdrop-blur-sm">
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSeek(editSeg.startTime)}
            className="mr-1 font-mono text-[11px] tabular-nums text-slate-400 hover:text-indigo-300 cursor-default"
            title="Go to this line in the original"
          >
            {formatTime(editSeg.startTime)}–{formatTime(editSeg.endTime)}
          </button>
          {editPace?.level === 'fast' && <span className="mr-1 text-[11px] text-rose-300">{fastLabel}</span>}
          {editPace?.level === 'tight' && <span className="mr-1 text-[11px] text-amber-300/90">tight</span>}
          {phonetic.enabled && /[a-zA-Z]{2,}/.test(edit.text) && (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={keepCaret}
              onClick={convertLine}
              disabled={lineBusy !== null}
              className={`${barButton} border-edge text-slate-300 hover:text-slate-100 hover:bg-slate-800`}
              title="Turn every English-letter word in this line into the script"
            >
              {lineBusy === 'convert' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Languages className="w-3 h-3" />}
              Convert all
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={keepCaret}
            onClick={() => setAiPolishOn((on) => !on)}
            aria-pressed={aiPolishOn}
            className={`${barButton} ${
              aiPolishOn ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'border-edge text-slate-400 hover:text-slate-200'
            }`}
            title="Let the translation engine fix vowel signs, joined letters and wording in this line"
          >
            <CheckCheck className="w-3 h-3" />
            AI polish {aiPolishOn ? 'on' : 'off'}
          </button>
          {aiPolishOn && (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={keepCaret}
              onClick={polishLine}
              disabled={lineBusy !== null || !edit.text.trim()}
              className={`${barButton} border-transparent bg-emerald-600 hover:bg-emerald-500 text-white font-semibold`}
            >
              {lineBusy === 'polish' ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" /> Polishing…
                </>
              ) : (
                'Polish this line'
              )}
            </button>
          )}
          {onOpenKeyboard && (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={keepCaret}
              onClick={() => {
                // The line is saved first, so the keyboard adds to what is typed in it.
                rootRef.current?.querySelector<HTMLElement>(`[data-dub-cue="${CSS.escape(edit.id)}"]`)?.blur();
                onOpenKeyboard(editSeg);
              }}
              className={`${barButton} border-edge text-slate-400 hover:text-slate-100 hover:bg-slate-800`}
              title="Open the on-screen keyboard on this line"
            >
              <Keyboard className="w-3 h-3" />
              Keyboard
            </button>
          )}
          {lineNote && <span className="mx-1 text-[11px] text-emerald-300">{lineNote}</span>}
          <span className="mx-1.5 text-[11px] text-slate-500">Signs</span>
          {signs.map((sign) => (
            <button
              key={sign}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // keeps the caret in the line
                insertSign(sign);
              }}
              className="min-w-[2rem] h-8 px-1.5 rounded-md border border-edge bg-slate-900 text-slate-100 text-base hover:border-indigo-500/40 hover:bg-indigo-500/10 cursor-default"
              lang={targetLanguage || undefined}
            >
              {/* Vowel signs sit on a placeholder circle, as on a keyboard. */}
              {palette.matras.includes(sign) ? `◌${sign}` : sign}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-slate-500">Ctrl+Space play this line / pause · Saves as you type · Enter next line · Esc throws away unsaved typing</span>
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
                  if (typing) phonetic.pick(typing.field, typed(typing.key), i);
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
          <div className="mt-1.5 flex gap-3 border-t border-edge px-1 pt-1 text-[10.5px] text-slate-500">
            <span>Space use</span>
            <span>1–5 pick</span>
            <span>Esc keep English</span>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Headphones, Keyboard, Loader2, Lock, Mic, Pause, Pencil, Play, Plus, RotateCcw, Search, Tag, Trash2, X } from 'lucide-react';
import type { LineSuggestion, SyncUnitReport } from '../services/syncService';
import type { RewriteDirection } from './SyncPreviewPanel';
import { reportError } from '../services/errorPopup';
import { dotsToPauses, PAUSE_MARK, pauseSeconds, stripPauses } from '../server/lib/linePauses.js';
import { isTagName, stripTags, TAG_LIBRARY, TAG_MARK, tagProblems, tagsOf } from '../server/lib/lineTags.js';
import { useTagPrefs } from '../services/tagPrefs';
import { TagTextarea, type TagTextareaHandle } from './TagTextarea';
import { usePhoneticTyping } from './review/usePhoneticTyping';
import { getIndicLanguageConfig } from '../services/indicTransliteration';
import type { TakeWord } from '../services/takeRange';
import {
  phraseLine,
  phraseOf,
  SYNC_TAKE_ID,
  TAKE_COUNTS,
  TAKE_DIRECTIONS,
  TAKE_STABILITIES,
  takeFit,
  takeWav,
  TAKES_PER_ASK,
  wordsOf,
  type LineTakes,
  type SyncTake,
  type TakeAsk,
  type TakeDirection,
  type TakeFit,
} from '../services/syncTakesService';

const TONE: Record<TakeFit['tone'], string> = {
  fits: 'bg-emerald-400/12 text-emerald-300',
  short: 'bg-sky-400/12 text-sky-300',
  over: 'bg-amber-400/12 text-amber-300',
  cut: 'bg-rose-400/12 text-rose-300',
};

const directionLabel = (direction?: TakeDirection) => TAKE_DIRECTIONS.find((d) => d.id === direction)?.label ?? 'Same';

/** A typed tag as a chip, as the take list and the wordings show it. */
const TagChip: React.FC<{ tag: string }> = ({ tag }) => (
  <span className="mx-0.5 inline-flex items-center rounded px-1 font-mono text-[10.5px] bg-indigo-500/20 text-indigo-200 align-middle" title="A tag: read by the voice, kept out of the script">
    [{tag}]
  </span>
);

/** A wording with its pause marks and typed tags shown as chips, as the voice will hear them. */
const WithPauses: React.FC<{ text: string }> = ({ text }) => {
  const parts: React.ReactNode[] = [];
  let at = 0;
  const marks = [...text.matchAll(PAUSE_MARK), ...text.matchAll(TAG_MARK)].sort((a, b) => a.index! - b.index!);
  for (const m of marks) {
    if (m.index! < at) continue;
    if (m.index! > at) parts.push(text.slice(at, m.index));
    parts.push(
      /^\[pause/i.test(m[0]) ? (
        <span key={m.index} className="mx-0.5 inline-flex items-center gap-0.5 rounded px-1 text-[10.5px] font-semibold tabular-nums bg-indigo-500/20 text-indigo-200 align-middle" title="A pause">
          <Pause className="w-2.5 h-2.5" /> {Number(m[1]).toFixed(1)} s
        </span>
      ) : (
        <TagChip key={m.index} tag={m[1]} />
      )
    );
    at = m.index! + m[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
};

/** Whether the voice of a line reads typed tags, and why not when it doesn't. */
export interface VoiceTags {
  on: boolean;
  note: string;
}

/** The line as it reaches the voice: tags kept where the voice reads them, pauses as it performs them. */
const sentText = (text: string, tags: boolean) =>
  (tags ? text : stripTags(text)).replace(PAUSE_MARK, tags ? '… ' : ' ').replace(/\s{2,}/g, ' ').trim();

/** What asking for wordings of a line can be: not asked, on its way, back, or failed. */
type Wordings = { kind: 'idle' } | { kind: 'working' } | { kind: 'ready'; options: LineSuggestion[] } | { kind: 'error'; message: string };

/** A request for wordings of a retake, made by the panel from its line's time. */
export interface WordingRequest {
  /** The words as they are in the panel now, pause marks and all. */
  text: string;
  direction: RewriteDirection;
  targetChars: number;
  /** Seconds the slot has to spare once the words are said: what the pauses may take. */
  pauseBudget: number;
  avoid: string[];
}

/** A take's name in the list: Sync's own, or its number among the takes asked for. */
const takeName = (take: SyncTake, index: number) => (take.id === SYNC_TAKE_ID ? "Sync's take" : `Take ${index}`);

/** Bars the take in the dub is drawn with. */
const WAVE_BARS = 240;

/** The take's loudest sample in each of `bars` stretches, 0 to 1 of its loudest: read from its samples in the bank (a plain 44-byte WAV header). */
const peaksOf = async (bankBlob: Blob, take: Pick<SyncTake, 'bankStart' | 'length'>, float: boolean, bars = WAVE_BARS) => {
  const bytes = float ? 4 : 2;
  const from = 44 + take.bankStart * bytes;
  const buffer = await bankBlob.slice(from, from + take.length * bytes).arrayBuffer();
  const data = float ? new Float32Array(buffer) : new Int16Array(buffer);
  const full = float ? 1 : 32768;
  const per = Math.max(1, Math.floor(data.length / bars));
  const peaks: number[] = [];
  for (let b = 0; b < bars; b++) {
    let top = 0;
    for (let i = b * per, end = Math.min(data.length, (b + 1) * per); i < end; i++) top = Math.max(top, Math.abs(data[i]) / full);
    peaks.push(top);
  }
  const loudest = Math.max(...peaks, 1e-4);
  return peaks.map((p) => p / loudest);
};

/** Shortened for a button. */
const short = (text: string, max = 24) => (text.length > max ? `${text.slice(0, max - 2)}…` : text);

/** Below this share of the original speech, a line's wordings are asked for fuller. */
const LONGER_BELOW = 0.8;

const WORDING_LABEL: Record<RewriteDirection, string> = { shorter: 'shorter', longer: 'longer', same: 'same length' };

/**
 * The takes of one synced line: every take of it heard side by side, Sync's
 * own among them, and the one the dub plays picked from them. New takes are
 * voiced at once, of the whole line or of only some of its words, read the
 * same or a little differently; none changes a word. A picked take is in the
 * dub within seconds, and every take stays to go back to.
 */
export const TakesPanel: React.FC<{
  unit: SyncUnitReport;
  lineNumber: number;
  lineTakes: LineTakes;
  /** Where the line's first word is now, where a picked take's first word goes. */
  firstWord: number;
  nextStart: number | null;
  tolerance: number;
  bankBlob: Blob | null | undefined;
  sampleRate: number;
  float: boolean;
  /** This line's takes are being voiced. */
  busy: boolean;
  /** Takes of some line are being voiced: one request at a time. */
  anyBusy: boolean;
  /** The line's words changed since Sync: takes would read the old words. */
  pending: boolean;
  /** Locked in Edit timing: it can still be retaken, and a take used keeps the lock. */
  locked?: boolean;
  initialPhrase?: { from: number; to: number } | null;
  /** With `text`, the whole line is voiced in those words; the script takes them only when one of the takes is used. */
  onVoice: (options: TakeAsk) => void;
  /** Whether this line's voice reads tags typed in its words. */
  voiceTags?: VoiceTags;
  /** Retake pro: the tag library, saved styles, stability and how many takes, beside the words. */
  pro?: boolean;
  /** The dub's language: phonetic typing in the words turns Roman letters into its script. */
  language?: string;
  /** Wordings of the line from the text model, asked for only when the user presses Suggest wording. */
  onSuggestWording?: (request: WordingRequest) => Promise<LineSuggestion[]>;
  onUse: (takeId: string) => void;
  /** Drops the line's takes but Sync's own and the one in the dub. */
  onClearTakes?: () => void;
  onListenInDub: () => void;
  onClose: () => void;
  /** Shown in a FloatingWindow, which carries the title and the close button. */
  inWindow?: boolean;
  /** Whether the words were edited and not yet voiced: what closing would lose. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Where each word is in the take in the dub, by forced alignment: asked only when the user drags across its wave. */
  onAlignWords?: () => Promise<TakeWord[]>;
}> = ({
  unit,
  lineNumber,
  lineTakes,
  firstWord,
  nextStart,
  tolerance,
  bankBlob,
  sampleRate,
  float,
  busy,
  anyBusy,
  pending,
  locked = false,
  initialPhrase,
  onVoice,
  onSuggestWording,
  onUse,
  onClearTakes,
  onListenInDub,
  onClose,
  inWindow = false,
  onDirtyChange,
  voiceTags = { on: false, note: 'This voice reads no tags.' },
  pro = false,
  language = '',
  onAlignWords,
}) => {
  const words = useMemo(() => wordsOf(unit.text), [unit.text]);
  const [direction, setDirection] = useState<TakeDirection>('same');
  // Words picked to retake on their own: the first clicked, and the one shift-clicked to.
  const [pick, setPick] = useState<{ from: number; to: number } | null>(null);
  useEffect(() => setPick(initialPhrase ?? null), [unit.key, unit.text, initialPhrase]);
  const phrase = pick ? phraseOf(unit.text, pick.from, pick.to) : null;
  const wholeLine = !phrase || (!phrase.before && !phrase.after);
  // Esc lets go of the words picked before it closes the window.
  useEffect(() => {
    if (!pick) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')) return;
      e.stopImmediatePropagation();
      setPick(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pick]);

  // Other words to say in place of the picked ones, typed where they are picked: the picked words until changed.
  const sayEditor = useRef<TagTextareaHandle>(null);
  const [say, setSay] = useState('');
  useEffect(() => setSay(phrase && !wholeLine ? phrase.words : ''), [phrase?.words, wholeLine]);
  const sayMarked = dotsToPauses(say.trim());
  const saySaid = stripTags(stripPauses(sayMarked));
  const resay = Boolean(phrase && !wholeLine && sayMarked && sayMarked !== phrase.words);
  // Other words, not only tags or pauses added to the same ones: the picked words are replaced.
  const replaced = resay && saySaid !== phrase?.words;
  const sayProblems = tagProblems(sayMarked);
  const sayTags = tagsOf(sayMarked);

  // The take in the dub, drawn from its samples; its words where forced alignment finds them, asked only on a drag (it may use credits).
  const inDub = lineTakes.takes.find((take) => take.id === lineTakes.active) ?? lineTakes.takes[0];
  const takeSeconds = inDub ? inDub.length / sampleRate : 0;
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    setPeaks(null);
    if (!bankBlob || !inDub) return;
    let live = true;
    peaksOf(bankBlob, inDub, float).then((p) => live && setPeaks(p), () => {});
    return () => {
      live = false;
    };
  }, [bankBlob, inDub?.bankStart, inDub?.length, float]);
  const [takeWords, setTakeWords] = useState<TakeWord[] | null>(null);
  const [aligning, setAligning] = useState(false);
  const aligned = useRef(0);
  useEffect(() => {
    setTakeWords(null);
    setAligning(false);
    aligned.current += 1;
  }, [unit.key, unit.text, inDub?.bankStart]);
  const wave = useRef<HTMLDivElement>(null);
  // A drag across the wave, as shares of its width: kept while its words are looked for.
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  // The drag as the pointer has it now, before it is drawn.
  const dragging = useRef<{ a: number; b: number } | null>(null);
  const shareAt = (clientX: number) => {
    const box = wave.current?.getBoundingClientRect();
    return box && box.width > 0 ? Math.min(1, Math.max(0, (clientX - box.left) / box.width)) : 0;
  };
  /** Picks the words a drag crossed, or the one nearest a click. */
  const pickFromWave = (words: TakeWord[], { a, b }: { a: number; b: number }) => {
    if (!words.length) return;
    const lo = Math.min(a, b) * takeSeconds;
    const hi = Math.max(a, b) * takeSeconds;
    let crossed = words.filter((w) => w.end > lo && w.start < hi);
    if (!crossed.length) {
      const gap = (w: TakeWord) => (lo < w.start ? w.start - lo : lo > w.end ? lo - w.end : 0);
      crossed = [words.reduce((best, w) => (gap(w) < gap(best) ? w : best))];
    }
    setPick({ from: crossed[0].index, to: crossed[crossed.length - 1].index });
  };
  const endDrag = async (range: { a: number; b: number }) => {
    if (takeWords) {
      setDrag(null);
      return pickFromWave(takeWords, range);
    }
    if (!onAlignWords) return setDrag(null);
    const id = ++aligned.current;
    setAligning(true);
    try {
      const words = await onAlignWords();
      if (aligned.current !== id) return;
      setTakeWords(words);
      pickFromWave(words, range);
    } catch (err) {
      if (aligned.current !== id) return;
      reportError(err, { title: 'The words could not be found in the take', safe: 'Nothing was voiced, and the take is as it was.' });
    } finally {
      if (aligned.current === id) {
        setAligning(false);
        setDrag(null);
      }
    }
  };
  // Where the picked words are in the take, once their times are known.
  const pickedSpan =
    takeWords && pick && !wholeLine
      ? (() => {
          const first = takeWords.find((w) => w.index === Math.min(pick.from, pick.to));
          const last = takeWords.find((w) => w.index === Math.max(pick.from, pick.to));
          return first && last ? { start: first.start, end: last.end } : null;
        })()
      : null;

  // The whole line's words are edited in a section opened for it; Retake pro has it open beside its tags.
  const [lineOpen, setLineOpen] = useState(false);

  // The line's words, to edit before a retake. Nothing is voiced, and the script is not changed, until the user asks.
  const [draft, setDraft] = useState(unit.text);
  const [wordings, setWordings] = useState<Wordings>({ kind: 'idle' });
  const offered = useRef<string[]>([]);
  const asking = useRef(0);
  useEffect(() => {
    setDraft(unit.text);
    setWordings({ kind: 'idle' });
    offered.current = [];
    asking.current += 1;
  }, [unit.key, unit.text]);
  const reworded = draft.trim() !== '' && draft.trim() !== unit.text.trim();
  // Edited words not yet voiced in any take are what closing would lose.
  const dirty =
    (reworded && !lineTakes.takes.some((take) => (take.spoken ?? take.text).trim() === dotsToPauses(draft.trim()))) ||
    (!reworded && resay && !lineTakes.takes.some((take) => take.phrase === sayMarked));
  useEffect(() => onDirtyChange?.(dirty), [dirty]);
  useEffect(() => () => onDirtyChange?.(false), []);
  const showLine = pro || lineOpen || reworded;
  // Some words picked, of a line whose words are as they are: those are what a retake voices.
  const some = !reworded && !wholeLine && phrase ? phrase : null;
  // An ellipsis typed between words is a pause: timed, voiced and kept out of the script as one.
  const marked = dotsToPauses(draft.trim());
  // The words said: no pause marks, and no tags, which are not read as words.
  const said = stripTags(stripPauses(marked));
  const typedTags = tagsOf(marked);
  const problems = tagProblems(marked);
  // What each take costs: tags are characters to the voice too.
  const billed = stripPauses(marked).length;
  const editor = useRef<TagTextareaHandle>(null);
  const phonetic = usePhoneticTyping(language);
  const langName = getIndicLanguageConfig(language).nativeName;
  const phoneticButton = language && (
    <button
      type="button"
      onClick={phonetic.toggle}
      aria-pressed={phonetic.enabled}
      title={`Type Roman letters and get ${langName} as you go (Ctrl+G). Tags in [ ] stay English.`}
      className={`h-6 px-2 rounded-md border flex items-center gap-1 text-[11.5px] font-medium cursor-default ${
        phonetic.enabled ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300' : 'border-slate-700 text-slate-400 hover:text-slate-200'
      }`}
    >
      <Keyboard className="w-3 h-3" />
      Phonetic {phonetic.enabled ? langName : 'off'}
    </button>
  );
  const { prefs, addOwn, removeOwn, saveStyle, removeStyle } = useTagPrefs();
  const [count, setCount] = useState<number>(TAKES_PER_ASK);
  const [stability, setStability] = useState<number | null>(null);
  const takeCount = pro ? count : TAKES_PER_ASK;
  const ask = (options: TakeAsk) => onVoice({ ...options, ...(pro && { count, ...(stability !== null && voiceTags.on && { stability }) }) });
  // The line's own voice rate, from its take in the dub, to say how long other words would take.
  const perChar = unit.text.trim().length > 0 ? unit.speech / unit.text.trim().length : 0;
  const slot = nextStart !== null ? Math.max(0, nextStart - firstWord) : Math.max(0, unit.srcEnd - unit.srcStart);
  const secondsOf = (text: string) => stripTags(stripPauses(dotsToPauses(text))).length * perChar + pauseSeconds(dotsToPauses(text));
  const draftSeconds = secondsOf(draft);
  const draftFits = draftSeconds <= slot + tolerance;

  // One way only, as the line needs it: shorter past its slot, fuller well short of the original speech, else as long.
  const spoken = Math.max(0.1, said.length * perChar);
  const original = Math.max(0, unit.srcEnd - unit.srcStart);
  const wordingDirection: RewriteDirection = spoken > slot ? 'shorter' : perChar > 0 && spoken < Math.min(slot, original) * LONGER_BELOW ? 'longer' : 'same';

  const suggest = async () => {
    if (!onSuggestWording) return;
    const id = ++asking.current;
    const targetChars =
      wordingDirection === 'shorter'
        ? Math.max(1, Math.floor((said.length * slot * 0.92) / spoken))
        : wordingDirection === 'longer'
          ? Math.max(said.length + 1, Math.floor((said.length * Math.min(slot, original) * 0.95) / spoken))
          : Math.max(said.length, Math.floor((said.length * slot * 0.95) / spoken));
    setWordings({ kind: 'working' });
    try {
      const options = await onSuggestWording({
        // Wordings are asked for the words alone; tags go back on by hand.
        text: stripTags(marked),
        direction: wordingDirection,
        targetChars,
        // What the slot has left once the words are said, less a breath at the end.
        pauseBudget: Math.max(0, Math.round((slot - Math.min(spoken, targetChars * perChar) - 0.1) * 10) / 10),
        avoid: offered.current,
      });
      if (asking.current !== id) return;
      offered.current = [...offered.current, ...options.map((o) => o.text)].slice(-30);
      setWordings(options.length ? { kind: 'ready', options } : { kind: 'error', message: 'No usable wording came back. Try again, or edit it yourself.' });
    } catch (err: any) {
      if (asking.current !== id) return;
      setWordings({ kind: 'idle' });
      reportError(err, { title: 'No new wordings', safe: 'The line is unchanged — you can still edit it yourself.' });
    }
  };

  const chars = (some ? (resay ? stripPauses(sayMarked).length : some.words.length) : unit.text.length) * takeCount;
  // The line with the new words in place of the picked ones, and about how long it would take.
  const resaidSeconds = some && resay && pick ? secondsOf(phraseLine(unit.text, pick.from, pick.to, sayMarked)) : null;

  const clickWord = (index: number, extend: boolean) => {
    if (extend && pick) setPick({ from: pick.from, to: index });
    else if (pick && pick.from === index && pick.to === index) setPick(null);
    else setPick({ from: index, to: index });
  };
  const inPick = (index: number) => pick !== null && index >= Math.min(pick.from, pick.to) && index <= Math.max(pick.from, pick.to);

  const fits = useMemo(
    () => new Map(lineTakes.takes.map((take) => [take.id, takeFit(take, unit, firstWord, nextStart, tolerance)])),
    [lineTakes.takes, unit, firstWord, nextStart, tolerance]
  );
  // The take that fits best, among more than one: what Sync would have kept.
  const best = useMemo(() => {
    if (lineTakes.takes.length < 2) return null;
    let top: SyncTake | null = null;
    for (const take of lineTakes.takes) if (!top || (fits.get(take.id)?.score ?? Infinity) < (fits.get(top.id)?.score ?? Infinity)) top = take;
    return top;
  }, [lineTakes.takes, fits]);

  // One take plays at a time, on its own, from its samples in the bank.
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const stop = () => {
    const el = audio.current;
    if (el) {
      el.pause();
      URL.revokeObjectURL(el.src);
    }
    audio.current = null;
    setPlaying(null);
  };
  useEffect(() => stop, []);
  useEffect(() => { stop(); }, [unit.key, lineTakes.active]);
  const play = (take: SyncTake) => {
    if (playing === take.id) return stop();
    stop();
    if (!bankBlob) return;
    const el = new Audio(URL.createObjectURL(takeWav(bankBlob, take, { sampleRate, float })));
    el.onended = stop;
    audio.current = el;
    setPlaying(take.id);
    el.play().catch(stop);
  };

  const numbered = lineTakes.takes.filter((take) => take.id !== SYNC_TAKE_ID);
  // What Clear takes drops: every take but Sync's own and the one in the dub. Asked twice, as they cost voicings.
  const clearable = lineTakes.takes.filter((take) => take.id !== SYNC_TAKE_ID && take.id !== lineTakes.active).length;
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => setConfirmClear(false), [unit.key, clearable]);

  const [search, setSearch] = useState('');
  const [newTag, setNewTag] = useState('');
  const [styleName, setStyleName] = useState<string | null>(null);
  const found = search.trim().toLowerCase();
  const sectionLabel = 'text-[10.5px] uppercase tracking-wide font-semibold text-slate-500';
  const chip = 'inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[11.5px] bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/35 cursor-default';
  const cleanNewTag = newTag.trim().replace(/[\[\]]/g, '').toLowerCase();
  // Tags from the library go into the words said in place of the picked ones, while some are picked; else into the line.
  const tagTarget = () => (some ? sayEditor : editor).current;
  const addNewTag = () => {
    if (!isTagName(cleanNewTag)) return;
    addOwn(cleanNewTag);
    tagTarget()?.insertTag(cleanNewTag);
    setNewTag('');
  };
  const lineTags = [...new Set(typedTags)].slice(0, 8);

  /** Retake pro's side: every tag to pick from, the user's own, and their saved styles. */
  const library = (
    <aside className="border-r border-slate-800 p-3 flex flex-col gap-2.5 min-w-0" aria-label="Tags">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-2" aria-hidden="true" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tags"
          aria-label="Search tags"
          className="w-full h-8 pl-7 pr-2 rounded-md bg-slate-900 border border-slate-800 text-[12.5px] text-slate-100 focus:outline-none focus:border-indigo-500"
        />
      </div>
      {[...TAG_LIBRARY, { group: 'Your tags', tags: prefs.own.filter((t) => !TAG_LIBRARY.some((g) => g.tags.includes(t))) }].map((g) => {
        const tags = g.tags.filter((t) => !found || t.includes(found));
        if (tags.length === 0) return null;
        const own = g.group === 'Your tags';
        return (
          <div key={g.group}>
            <div className={`${sectionLabel} mb-1`}>{g.group}</div>
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <span key={t} className="group relative">
                  <button type="button" onClick={() => tagTarget()?.insertTag(t)} title={`Put [${t}] where the caret is (before the words selected)`} className={chip}>
                    [{t}]
                  </button>
                  {own && (
                    <button
                      type="button"
                      onClick={() => removeOwn(t)}
                      aria-label={`Remove [${t}] from your tags`}
                      className="absolute -top-1.5 -right-1.5 hidden group-hover:flex w-3.5 h-3.5 rounded-full bg-slate-700 text-slate-200 items-center justify-center cursor-default"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        );
      })}
      {found && !TAG_LIBRARY.some((g) => g.tags.some((t) => t.includes(found))) && !prefs.own.some((t) => t.includes(found)) && (
        <p className="text-[11.5px] text-slate-500">No tag found. Add it as your own below.</p>
      )}
      <div>
        <div className={`${sectionLabel} mb-1`}>Add your own</div>
        <div className="flex gap-1">
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addNewTag()}
            placeholder="angry"
            aria-label="Your own tag"
            className="min-w-0 flex-1 h-7 px-2 rounded-md bg-slate-900 border border-slate-800 text-[12px] text-slate-100 focus:outline-none focus:border-indigo-500"
          />
          <button type="button" onClick={addNewTag} className="h-7 px-2 rounded-md border border-slate-700 hover:bg-slate-800 text-[11.5px] text-slate-200 cursor-default">
            Add
          </button>
        </div>
        {cleanNewTag && !isTagName(cleanNewTag) && <p className="mt-1 text-[11px] text-amber-300">Write tags in English, such as angry.</p>}
      </div>
      <div>
        <div className={`${sectionLabel} mb-1`}>Saved styles</div>
        <div className="flex flex-col gap-1">
          {prefs.styles.map((style) => (
            <div key={style.name} className="group relative">
              <button
                type="button"
                onClick={() => tagTarget()?.leadWith(style.tags)}
                title="Start the line with these tags, in place of the tags it starts with"
                className="w-full text-left rounded-md border border-slate-800 hover:bg-slate-900 px-2 py-1.5 cursor-default"
              >
                <span className="block text-[12px] text-slate-200 truncate pr-4">{style.name}</span>
                <span className="block font-mono text-[10.5px] text-slate-500 truncate">{style.tags.map((t) => `[${t}]`).join(' ')}</span>
              </button>
              <button
                type="button"
                onClick={() => removeStyle(style.name)}
                aria-label={`Delete the style ${style.name}`}
                className="absolute top-1 right-1 hidden group-hover:flex w-5 h-5 rounded text-slate-400 hover:text-white hover:bg-slate-800 items-center justify-center cursor-default"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {styleName !== null ? (
            <input
              autoFocus
              value={styleName}
              onChange={(e) => setStyleName(e.target.value)}
              onBlur={() => setStyleName(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && styleName.trim()) {
                  saveStyle({ name: styleName.trim().slice(0, 40), tags: lineTags });
                  setStyleName(null);
                } else if (e.key === 'Escape') {
                  e.stopPropagation();
                  setStyleName(null);
                }
              }}
              placeholder="Name, then Enter"
              aria-label="Name of the style"
              className="h-7 px-2 rounded-md bg-slate-900 border border-indigo-500 text-[12px] text-slate-100 focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setStyleName('')}
              disabled={lineTags.length === 0}
              title={lineTags.length === 0 ? 'Put some tags in the line first' : `Save ${lineTags.map((t) => `[${t}]`).join(' ')} under a name`}
              className="h-7 rounded-md border border-dashed border-slate-700 text-[11.5px] text-slate-400 hover:text-slate-200 flex items-center justify-center gap-1 cursor-default disabled:opacity-40"
            >
              <Plus className="w-3 h-3" /> Save the line's tags as a style
            </button>
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <section
      aria-label={`Takes for line ${lineNumber}`}
      className={
        pro
          ? '-m-3 grid grid-cols-[14rem_minmax(0,1fr)]'
          : inWindow
            ? 'flex flex-col gap-3'
            : 'rounded-xl border border-indigo-500/30 bg-slate-950/70 px-3.5 py-3 flex flex-col gap-3'
      }
    >
      {pro && library}
      <div className={pro ? 'p-3 flex flex-col gap-3 min-w-0' : 'contents'}>
      <div className="flex flex-wrap items-center gap-2">
        {!inWindow && <Mic className="w-3.5 h-3.5 text-indigo-300" />}
        {!inWindow && <span className="text-[13px] font-semibold text-slate-100">Takes · line {String(lineNumber).padStart(2, '0')}</span>}
        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
          {nextStart !== null ? `slot ${Math.max(0, nextStart - firstWord).toFixed(1)} s · ` : ''}original speech {Math.max(0, unit.srcEnd - unit.srcStart).toFixed(1)} s
        </span>
        {locked && (
          <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-400/12 text-amber-300" title="Retaking does not unlock it: the take you use stays locked">
            <Lock className="w-3 h-3" /> Locked · a retake keeps the lock
          </span>
        )}
        {!inWindow && (
          <button type="button" onClick={onClose} aria-label="Close the takes" className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 cursor-default">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* The take in the dub: drag across it, or click its words, to retake only those */}
      {!reworded && (
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-1">
            <span className={sectionLabel}>The take in the dub</span>
            <span className="ml-auto text-[11px] text-slate-500">
              {onAlignWords ? 'Drag across the wave, or click a word and Shift + click another' : 'Click a word, then Shift + click another'} · <kbd className="font-mono text-slate-300">Esc</kbd> clears
            </span>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 pt-2 pb-1.5">
            {peaks && takeSeconds > 0 && (
              <div
                ref={wave}
                className="relative h-14 select-none touch-none"
                title={onAlignWords ? (takeWords ? 'Drag across words to pick them; picks snap to whole words' : 'Drag across words to pick them. The first drag finds the words with ElevenLabs forced alignment; it may use alignment credits. No voice is made until you retake.') : undefined}
                onPointerDown={(e) => {
                  if (!onAlignWords || aligning || e.button !== 0) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const at = shareAt(e.clientX);
                  dragging.current = { a: at, b: at };
                  setDrag(dragging.current);
                }}
                onPointerMove={(e) => {
                  if (!dragging.current) return;
                  dragging.current = { ...dragging.current, b: shareAt(e.clientX) };
                  setDrag(dragging.current);
                }}
                onPointerUp={(e) => {
                  const range = dragging.current;
                  if (!range) return;
                  dragging.current = null;
                  void endDrag({ ...range, b: shareAt(e.clientX) });
                }}
              >
                <svg viewBox={`0 0 ${peaks.length} 100`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
                  {peaks.map((p, i) => {
                    const t = ((i + 0.5) / peaks.length) * takeSeconds;
                    const inPick = pickedSpan && t >= pickedSpan.start && t <= pickedSpan.end;
                    const h = Math.max(1, p * 94);
                    return <rect key={i} x={i + 0.15} y={50 - h / 2} width={0.7} height={h} className={inPick ? 'fill-indigo-300' : pickedSpan ? 'fill-slate-600' : 'fill-slate-500'} />;
                  })}
                </svg>
                {pickedSpan && (
                  <div
                    className="absolute inset-y-0 border-x-2 border-indigo-400 bg-indigo-500/15 pointer-events-none"
                    style={{ left: `${(pickedSpan.start / takeSeconds) * 100}%`, width: `${((pickedSpan.end - pickedSpan.start) / takeSeconds) * 100}%` }}
                  >
                    <span className="absolute top-0.5 left-1 text-[10px] font-semibold text-indigo-100 whitespace-nowrap">{replaced ? 'replaced' : 'voiced again'}</span>
                  </div>
                )}
                {drag && (
                  <div
                    className="absolute inset-y-0 bg-indigo-400/20 border-x border-indigo-300/70 pointer-events-none"
                    style={{ left: `${Math.min(drag.a, drag.b) * 100}%`, width: `${Math.abs(drag.b - drag.a) * 100}%` }}
                  />
                )}
                {aligning && (
                  <span className="absolute right-1 top-0.5 flex items-center gap-1 text-[10.5px] text-slate-300 bg-slate-950/80 rounded px-1.5 py-0.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> Finding the words…
                  </span>
                )}
              </div>
            )}
            <p className="mt-1 flex flex-wrap gap-x-1 gap-y-0.5 text-[13.5px] leading-relaxed" aria-label="Words of the line">
              {words.map((word, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={(e) => clickWord(index, e.shiftKey)}
                  aria-pressed={inPick(index)}
                  title="Click to pick · Shift + click to pick up to here"
                  className={`rounded px-0.5 cursor-default ${
                    inPick(index) && !wholeLine
                      ? `bg-indigo-500/25 ring-1 ring-indigo-400/60 ${replaced ? 'text-indigo-300/70 line-through decoration-rose-400/70' : 'text-indigo-100'}`
                      : 'text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  {word}
                </button>
              ))}
            </p>
          </div>
          {pick && wholeLine && <p className="mt-1 text-[11.5px] text-slate-500">Every word is picked: the whole line is voiced again.</p>}
        </div>
      )}

      {/* The words picked: said again, or in other words typed in their place */}
      {some && (
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/30 px-3 py-2.5 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-slate-300">
              Picked <span className="text-indigo-100 font-medium">“{some.words}”</span> · {wordsOf(some.words).length} word{wordsOf(some.words).length === 1 ? '' : 's'}
              {pickedSpan && <span className="font-mono text-[11px] text-slate-500 tabular-nums"> · {(pickedSpan.end - pickedSpan.start).toFixed(2)} s at {pickedSpan.start.toFixed(2)} s</span>}
            </span>
            <button type="button" onClick={() => setPick(null)} title="Esc" className="ml-auto h-6 px-2 rounded-md text-[11.5px] text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-default">
              Clear · whole line
            </button>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <label htmlFor={`take-say-${unit.key}`} className={sectionLabel}>
                Say instead
              </label>
              {!showLine && phoneticButton}
              {voiceTags.on && !pro && (
                <button
                  type="button"
                  onClick={() => sayEditor.current?.openTags()}
                  title="Put a tag before these words (where the caret is). Typing [ does the same."
                  className="h-6 px-2 rounded-md border border-slate-700 hover:bg-slate-800 text-[11.5px] text-slate-200 flex items-center gap-1 cursor-default"
                >
                  <Tag className="w-3 h-3" /> Tags <kbd className="font-mono text-slate-500">[</kbd>
                </button>
              )}
              <span className="ml-auto text-[11px] text-slate-500">Leave it as it is to voice the same words again</span>
            </div>
            <TagTextarea
              ref={sayEditor}
              id={`take-say-${unit.key}`}
              value={say}
              onChange={setSay}
              onBlur={() => resay && sayMarked !== say.trim() && setSay(sayMarked)}
              ownTags={prefs.own}
              onNewTag={addOwn}
              phonetic={language ? phonetic : undefined}
              lang={language}
            />
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] tabular-nums">
              {resaidSeconds !== null && perChar > 0 ? (
                <span className={`font-semibold ${resaidSeconds <= slot + tolerance ? 'text-emerald-300' : 'text-amber-300'}`} title="Estimated from how fast this voice said the line">
                  The line about {resaidSeconds.toFixed(1)} s{resaidSeconds <= slot + tolerance ? ' · fits its slot' : ` · +${(resaidSeconds - slot).toFixed(1)} s past its slot`}
                </span>
              ) : (
                <span className="text-slate-500">Type other words to change only these</span>
              )}
              {sayTags.length > 0 && voiceTags.on && <span className="text-indigo-300">{sayTags.length} tag{sayTags.length === 1 ? '' : 's'} · not in the script</span>}
            </div>
            {sayProblems.unclosed && <p className="mt-1 text-[11.5px] text-rose-300">A tag is not closed: add ] so the voice does not read it aloud.</p>}
            {sayProblems.foreign.length > 0 && (
              <p className="mt-1 text-[11.5px] text-amber-300">Tags work in English: [{sayProblems.foreign[0]}] may be read aloud. Write it as an English tag, such as [softly].</p>
            )}
            {sayTags.length > 0 && !voiceTags.on && (
              <p className="mt-1 flex items-start gap-1.5 text-[11.5px] text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {voiceTags.note} The tags are left out of these takes.
              </p>
            )}
          </div>
          <p className="text-[11.5px] text-slate-500">
            {resay
              ? 'Only these words are voiced, read with the words around them, and put in place of the picked ones. The rest of the take stays as it is, sample for sample. The script takes the new words only when you use a take; tags stay out of it.'
              : 'Only the picked words are voiced again, read with the words around them, and put in where they are. The rest of the take stays as it is, sample for sample.'}
          </p>
        </div>
      )}

      {!showLine && (
        <button
          type="button"
          onClick={() => setLineOpen(true)}
          className="self-start h-7 px-2 -ml-2 rounded-md flex items-center gap-1.5 text-[12px] text-slate-300 hover:text-white hover:bg-slate-800 cursor-default"
          title="Edit the whole line: its words, tags and pauses, or ask for other wordings. Shift+T opens Retake pro."
        >
          <Pencil className="w-3.5 h-3.5" /> Change the whole line's words, tags or pauses
        </button>
      )}

      {/* The line's words, to change before a retake */}
      {showLine && (
      <div>
        <div className="flex items-center gap-2 mb-1">
          <label htmlFor={`take-words-${unit.key}`} className={sectionLabel}>
            Words of the line
          </label>
          {phoneticButton}
          {pro ? (
            <span className="ml-auto text-[11px] text-slate-500">
              Type <kbd className="font-mono text-slate-300">[</kbd> for tags · select words, then pick a tag to put it before them
            </span>
          ) : (
            <button
              type="button"
              onClick={() => editor.current?.openTags()}
              title="Put a tag where the caret is (before the words selected). Typing [ does the same."
              className="ml-auto h-6 px-2 rounded-md border border-slate-700 hover:bg-slate-800 text-[11.5px] text-slate-200 flex items-center gap-1 cursor-default"
            >
              <Tag className="w-3 h-3" /> Tags <kbd className="font-mono text-slate-500">[</kbd>
            </button>
          )}
        </div>
        <TagTextarea
          ref={editor}
          id={`take-words-${unit.key}`}
          value={draft}
          onChange={setDraft}
          onBlur={() => reworded && marked !== draft.trim() && setDraft(marked)}
          ownTags={prefs.own}
          onNewTag={addOwn}
          large={pro}
          phonetic={language ? phonetic : undefined}
          lang={language}
        />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] tabular-nums">
          <span className="text-slate-500">slot {slot.toFixed(1)} s</span>
          {perChar > 0 && (
            <span className={`font-semibold ${draftFits ? 'text-emerald-300' : 'text-amber-300'}`} title="Estimated from how fast this voice said the line">
              about {draftSeconds.toFixed(1)} s{draftFits ? '' : ` · +${(draftSeconds - slot).toFixed(1)} s past its slot`}
            </span>
          )}
          <span className="text-slate-500">
            {said.length} / {unit.text.length} characters
          </span>
          {pauseSeconds(marked) > 0 && <span className="text-indigo-300">pauses {pauseSeconds(marked).toFixed(1)} s</span>}
          {typedTags.length > 0 && (
            <span className="text-indigo-300">
              {typedTags.length} tag{typedTags.length === 1 ? '' : 's'} · not counted in the time
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            {onSuggestWording && (
              <button
                type="button"
                onClick={suggest}
                disabled={wordings.kind === 'working' || !said}
                title={`${wordingDirection === 'shorter' ? 'Shorter wordings: the line runs past its slot' : wordingDirection === 'longer' ? 'Fuller wordings: the line ends well before the original speech' : 'Other wordings about as long: the line fits'}, with pauses where the meaning wants them. Nothing changes until you use one.`}
                className="h-7 px-2.5 flex items-center gap-1 rounded-md border border-slate-700 hover:bg-slate-800 text-xs text-slate-200 cursor-default disabled:opacity-40"
              >
                {wordings.kind === 'working' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pencil className="w-3 h-3" />}
                {wordings.kind === 'ready' ? 'Suggest others' : 'Suggest wording'} · {WORDING_LABEL[wordingDirection]}
              </button>
            )}
            {reworded && (
              <button type="button" onClick={() => setDraft(unit.text)} className="h-7 px-2 flex items-center gap-1 rounded-md text-[11.5px] text-slate-400 hover:text-slate-200 cursor-default">
                <RotateCcw className="w-3 h-3" /> Undo edit
              </button>
            )}
            {!pro && !reworded && lineOpen && (
              <button type="button" onClick={() => setLineOpen(false)} className="h-7 px-2 rounded-md text-[11.5px] text-slate-400 hover:text-slate-200 cursor-default">
                Hide
              </button>
            )}
          </span>
        </div>
        {problems.unclosed && <p className="mt-1 text-[11.5px] text-rose-300">A tag is not closed: add ] so the voice does not read it aloud.</p>}
        {problems.foreign.length > 0 && (
          <p className="mt-1 text-[11.5px] text-amber-300">
            Tags work in English: [{problems.foreign[0]}] may be read aloud. Write it as an English tag, such as [angry].
          </p>
        )}
        {typedTags.length > 0 && !voiceTags.on && (
          <p className="mt-1 flex items-start gap-1.5 text-[11.5px] text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {voiceTags.note} The tags are left out of these takes.
          </p>
        )}
        {typedTags.length > 0 && voiceTags.on && !pro && (
          <p className="mt-1 text-[11px] text-slate-500">Tags change how it is read. They stay out of the script and the subtitles.</p>
        )}
        {wordings.kind === 'error' && <p className="mt-1 text-[11.5px] text-rose-300">{wordings.message}</p>}
        {wordings.kind === 'ready' && (
          <div className="mt-2 flex flex-col gap-1" aria-label="Suggested wordings">
            <span className="text-[10.5px] uppercase tracking-wide font-semibold text-slate-500">
              Pauses placed by meaning, sized to the {slot.toFixed(1)} s slot · use one, then edit it if you like
            </span>
            {wordings.options.map((option) => {
              const seconds = secondsOf(option.text);
              const fits = seconds <= slot + tolerance;
              return (
                <div
                  key={option.text}
                  className={`flex items-start gap-2 rounded-md border px-2 py-1.5 ${option.text === draft.trim() ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-800'}`}
                >
                  <span className="flex-1 min-w-0 text-[13px] text-slate-100 leading-relaxed">
                    <WithPauses text={option.text} />
                    {option.backTranslation && <span className="block text-[11.5px] text-slate-500">Says: {option.backTranslation}</span>}
                    {option.issues && <span className="block text-[11px] text-amber-300">Check the meaning: {option.issues.join('; ')}</span>}
                  </span>
                  <span
                    className={`shrink-0 text-[10.5px] font-semibold px-1.5 rounded tabular-nums ${fits ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}
                  >
                    ≈{seconds.toFixed(1)} s
                  </span>
                  <button
                    type="button"
                    onClick={() => setDraft(option.text)}
                    className="shrink-0 h-6 px-2 rounded-md border border-slate-700 hover:bg-slate-800 text-[11.5px] text-slate-200 cursor-default"
                  >
                    Use
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {pro && (
        <div>
          <span className={sectionLabel}>Sent to the voice</span>
          <p className="mt-1 font-mono text-[12px] leading-relaxed text-slate-300 bg-slate-900/70 border border-slate-800 rounded-md px-2.5 py-1.5 break-words">
            {sentText(some ? sayMarked : marked, voiceTags.on) || <span className="text-slate-500">No words yet</span>}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {voiceTags.on ? 'Tags are read as you typed them; pauses go as …. Tags stay out of the script and the subtitles.' : `${voiceTags.note} Tags are left out.`}
          </p>
        </div>
      )}

      {pro && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {voiceTags.on && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Stability">
              <span className="text-[11.5px] text-slate-400 mr-1">Stability</span>
              {[{ value: null, label: 'As synced', hint: 'The settings the line was synced with' }, ...TAKE_STABILITIES].map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setStability(s.value)}
                  aria-pressed={stability === s.value}
                  title={s.hint}
                  className={`h-7 px-2.5 rounded-full border text-[11.5px] cursor-default ${
                    stability === s.value ? 'border-indigo-400/70 bg-indigo-500/15 text-indigo-100' : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5" role="group" aria-label="Takes to voice">
            <span className="text-[11.5px] text-slate-400 mr-1">Takes</span>
            {TAKE_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCount(n)}
                aria-pressed={count === n}
                title={`Voice ${n} take${n === 1 ? '' : 's'} at once`}
                className={`h-7 w-8 rounded-full border text-[11.5px] tabular-nums cursor-default ${
                  count === n ? 'border-indigo-400/70 bg-indigo-500/15 text-indigo-100' : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11.5px] text-slate-400 mr-1">Read</span>
        {TAKE_DIRECTIONS.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setDirection(d.id)}
            aria-pressed={direction === d.id}
            title={d.hint}
            className={`h-7 px-2.5 rounded-full border text-[11.5px] cursor-default ${
              direction === d.id ? 'border-indigo-400/70 bg-indigo-500/15 text-indigo-100' : 'border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {some && pick ? (
          <>
            <button
              type="button"
              onClick={() => ask({ direction, phrase: { from: pick.from, to: pick.to, ...(resay && { say: sayMarked }) } })}
              disabled={anyBusy || pending || !saySaid || sayProblems.unclosed}
              title={
                pending
                  ? "This line's words changed since Sync: Sync again, then take it again"
                  : !saySaid
                    ? 'Type the words to say in place of the picked ones'
                    : sayProblems.unclosed
                      ? 'Close the tag with ] first'
                      : `Voices ${takeCount} take${takeCount === 1 ? '' : 's'} of ${resay ? 'your words' : 'the picked words'} now and puts them in place of the picked ones. Nothing changes in the dub until you use one.`
              }
              className="min-h-8 px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 disabled:bg-slate-800 disabled:text-slate-500 cursor-default"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
              {busy
                ? 'Voicing takes…'
                : resay
                  ? `Retake “${short(saySaid || sayMarked)}” in place of the picked words · ${takeCount} take${takeCount === 1 ? '' : 's'} · ${chars.toLocaleString()} chars`
                  : `Retake “${short(some.words)}” only · ${takeCount} take${takeCount === 1 ? '' : 's'} · ${chars.toLocaleString()} chars`}
            </button>
            <button
              type="button"
              onClick={() => ask({ direction })}
              disabled={anyBusy || pending || !said}
              title="Voices the whole line again; the picked words are ignored"
              className="min-h-8 px-3 py-1 rounded-lg border border-slate-700 text-slate-100 text-xs flex items-center gap-1.5 hover:bg-slate-800 disabled:opacity-40 cursor-default"
            >
              Retake whole line instead · {(unit.text.length * takeCount).toLocaleString()} chars
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => ask(reworded ? { direction, text: marked } : { direction })}
            disabled={anyBusy || pending || !said || problems.unclosed}
            className="min-h-8 px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 disabled:bg-slate-800 disabled:text-slate-500 cursor-default"
            title={
              pending
                ? "This line's words changed since Sync: Sync again, then take it again"
                : problems.unclosed
                  ? 'Close the tag with ] first'
                  : reworded
                    ? `Voices ${takeCount} take${takeCount === 1 ? '' : 's'} in your words. The script takes them only when you use one, without the tags.`
                    : `Voices ${takeCount} take${takeCount === 1 ? '' : 's'} of the whole line now. Nothing changes in the dub until you use one. Pick words above to voice only those.`
            }
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
            {busy
              ? 'Voicing takes…'
              : `Retake line ${String(lineNumber).padStart(2, '0')}${reworded ? (said === unit.text.trim() ? ' with your tags' : ' in your words') : ''} · ${takeCount} take${takeCount === 1 ? '' : 's'} · ${((reworded ? billed : unit.text.length) * takeCount).toLocaleString()} chars`}
          </button>
        )}
        <span className="text-[11.5px] text-slate-500">Character counts are estimates. Retaking picked words also uses forced alignment.</span>
        {pending && <span className="text-[11.5px] text-amber-300">The words changed since Sync: Sync again first.</span>}
      </div>

      {onClearTakes && clearable > 0 && (
        <div className="flex items-center gap-2 -mb-1.5">
          <span className="text-[10.5px] uppercase tracking-wide font-semibold text-slate-500">Takes</span>
          <span className="ml-auto flex items-center gap-1.5">
            {confirmClear && <span className="text-[11.5px] text-slate-400">Sync's take and the one in the dub stay.</span>}
            {confirmClear && (
              <button type="button" onClick={() => setConfirmClear(false)} className="h-7 px-2 rounded-md text-[11.5px] text-slate-400 hover:text-slate-200 cursor-default">
                Keep them
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (!confirmClear) return setConfirmClear(true);
                stop();
                setConfirmClear(false);
                onClearTakes();
              }}
              disabled={anyBusy}
              title="Removes the other takes from this list. Sync's take and the one in the dub stay."
              className={`h-7 px-2.5 flex items-center gap-1 rounded-md border text-xs cursor-default disabled:opacity-40 ${
                confirmClear ? 'border-rose-500/60 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20' : 'border-slate-700 text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Trash2 className="w-3 h-3" />
              {confirmClear ? `Clear ${clearable} take${clearable === 1 ? '' : 's'}` : 'Clear takes'}
            </button>
          </span>
        </div>
      )}

      <ul className="flex flex-col gap-1.5" aria-label="Takes">
        {lineTakes.takes.map((take) => {
          const fit = fits.get(take.id);
          const active = lineTakes.active === take.id;
          const n = numbered.indexOf(take) + 1;
          return (
            <li
              key={take.id}
              className={`flex flex-wrap items-center gap-2.5 rounded-lg px-2.5 py-2 border ${active ? 'border-indigo-400/70 bg-indigo-500/10' : 'border-slate-800 bg-slate-900/60'}`}
            >
              <button
                type="button"
                onClick={() => play(take)}
                disabled={!bankBlob}
                aria-label={playing === take.id ? `Stop ${takeName(take, n)}` : `Play ${takeName(take, n)}`}
                className="w-8 h-8 rounded-full border border-slate-700 text-slate-200 hover:bg-slate-800 flex items-center justify-center cursor-default disabled:opacity-40"
              >
                {playing === take.id ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[12.5px] font-medium text-slate-100">{takeName(take, n)}</span>
                  {take.kind !== 'sync' && <span className="text-[11px] text-slate-400">{take.voice ? `Voice changed · ${take.voice}` : directionLabel(take.direction)}</span>}
                  {take.text === unit.text && take.spoken && tagsOf(take.spoken).map((t, i) => <TagChip key={i} tag={t} />)}
                  {take.phrase && <span className="text-[11px] text-indigo-300 truncate max-w-[16rem]">only “{take.phrase}”</span>}
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">{take.speech.toFixed(2)} s</span>
                  {best?.id === take.id && <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-indigo-400/15 text-indigo-200">Best fit</span>}
                </div>
                {(() => {
                  const slot = nextStart === null ? Math.max(0, unit.srcEnd - unit.srcStart) : Math.max(0, nextStart - firstWord);
                  const scale = Math.max(slot, ...lineTakes.takes.map(t => t.speech), 0.01) * 1.08;
                  return <div className="relative h-1.5 mt-2 rounded-full bg-slate-800" role="img" aria-label={`${take.speech.toFixed(2)} seconds of speech; ${slot.toFixed(2)} second ${nextStart === null ? 'original speech reference' : 'slot'}`}>
                    <div className={`h-full rounded-full ${active ? 'bg-indigo-400' : 'bg-slate-500'}`} style={{ width: `${take.speech / scale * 100}%` }} />
                    <span className="absolute -top-0.5 h-2.5 w-px bg-slate-200" style={{ left: `${slot / scale * 100}%` }} />
                  </div>;
                })()}
                {take.text !== unit.text && (
                  <p className="text-[11.5px] text-sky-200/90 mt-1 leading-snug">
                    Says: <WithPauses text={take.spoken ?? take.text} />
                    <span className="block text-[11px] text-slate-500">Other words than the line has now: using this take puts them in the script.</span>
                  </p>
                )}
              </div>
              {fit && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TONE[fit.tone]}`}>{fit.label}</span>}
              {active ? (
                <span className="flex items-center gap-1 text-[11.5px] text-indigo-200 font-medium px-1">
                  <Check className="w-3.5 h-3.5" /> In the dub
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    stop();
                    onUse(take.id);
                  }}
                  disabled={anyBusy || pending}
                  title={take.text !== unit.text ? 'Put this take in the dub, and its words in the script' : 'Put this take in the dub, where the line is now'}
                  className="h-7 px-2.5 rounded-lg border border-slate-700 text-xs text-slate-100 hover:bg-slate-800 cursor-default disabled:opacity-40"
                >
                  Use {takeName(take, n)}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-slate-500">
        <button type="button" onClick={onListenInDub} className="h-7 px-2.5 rounded-lg border border-slate-800 text-slate-300 hover:bg-slate-800 flex items-center gap-1.5 cursor-default">
          <Headphones className="w-3.5 h-3.5" /> Listen in the dub
        </button>
        <span>Each take is fitted as Sync fits a line, never stretched. Sync again keeps the take in the dub and starts the takes afresh.</span>
      </div>
      </div>
    </section>
  );
};

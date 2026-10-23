/**
 * Places a target-language script onto timed source cues by meaning.
 *
 * The model is never asked to write the script back out. The script is cut
 * into numbered words and the model only answers where each cue ends, so the
 * words that come back are exactly the words that went in: nothing reworded,
 * dropped or repeated, and every word placed once, in order.
 *
 * Long transcripts run in overlapping windows of cues. Each window commits all
 * but its last few cues and the next window starts from there, so the model
 * always sees the sentence it is cutting through. Answers that contradict each
 * other are repaired rather than trusted: the longest run of consistent
 * answers is kept and the cues around it are spread by length and flagged as
 * estimated. A window whose call fails is placed the same way instead of
 * failing the whole run.
 *
 * Cue timings are never read or written here.
 */

/** Scripts written without spaces between words. */
const NO_SPACE_SCRIPT = /[฀-໿က-႟ក-៿぀-ヿ㐀-鿿豈-﫿]/;
const LONG_RUN = 24;

const wordSegmenter = () => {
  try {
    return new Intl.Segmenter(undefined, { granularity: 'word' });
  } catch {
    return null;
  }
};

/** Splits a run with no spaces into word-sized pieces, punctuation kept on the word before it. */
const splitRun = (run, segmenter) => {
  if (!segmenter) return [run];
  const pieces = [];
  for (const { segment, isWordLike } of segmenter.segment(run)) {
    if (!isWordLike && pieces.length > 0) pieces[pieces.length - 1] += segment;
    else pieces.push(segment);
  }
  return pieces.length ? pieces : [run];
};

/**
 * Cuts a script into words. Each token keeps what followed it: '\n' for a line
 * break, ' ' for a space, '' inside a run with no spaces.
 *
 * @returns {{text: string, sep: '' | ' ' | '\n'}[]}
 */
export const tokenizeScript = (script) => {
  const tokens = [];
  let segmenter;
  for (const match of String(script ?? '').matchAll(/(\S+)(\s*)/g)) {
    const [, word, space] = match;
    const sep = space.includes('\n') ? '\n' : space ? ' ' : '';
    if (word.length > LONG_RUN && NO_SPACE_SCRIPT.test(word)) {
      segmenter ??= wordSegmenter();
      const pieces = splitRun(word, segmenter);
      pieces.forEach((text, i) => tokens.push({ text, sep: i === pieces.length - 1 ? sep : '' }));
    } else {
      tokens.push({ text: word, sep });
    }
  }
  return tokens;
};

const SENTENCE_END = /[.!?。！？।॥؟…]["'”’)\]]*$/u;
const SENTENCE_TAIL = 2;

/**
 * Where cue text that ends at `end` should really end. Verb-final languages
 * close a sentence with a word or two ("है।") that a cut by meaning can leave
 * at the start of the next cue; those words go back to the sentence they
 * close. The next cue, which ends at `limit`, always keeps some words.
 */
export const closeSentence = (tokens, from, end, limit) => {
  if (end <= from || SENTENCE_END.test(tokens[end - 1]?.text ?? '')) return end;
  for (let j = end; j < Math.min(end + SENTENCE_TAIL, limit - 1); j += 1) {
    if (SENTENCE_END.test(tokens[j].text)) return j + 1;
  }
  return end;
};

/** Joins tokens back into one cue's text; line breaks inside a cue become spaces. */
export const joinTokens = (tokens) =>
  tokens.map((t, i) => t.text + (i < tokens.length - 1 && t.sep ? ' ' : '')).join('');

/** Speech with sound tags such as [music], (applause) or ♪ taken out. */
const spokenText = (text) =>
  String(text ?? '')
    .replace(/\[[^\]]*\]|\([^)]*\)|[♪♫]/g, ' ')
    .trim();

/** How much of the script a cue should take when there is nothing better to go on. */
const cueWeight = (cue) => {
  const text = spokenText(cue.text);
  return text ? Math.max(1, text.length) : 0;
};

const sum = (values) => values.reduce((a, b) => a + b, 0);

/**
 * Longest run of anchors whose end positions never go backwards, as indexes
 * into `anchors`. Small inputs only (one window), so O(n²) is fine.
 */
const longestConsistentRun = (anchors) => {
  const n = anchors.length;
  if (n === 0) return [];
  const length = new Array(n).fill(1);
  const prev = new Array(n).fill(-1);
  for (let i = 1; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (anchors[j].end <= anchors[i].end && length[j] + 1 > length[i]) {
        length[i] = length[j] + 1;
        prev[i] = j;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < n; i += 1) if (length[i] >= length[best]) best = i;
  const run = [];
  for (let i = best; i !== -1; i = prev[i]) run.unshift(i);
  return run;
};

/**
 * Turns the model's answers for one window into clean cue boundaries.
 *
 * @param {object} options
 * @param {(number|null|undefined)[]} options.answers Index of each cue's last
 *   word; `null` means the model said the cue gets no words; anything else
 *   (missing, out of range) is treated as no answer.
 * @param {number[]} options.weights Fallback share of each cue.
 * @param {number} options.start First word index of the window.
 * @param {number} options.stop Word index just past the window's slice.
 * @param {boolean} options.final Whether every word up to `stop` must be used.
 * @param {number} options.rate Words per unit of weight, for cues past the
 *   last usable answer when the window is not final.
 * @returns {{ends: number[], estimated: boolean[]}} `ends[i]` is the word index
 *   just past cue i. Ends never decrease, the first cue starts at `start`, and
 *   in a final window the last cue ends at `stop`.
 */
export const resolveBoundaries = ({ answers, weights, start, stop, final, rate }) => {
  const count = weights.length;
  // A cue the model left empty gets nothing when its neighbours are spread.
  const share = weights.map((w, i) => (answers[i] === null ? 0 : w));

  const anchors = [];
  answers.forEach((value, i) => {
    const last = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (!Number.isInteger(last) || last < start || last >= stop) return;
    anchors.push({ index: i, end: last + 1 });
  });
  const kept = longestConsistentRun(anchors).map((k) => anchors[k]);
  if (final && count > 0) {
    // The last cue must close the script; drop answers that run past it.
    while (kept.length && kept[kept.length - 1].index === count - 1) kept.pop();
    kept.push({ index: count - 1, end: stop, forced: true });
  }

  const ends = new Array(count).fill(start);
  const estimated = new Array(count).fill(false);
  const answered = new Set(kept.filter((a) => !a.forced).map((a) => a.index));

  const fill = (from, fromEnd, to, toEnd) => {
    // Cues from+1..to-1 sit between two known ends; spread them by weight.
    const between = share.slice(from + 1, to + 1);
    const total = sum(between) || between.length || 1;
    let running = 0;
    for (let i = from + 1; i < to; i += 1) {
      running += sum(between) ? share[i] : 1;
      ends[i] = fromEnd + Math.round(((toEnd - fromEnd) * running) / total);
      estimated[i] = answers[i] !== null;
    }
  };

  let prevIndex = -1;
  let prevEnd = start;
  for (const anchor of kept) {
    fill(prevIndex, prevEnd, anchor.index, anchor.end);
    ends[anchor.index] = anchor.end;
    prevIndex = anchor.index;
    prevEnd = anchor.end;
  }
  // Past the last usable answer in a window that is not final.
  for (let i = prevIndex + 1; i < count; i += 1) {
    prevEnd = Math.min(stop, prevEnd + Math.round(share[i] * rate));
    ends[i] = prevEnd;
    estimated[i] = answers[i] !== null;
  }
  // A forced last cue is estimated unless the model's own answer agreed.
  if (final && count > 0 && !answered.has(count - 1)) {
    const own = Number(answers[count - 1]);
    // A last cue the model left empty that took no words is its answer, not a guess.
    const leftEmpty = answers[count - 1] === null && ends[count - 1] === (count > 1 ? ends[count - 2] : start);
    estimated[count - 1] = !leftEmpty && !(Number.isInteger(own) && own + 1 === stop);
  }
  // A cue the model left empty that still had to take words is a guess too.
  ends.forEach((end, i) => {
    if (answers[i] === null && end > (i === 0 ? start : ends[i - 1])) estimated[i] = true;
  });
  return { ends, estimated };
};

const FITS = new Set(['full', 'partial', 'none']);

/** Numbered words as the model sees them, keeping the script's line breaks. */
const renderWords = (tokens, from, to) => {
  let out = '';
  for (let i = from; i < to; i += 1) {
    out += `{${i}}${tokens[i].text}`;
    if (i < to - 1) out += tokens[i].sep === '\n' ? '\n' : ' ';
  }
  return out;
};

export const buildAlignPrompt = ({ cues, tokens, start, stop, final, targetLanguage, previous, extraRules }) => {
  const language = targetLanguage || 'target-language';
  const cueList = cues
    .map((cue, i) => `${i + 1}. ${spokenText(cue.text) ? String(cue.text).trim() : '(no speech)'}`)
    .join('\n');
  const context = previous
    ? `\nALREADY PLACED (context only, do not assign again)\nThe cue just before these said: "${previous.source}"\nIt was given: "${previous.target}"\n`
    : '';
  const scope = final
    ? `These are the last cues the script covers, so every numbered word must be used: cue ${cues.length} ends at word {${stop - 1}}.`
    : `The numbered words run on past these cues and the later words belong to later cues. Stop where the meaning of cue ${cues.length} ends; you do not have to use every word.`;

  return `You are aligning a ${language} dubbing script to the English cues it translates.

The English is a timed transcript cut into numbered cues. The ${language} script is a translation of the same speech; its words are numbered {${start}} to {${stop - 1}}. For every cue, find the ${language} words that say what that cue's English says, and give the number of the cue's last word. Each cue starts right after the previous one ends; the first cue starts at word {${start}}.

HOW TO DECIDE
1. Match by meaning, not by length. Read a whole sentence in both languages before cutting it.
2. Languages order words differently (in Indian languages the verb usually comes last). When one English sentence runs over several cues, cut the ${language} sentence at the phrase boundary closest to where the English cue breaks. Never cut inside a phrase that has to be said together.
3. A pause "…" or "..." between two cues belongs to the earlier cue. Punctuation is part of the numbered word it touches.
4. Give "last": null for a cue marked (no speech), or when nothing in the script says that cue. Never give null just because a cue is hard to cut.
5. Words the script adds, or a meaning it moves, stay with the cue they are closest to; mark that cue's fit.
6. ${scope}${extraRules ? `\n${extraRules.trim()}` : ''}

FIT (most cues are "full")
"full": the cue's words say what its English says. "partial": part of the meaning is missing, added, or carried over from a neighbouring cue. "none": nothing in the script says it.
${context}
ENGLISH CUES
${cueList}

${language.toUpperCase()} SCRIPT (numbered words)
${renderWords(tokens, start, stop)}

Respond with ONLY this JSON, one entry per English cue, in order. "last" is the number of the cue's last word and "word" is that word copied exactly:
{"cues":[{"n":1,"last":<number>,"word":"<the word numbered last>","fit":"full"}]}`;
};

/** Numbered lines as the model sees them. */
const renderLines = (tokens, from, to) => {
  let out = '';
  for (let i = from; i < to; i += 1) out += `[${i}] ${tokens[i].text}${i < to - 1 ? '\n' : ''}`;
  return out;
};

/**
 * Asks which of the script's own lines each cue ends in. The writer's line
 * breaks are kept as the places a cue may end; a cue that ends partway
 * through a line says so, and that line is cut by meaning afterwards.
 */
export const buildLinePrompt = ({ cues, tokens, start, stop, final, targetLanguage, previous, extraRules }) => {
  const language = targetLanguage || 'target-language';
  const cueList = cues
    .map((cue, i) => `${i + 1}. ${spokenText(cue.text) ? String(cue.text).trim() : '(no speech)'}`)
    .join('\n');
  const context = previous
    ? `\nALREADY PLACED (context only, do not assign again)\nThe cue just before these said: "${previous.source}"\nIt was given: "${previous.target}"\n`
    : '';
  const scope = final
    ? `These are the last cues the script covers, so every line must be used: cue ${cues.length} ends at line [${stop - 1}].`
    : `The lines run on past these cues and the later lines belong to later cues. Stop where the meaning of cue ${cues.length} ends; you do not have to use every line.`;

  return `You are aligning a ${language} dubbing script to the English cues it translates.

The English is a timed transcript cut into numbered cues. The ${language} script is a translation of the same speech, written in lines numbered [${start}] to [${stop - 1}]. Its writer chose where each line breaks, so most lines say what one cue, or a few whole cues, say. For every cue, give the number of the line in which that cue's meaning ends. Each cue starts right after the previous one ends; the first cue starts at line [${start}].

HOW TO DECIDE
1. Match by meaning, not by length. Read a whole sentence in both languages before deciding.
2. When a cue ends where a line ends, give that line with "inside": false.
3. When a cue ends partway through a line and the next cue carries on in that same line, give that line with "inside": true. Several cues can end in one line this way; only the cue that ends with the line is "inside": false.
4. One cue can take several whole lines; give the last of them.
5. Give "last": null for a cue marked (no speech), or when nothing in the script says that cue.
6. ${scope}${extraRules ? `\n${extraRules.trim()}` : ''}

FIT (most cues are "full")
"full": the cue's lines say what its English says. "partial": part of the meaning is missing, added, or carried over from a neighbouring cue. "none": nothing in the script says it.
${context}
ENGLISH CUES
${cueList}

${language.toUpperCase()} SCRIPT (numbered lines)
${renderLines(tokens, start, stop)}

Respond with ONLY this JSON, one entry per English cue, in order:
{"cues":[{"n":1,"last":<line number>,"inside":false,"fit":"full"}]}`;
};

/** A word compared without punctuation, case or spacing. */
const bareWord = (text) =>
  String(text ?? '')
    .normalize('NFC')
    .replace(/[\p{P}\p{S}\s]/gu, '')
    .toLowerCase();

/**
 * Models copy words more reliably than they count. When the echoed word is
 * not the word at the given number, look a few words either side for it.
 */
const checkedIndex = (last, word, tokens) => {
  if (last === null) return null;
  const index = typeof last === 'string' && last.trim() !== '' ? Number(last) : last;
  if (!Number.isInteger(index)) return undefined;
  const wanted = bareWord(word);
  if (!wanted || bareWord(tokens[index]?.text) === wanted) return index;
  for (let d = 1; d <= 6; d += 1) {
    if (bareWord(tokens[index - d]?.text) === wanted) return index - d;
    if (bareWord(tokens[index + d]?.text) === wanted) return index + d;
  }
  return index;
};

/** Reads the model's reply into per-cue answers, by cue number where given. */
const readAnswers = (parsed, count, tokens) => {
  const list = Array.isArray(parsed?.cues) ? parsed.cues : Array.isArray(parsed) ? parsed : [];
  const answers = new Array(count).fill(undefined);
  const fits = new Array(count).fill(undefined);
  const inside = new Array(count).fill(false);
  const seen = new Set();
  list.forEach((item, position) => {
    const n = Number(item?.n);
    const i = Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : position;
    if (i >= count || seen.has(i)) return;
    seen.add(i);
    answers[i] = checkedIndex(item?.last, item?.word, tokens);
    const fit = String(item?.fit ?? '').toLowerCase();
    if (FITS.has(fit)) fits[i] = fit;
    inside[i] = item?.inside === true || item?.inside === 'true';
  });
  return { answers, fits, inside };
};

/**
 * A reply that places almost nothing, or calls almost every cue unmatched, is
 * usually the model giving up on a long window rather than a real verdict.
 */
const looksGivenUp = (answers, fits, weights) => {
  const speech = weights.map((w, i) => (w > 0 ? i : -1)).filter((i) => i >= 0);
  if (speech.length < 4) return false;
  const empty = speech.filter((i) => answers[i] == null).length;
  const unmatched = speech.filter((i) => fits[i] === 'none').length;
  return empty / speech.length > 0.5 || unmatched / speech.length > 0.5;
};

const EDGE_WORDS = 40;
const wordCount = (text) => spokenText(text).split(/\s+/).filter(Boolean).length;

export const buildLocatePrompt = ({ cues, tokens, targetLanguage }) => {
  const language = targetLanguage || 'target-language';
  const cueList = cues
    .map((cue, i) => `${i + 1}. ${spokenText(cue.text) ? String(cue.text).trim() : '(no speech)'}`)
    .join('\n');
  const opening = joinTokens(tokens.slice(0, EDGE_WORDS));
  const closing = joinTokens(tokens.slice(-EDGE_WORDS));
  return `A ${language} script translates part or all of the English transcript below. Find where it sits.

ENGLISH CUES
${cueList}

THE ${language.toUpperCase()} SCRIPT BEGINS
"${opening}"

AND ENDS
"${closing}"

Give the number of the English cue that the script's first words translate, and of the cue that its last words translate. When the script covers the whole transcript, that is cue 1 and cue ${cues.length}.

Respond with ONLY this JSON:
{"firstCue":<number>,"lastCue":<number>}`;
};

/**
 * Finds which cues a script covers, so a script for part of a video is not
 * spread over all of it. Returns 0-based inclusive cue indexes, or null when
 * the answer is unusable or implausible for the script's length.
 */
const locateCoverage = async ({ cues, tokens, targetLanguage, callModel }) => {
  const parsed = await callModel(buildLocatePrompt({ cues, tokens, targetLanguage }));
  const first = Number(parsed?.firstCue) - 1;
  const last = Number(parsed?.lastCue) - 1;
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last >= cues.length || first > last) return null;
  if (first === 0 && last === cues.length - 1) return null;
  // Translations run from about half to about twice the English word count.
  const english = sum(cues.slice(first, last + 1).map((cue) => wordCount(cue.text)));
  const ratio = tokens.length / Math.max(1, english);
  if (ratio < 0.35 || ratio > 3) return null;
  return { first, last };
};

export const ALIGN_DEFAULTS = {
  windowSize: 30,
  overlap: 6,
  slack: 1.6,
  margin: 40,
  minWindow: 8,
  attempts: 3,
  // Cues kept either side of the located range, in case it is a little off.
  coverageMargin: 2,
  // Matching whole lines is easier than counting words, so a line window
  // takes more cues.
  lineWindowSize: 50,
  // Lines that run over several cues are cut several to a call, and calls
  // run side by side. A reply takes anything from 3 to 50 s whatever its
  // size, so a few short calls at once beat one long one (2026-10-21, 40
  // cues: 40 to a call took 74 s, 12 to a call four at a time 50 s). A line
  // too long to share a call is cut on its own.
  splitBatchCues: 12,
  splitBatchWords: 200,
  splitAloneCues: 12,
  splitAloneWords: 200,
  parallelSplits: 4,
  // A window whose cues take more than this many times their English share
  // of the script's characters (and this many more characters), leaving the
  // cues after them under `starvedShare` of theirs, is asked again.
  overrunRatio: 2.2,
  overrunChars: 120,
  starvedShare: 0.7,
  // Windows placed again when the script runs out with cues to go.
  revisitWindows: 3,
  // Second looks a whole run may take, so a hard script costs a few calls more, not many.
  guardBudget: 8,
  // A cue holding this many times its share, beside cues with English but no
  // script, holds a passage that was not spread; at most this many are.
  collapseRatio: 2.5,
  collapseChars: 60,
  collapseReach: 12,
  collapseRuns: 24,
};

/** The script's own lines, each as one unit. */
const scriptLines = (script) =>
  String(script ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ text, sep: '\n' }));

const LINE_RULE =
  "The script's line breaks are where its writer ended a line. When a cue ends at or near one, end it there.";

/**
 * Places units (words or whole lines) onto cues `from`..`to`-1, window by
 * window. Returns each cue's span of units; `inside` marks a cue whose end
 * falls partway through a unit, or was only estimated.
 *
 * A window that takes far more of the script than its cues' English share,
 * leaving the cues after it starved, is asked again with only its share in
 * view, so it cannot take what later cues say. When the script still runs
 * out with cues to go, the last few windows are placed again that way once.
 * What stays unsure is flagged on the cues, never filled in.
 */
const placeUnits = async ({ cues, tokens, weights, from, to, units, ctx, extraRules, onProgress }) => {
  const { overlap, slack, margin, minWindow, attempts, overrunRatio, overrunChars, starvedShare, revisitWindows } = ctx.settings;
  const windowSize = units === 'lines' ? ctx.settings.lineWindowSize : ctx.settings.windowSize;
  const { callModel, targetLanguage, isCancelled, onWindowError, report, state, guard } = ctx;
  const total = tokens.length;
  const buildPrompt = units === 'lines' ? buildLinePrompt : buildAlignPrompt;
  const spans = [];
  let cueIndex = from;
  let cursor = 0;

  // Script characters before each unit, to measure what a window took.
  const charsBefore = [0];
  for (const token of tokens) charsBefore.push(charsBefore[charsBefore.length - 1] + token.text.length);
  const charsIn = (a, b) => charsBefore[b] - charsBefore[a];

  // Where each committed window started, so a window can be placed again.
  const history = [];
  // Windows that start before this cue only see their share of the script.
  let strictUntil = -1;
  let revisited = false;
  // Set when the model placed the script's last word and said the cues after it are not in it.
  let endedByModel = false;

  /** Which cues and units one call covers, for a window of `size` cues. */
  const planWindow = (size, strict = false) => {
    const keep = Math.min(overlap, Math.floor(size / 4));
    const remainingCues = to - cueIndex;
    const final = remainingCues <= size + keep;
    const count = final ? remainingCues : size;
    const windowWeights = weights.slice(cueIndex, cueIndex + count);
    const rate = (total - cursor) / (sum(weights.slice(cueIndex, to)) || 1);
    const reach = strict
      ? Math.ceil(sum(windowWeights) * rate * 1.15) + Math.ceil(margin / 4)
      : Math.ceil(sum(windowWeights) * rate * slack) + margin;
    return {
      final,
      strict,
      count,
      commit: final ? count : count - keep,
      windowCues: cues.slice(cueIndex, cueIndex + count),
      windowWeights,
      rate,
      slice: final ? total : Math.min(total, cursor + Math.max(1, reach)),
    };
  };

  /**
   * Whether a window's committed cues took far more of the script than their
   * English share and left the cues after them starved: the sign of a window
   * that took what later cues say. Length is only a warning sign, so this
   * triggers a second look, never a cut by length.
   */
  const overran = (plan, { ends }, answers) => {
    if (plan.final) return false;
    // The script's last word was placed and the model said the cues after it
    // are not in the script: the script ends here, nothing was taken.
    if (scriptEnded(plan, ends, answers)) return false;
    const committed = sum(plan.windowWeights.slice(0, plan.commit));
    const after = sum(weights.slice(cueIndex + plan.commit, to));
    if (!after || !committed) return false;
    const left = charsIn(cursor, total);
    const used = charsIn(cursor, ends[plan.commit - 1]);
    const share = (left * committed) / (committed + after);
    return used > share * overrunRatio && used - share > overrunChars && left - used < (left - share) * starvedShare;
  };

  /** Whether the reply used the script's last word and said no later cue in view is in it. */
  const scriptEnded = (plan, ends, answers) => {
    const k = ends.findIndex((end) => end >= total);
    if (k < 0 || k === ends.length - 1) return false;
    return answers.slice(k + 1).every((a, j) => a === null || !plan.windowWeights[k + 1 + j]);
  };

  /** One call for a window; a failed or unusable reply is placed by length. */
  const ask = async (plan, previous) => {
    let answers = new Array(plan.count).fill(undefined);
    let fits = new Array(plan.count).fill(undefined);
    let inside = new Array(plan.count).fill(false);
    let failure = null;
    let givenUp = false;
    try {
      const parsed = await callModel(
        buildPrompt({ cues: plan.windowCues, tokens, start: cursor, stop: plan.slice, final: plan.final, targetLanguage, previous, extraRules })
      );
      state.reached = true;
      ({ answers, fits, inside } = readAnswers(parsed, plan.count, tokens));
      givenUp = looksGivenUp(answers, fits, plan.windowWeights);
    } catch (err) {
      if (err?.code === 'cancelled' || isCancelled?.()) throw err;
      // A bad key or a bad request will not get better by asking again.
      if (err?.retryable === false && err?.status && err.status < 500) throw err;
      // Network faults were already retried by the client, so the model
      // cannot be reached; say so instead of guessing every cue.
      const badReply = err?.code === 'bad_model_output';
      if (!badReply && !state.reached) throw err;
      failure = err;
    }
    const resolved = resolveBoundaries({ answers, weights: plan.windowWeights, start: cursor, stop: plan.slice, final: plan.final, rate: plan.rate });
    return { answers, fits, inside, failure, givenUp, resolved };
  };

  while (cueIndex < to) {
    if (isCancelled?.()) throw Object.assign(new Error('Alignment was cancelled.'), { code: 'cancelled' });

    let plan = planWindow(windowSize, cueIndex < strictUntil);
    report.windows += 1;

    if (cursor >= total) {
      // The script ran out before the cues did. When cues with speech are
      // left, the windows before probably took their words: place the last
      // few again, each seeing only its share of the script, once.
      const speechLeft = weights.slice(cueIndex, to).filter(Boolean).length;
      if (speechLeft >= 3 && !revisited && !endedByModel && history.length && guard.budget > 0) {
        revisited = true;
        guard.budget -= 1;
        report.windows -= 1;
        const back = Math.max(0, history.length - revisitWindows);
        strictUntil = cueIndex;
        ({ cueIndex, cursor } = history[back]);
        history.length = back;
        continue;
      }
      for (let i = 0; i < plan.commit; i += 1) {
        const speech = Boolean(plan.windowWeights[i]);
        spans[cueIndex + i] = {
          start: total,
          end: total,
          fit: speech ? 'none' : undefined,
          estimated: false,
          inside: false,
          empty: true,
          flag: speech ? 'ran-out' : undefined,
        };
      }
      cueIndex += plan.commit;
      continue;
    }

    onProgress?.({
      done: cueIndex,
      total: cues.length,
      message: plan.strict
        ? `Matching cues ${cueIndex + 1}–${cueIndex + plan.count} of ${cues.length} again, more closely`
        : `Matching cues ${cueIndex + 1}–${cueIndex + plan.count} of ${cues.length} by meaning`,
    });

    const before = spans[cueIndex - 1];
    const previous = before
      ? { source: String(cues[cueIndex - 1].text ?? '').trim(), target: joinTokens(tokens.slice(before.start, before.end)) }
      : null;

    let reply;
    let widened = plan.strict;
    let givenUpReplies = 0;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      reply = await ask(plan, previous);
      const { failure, givenUp, resolved } = reply;
      if (attempt === attempts) break;
      // Only a malformed reply is worth asking again; a network fault was
      // already retried.
      if (failure && failure.code !== 'bad_model_output') break;

      // Two replies in a row that place nothing are a verdict: the script
      // does not cover these cues.
      if (givenUp && ++givenUpReplies >= 2) break;
      if (failure || givenUp) {
        // Fewer cues are easier to place; ask again with half as many. A
        // last reply that still places nothing is taken as the verdict.
        if (plan.count > minWindow) plan = planWindow(Math.max(minWindow, Math.ceil(plan.count / 2)), plan.strict);
        continue;
      }
      // The committed cues ran to the edge of the slice: it was probably too
      // short for them, so give the model more units once.
      if (!widened && !plan.final && plan.slice < total && resolved.ends[plan.commit - 1] >= plan.slice - 1) {
        widened = true;
        plan = { ...plan, slice: Math.min(total, cursor + (plan.slice - cursor) * 2 + margin) };
        continue;
      }
      break;
    }

    // A window that took what later cues say is asked again with only its
    // share in view. If that answer cannot be used the first one stands,
    // flagged for a look.
    let overrun = false;
    if (!reply.failure && overran(plan, reply.resolved, reply.answers)) {
      overrun = true;
      if (guard.budget > 0) {
        guard.budget -= 1;
        report.windows += 1;
        const tight = planWindow(plan.count, true);
        const second = await ask(tight, previous);
        const guessed = second.resolved.estimated.slice(0, tight.commit).filter(Boolean).length;
        if (!second.failure && !second.givenUp && guessed <= tight.commit / 2) {
          plan = tight;
          reply = second;
          overrun = false;
        }
      }
    }

    const { answers, fits, inside, failure, resolved } = reply;
    if (failure) {
      report.failedWindows += 1;
      onWindowError?.(failure, { from: cueIndex, to: cueIndex + plan.count });
    }

    history.push({ cueIndex, cursor });
    endedByModel = !failure && scriptEnded(plan, resolved.ends, answers);
    let start = cursor;
    for (let i = 0; i < plan.commit; i += 1) {
      const next = i + 1 < plan.count ? resolved.ends[i + 1] : resolved.ends[i];
      const end = units === 'words' ? closeSentence(tokens, start, resolved.ends[i], next) : resolved.ends[i];
      const estimated = resolved.estimated[i];
      const last = plan.final && i === plan.count - 1;
      spans[cueIndex + i] = {
        start,
        end,
        fit: estimated ? undefined : end > start ? fits[i] : plan.windowWeights[i] ? 'none' : undefined,
        estimated,
        // Where an estimated cue really ends is not known, so it may share a line.
        inside: !last && (estimated || inside[i]),
        empty: answers[i] === null,
        flag: overrun && plan.windowWeights[i] ? 'overrun' : undefined,
      };
      start = end;
    }
    cursor = start;
    cueIndex += plan.commit;
  }
  return spans;
};

/**
 * Moves a cue end that falls a word or two from a line break onto it: the
 * writer's line breaks are surer places to end than a near miss. Never
 * empties a cue, and leaves empty cues alone.
 */
export const snapToLineEnds = (ends, tokens, start, reach = 2) => {
  const out = [...ends];
  const atLineEnd = (end) => tokens[end - 1]?.sep === '\n';
  for (let i = 0; i < out.length - 1; i += 1) {
    const before = i === 0 ? start : out[i - 1];
    const after = out[i + 1];
    if (out[i] <= before || out[i] >= after || atLineEnd(out[i])) continue;
    for (let d = 1; d <= reach; d += 1) {
      const near = [out[i] - d, out[i] + d].find((end) => end > before && end < after && atLineEnd(end));
      if (near !== undefined) {
        out[i] = near;
        break;
      }
    }
  }
  return out;
};

/** Writes cues `from`.. from their ends in `tokens`; `lines` snaps ends onto line breaks. */
const writeSpans = (results, from, tokens, start, spans, lines) => {
  const ends = spans.map((span) => span.end);
  const snapped = lines ? snapToLineEnds(ends, tokens, start) : ends;
  let at = start;
  spans.forEach(({ fit, estimated, flag }, k) => {
    Object.assign(results[from + k], { text: joinTokens(tokens.slice(at, snapped[k])), fit, estimated, flag });
    at = snapped[k];
  });
};

/** Places words onto cues `from`..`to`-1 and writes each cue's text into `results`. */
const placeWords = async ({ cues, tokens, weights, from, to, results, ctx, extraRules, onProgress, lines = false }) => {
  const spans = await placeUnits({ cues, tokens, weights, from, to, units: 'words', ctx, extraRules, onProgress });
  writeSpans(results, from, tokens, 0, spans.slice(from, to), lines);
};

/**
 * Asks where each cue ends in several separate passages at once, each a line
 * (or a few) that runs over a few cues. Words are numbered across all the
 * passages so every number names one word.
 */
export const buildSplitPrompt = ({ passages, tokens, targetLanguage, extraRules }) => {
  const language = targetLanguage || 'target-language';
  const blocks = passages
    .map((passage, p) => {
      const cueList = passage.cues
        .map((cue, i) => `${i + 1}. ${spokenText(cue.text) ? String(cue.text).trim() : '(no speech)'}`)
        .join('\n');
      return `PASSAGE ${p + 1}
English cues:
${cueList}
${language} words {${passage.start}} to {${passage.stop - 1}}:
${renderWords(tokens, passage.start, passage.stop)}`;
    })
    .join('\n\n');

  return `You are aligning a ${language} dubbing script to the English cues it translates.

Below are ${passages.length} separate passages. In each, a line or two of the ${language} script translate a few English cues. Place each passage on its own; they do not run into each other.

For every cue in a passage, find the ${language} words that say what that cue's English says, and give the number of the cue's last word. Each cue starts right after the previous one ends; a passage's first cue starts at its first word, and its last cue ends at its last word, so every word is used.

HOW TO DECIDE
1. Match by meaning, not by length. Read the whole passage in both languages before cutting it.
2. Languages order words differently (in Indian languages the verb usually comes last). Cut at the phrase boundary closest to where the English cue breaks. Never cut inside a phrase that has to be said together.
3. A pause "…" or "..." between two cues belongs to the earlier cue. Punctuation is part of the numbered word it touches.
4. ${LINE_RULE}
5. Give "last": null for a cue marked (no speech), or when nothing in the passage says that cue. Never give null just because a cue is hard to cut.${extraRules ? `\n${extraRules.trim()}` : ''}

FIT (most cues are "full")
"full": the cue's words say what its English says. "partial": part of the meaning is missing, added, or carried over from a neighbouring cue. "none": nothing in the passage says it.

${blocks}

Respond with ONLY this JSON, one entry per passage and one per English cue in it, in order. "last" is the number of the cue's last word and "word" is that word copied exactly:
{"passages":[{"p":1,"cues":[{"n":1,"last":<number>,"word":"<the word numbered last>","fit":"full"}]}]}`;
};

/**
 * Cuts several shared lines in one call. Returns the groups whose answer was
 * not usable, to be cut one by one instead.
 */
const placeSplitBatch = async ({ batch, cues, weights, results, ctx, extraRules }) => {
  const { callModel, targetLanguage, isCancelled, report, state } = ctx;
  if (isCancelled?.()) throw Object.assign(new Error('Alignment was cancelled.'), { code: 'cancelled' });
  const tokens = [];
  const passages = batch.map((group) => {
    const start = tokens.length;
    tokens.push(...group.tokens);
    return { group, start, stop: tokens.length, cues: group.cues.map((i) => cues[i]) };
  });
  report.windows += 1;

  let list;
  try {
    const parsed = await callModel(buildSplitPrompt({ passages, tokens, targetLanguage, extraRules }));
    state.reached = true;
    list = Array.isArray(parsed?.passages) ? parsed.passages : [];
  } catch (err) {
    if (err?.code === 'cancelled' || isCancelled?.()) throw err;
    if (err?.retryable === false && err?.status && err.status < 500) throw err;
    if (err?.code !== 'bad_model_output' && !state.reached) throw err;
    // Each line is asked again on its own.
    return batch;
  }

  const retry = [];
  passages.forEach((passage, p) => {
    const reply = list.find((item) => Number(item?.p) === p + 1) ?? list[p];
    const count = passage.cues.length;
    const windowWeights = passage.group.cues.map((i) => weights[i]);
    const { answers, fits } = readAnswers(reply, count, tokens);
    const usable = answers.filter((a) => Number.isInteger(a) && a >= passage.start && a < passage.stop).length;
    if (usable === 0 || looksGivenUp(answers, fits, windowWeights)) {
      retry.push(passage.group);
      return;
    }
    const resolved = resolveBoundaries({ answers, weights: windowWeights, start: passage.start, stop: passage.stop, final: true, rate: 1 });
    let at = passage.start;
    const spans = resolved.ends.map((end, k) => {
      const closed = closeSentence(tokens, at, end, resolved.ends[k + 1] ?? end);
      const estimated = resolved.estimated[k];
      const span = { end: closed, estimated, fit: estimated ? undefined : closed > at ? fits[k] : windowWeights[k] ? 'none' : undefined };
      at = closed;
      return span;
    });
    writeSpans(results, passage.group.cues[0], tokens, passage.start, spans, true);
  });
  return retry;
};

/** Packs shared lines into calls; a line too long to share one goes alone. */
const packSplits = (shared, settings) => {
  const alone = [];
  const batches = [];
  let current = null;
  for (const group of shared) {
    const size = { cues: group.cues.length, words: group.tokens.length };
    if (size.cues > settings.splitAloneCues || size.words > settings.splitAloneWords) {
      alone.push(group);
      continue;
    }
    if (!current || current.cues + size.cues > settings.splitBatchCues || current.words + size.words > settings.splitBatchWords) {
      current = { groups: [], cues: 0, words: 0 };
      batches.push(current);
    }
    current.groups.push(group);
    current.cues += size.cues;
    current.words += size.words;
  }
  return { alone, batches: batches.map((b) => b.groups) };
};

/**
 * Runs of cues that share lines: a cue that ends partway through a line goes
 * with the cues after it until one ends where a line ends.
 */
export const groupByLines = (spans, from, to) => {
  const groups = [];
  let current = null;
  let joinNext = false;
  for (let i = from; i < to; i += 1) {
    const span = spans[i];
    // A cue the model placed but gave no line shares the line before it, or
    // the one after it when there is none before.
    const shares = span.end === span.start && !span.empty;
    const joined = Boolean(current && (joinNext || shares));
    if (joined) {
      current.cues.push(i);
      current.end = Math.max(current.end, span.end);
    } else {
      current = { cues: [i], start: span.start, end: span.end };
      groups.push(current);
    }
    joinNext = span.inside || (shares && !joined);
  }
  return groups;
};

/**
 * Places a script written in lines: first which lines each cue takes, then,
 * only where a line runs over several cues, where inside it each cue ends.
 * A wrong cut can then never move words out of their line.
 */
const placeByLines = async ({ cues, lines, weights, from, to, results, ctx }) => {
  const { onProgress, settings, extraRules } = ctx;
  const spans = await placeUnits({ cues, tokens: lines, weights, from, to, units: 'lines', ctx, extraRules, onProgress });
  const shared = [];
  for (const group of groupByLines(spans, from, to)) {
    const tokens = tokenizeScript(lines.slice(group.start, group.end).map((line) => line.text).join('\n'));
    if (group.cues.length === 1) {
      const [i] = group.cues;
      const text = joinTokens(tokens);
      const { estimated } = spans[i];
      Object.assign(results[i], { text, estimated, fit: estimated ? undefined : text ? spans[i].fit : weights[i] ? 'none' : undefined, flag: spans[i].flag });
    } else if (tokens.length === 0) {
      for (const i of group.cues) {
        const { estimated } = spans[i];
        Object.assign(results[i], { text: '', estimated, fit: estimated || !weights[i] ? undefined : 'none', flag: spans[i].flag });
      }
    } else {
      shared.push({ ...group, tokens });
    }
  }
  if (!shared.length) return;
  // A line window flagged as unsure stays flagged once its lines are cut.
  const keepFlags = () => {
    for (const group of shared) for (const i of group.cues) if (spans[i].flag) results[i].flag ??= spans[i].flag;
  };

  // Each line that runs over several cues is cut by meaning over just those
  // cues: several lines to a call, and a line whose answer is unusable, or
  // that is too long to share a call, on its own.
  const rules = [LINE_RULE, extraRules].filter(Boolean).join('\n');
  const { alone, batches } = packSplits(shared, settings);
  let done = 0;
  const progress = () =>
    onProgress?.({ done, total: shared.length, message: `Splitting lines that run over several cues (${done} of ${shared.length})` });
  progress();
  const cutAlone = async (group) => {
    const first = group.cues[0];
    await placeWords({ cues, tokens: group.tokens, weights, from: first, to: first + group.cues.length, results, ctx, extraRules: rules, lines: true });
    done += 1;
    progress();
  };
  const queue = [...batches.map((batch) => ({ batch })), ...alone.map((group) => ({ group }))];
  const worker = async () => {
    while (queue.length) {
      const job = queue.shift();
      if (job.group) {
        await cutAlone(job.group);
        continue;
      }
      const retry = await placeSplitBatch({ batch: job.batch, cues, weights, results, ctx, extraRules });
      done += job.batch.length - retry.length;
      progress();
      const depth = job.depth ?? 0;
      if (retry.length > 1 && depth < 2) {
        // Ask again together: in halves when the whole call failed, since a
        // shorter reply is likelier to come back whole.
        const half = retry.length === job.batch.length ? Math.ceil(retry.length / 2) : retry.length;
        queue.push({ batch: retry.slice(0, half), depth: depth + 1 });
        if (half < retry.length) queue.push({ batch: retry.slice(half), depth: depth + 1 });
      } else {
        queue.push(...retry.map((group) => ({ group })));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(settings.parallelSplits, queue.length) }, worker));
  keepFlags();
};

/**
 * Passages left in one cue beside cues that have English but no script: the
 * cue holds `collapseRatio` times its share of the script's characters, and
 * the empty cues next to it (up to `collapseReach` each side) may be what the
 * rest of it says. Returns each run of cues, `cue` being the one that holds it.
 *
 * @param {string[]} texts One per cue.
 * @param {number[]} weights Each cue's English length; 0 for no speech.
 */
export const findCollapsed = (texts, weights, from, to, { collapseRatio, collapseChars, collapseReach } = ALIGN_DEFAULTS) => {
  const chars = texts.map((text) => String(text ?? '').replace(/\s+/g, '').length);
  const totalChars = sum(chars.slice(from, to));
  const totalWeight = sum(weights.slice(from, to));
  if (!totalChars || !totalWeight) return [];
  const rate = totalChars / totalWeight;
  const gap = (j) => weights[j] > 0 && !String(texts[j] ?? '').trim();
  const runs = [];
  let floor = from;
  for (let i = from; i < to; i += 1) {
    const share = weights[i] * rate;
    if (!chars[i] || chars[i] < share * collapseRatio || chars[i] - share < collapseChars) continue;
    let first = i;
    while (first - 1 >= floor && i - (first - 1) <= collapseReach && gap(first - 1)) first -= 1;
    let last = i;
    while (last + 1 < to && last + 1 - i <= collapseReach && gap(last + 1)) last += 1;
    if (first === i && last === i) continue;
    runs.push({ from: first, to: last + 1, cue: i });
    floor = last + 1;
    i = last;
  }
  return runs;
};

const COLLAPSE_RULE =
  'All these words were first given to one cue. Spread them over the cues whose English they say, and give "last": null to a cue that nothing here says.';

/**
 * Spreads each passage left in one cue over the empty cues beside it, by
 * meaning, using only that passage's words. A passage whose answer cannot be
 * used stays where it was, flagged, rather than being cut by length.
 */
const spreadCollapsed = async ({ cues, weights, from, to, results, ctx }) => {
  const { settings, report, onProgress, extraRules } = ctx;
  const runs = findCollapsed(
    results.map((r) => r.text),
    weights,
    from,
    to,
    settings
  ).slice(0, settings.collapseRuns);
  if (!runs.length) return;
  report.collapsed = runs.length;
  const rules = [COLLAPSE_RULE, extraRules].filter(Boolean).join('\n');
  let done = 0;
  const queue = [...runs];
  const worker = async () => {
    while (queue.length) {
      const run = queue.shift();
      onProgress?.({ done, total: runs.length, message: `Spreading passages that sat in one cue (${done} of ${runs.length})` });
      const kept = results.slice(run.from, run.to).map((r) => ({ ...r }));
      const tokens = tokenizeScript(results[run.cue].text);
      const failedBefore = report.failedWindows;
      await placeWords({ cues, tokens, weights, from: run.from, to: run.to, results, ctx, extraRules: rules });
      const speech = kept.map((_, k) => run.from + k).filter((i) => weights[i]);
      const guessed = speech.filter((i) => results[i].estimated).length;
      if (report.failedWindows > failedBefore || guessed > speech.length / 2) {
        kept.forEach((r, k) => Object.assign(results[run.from + k], r));
        results[run.cue].flag = 'collapsed';
      }
      done += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(settings.parallelSplits, queue.length) }, worker));
};

/**
 * Whether the cues, read in order, hold exactly the script: nothing added,
 * dropped, repeated or moved. Only whitespace may differ, since cues are
 * joined where the script had a space or a line break.
 *
 * @returns {{preserved: boolean, at?: number, expected?: string, found?: string}}
 */
export const checkPreservation = (script, texts) => {
  const squash = (text) => String(text ?? '').replace(/\s+/g, '');
  const want = squash(script);
  const got = squash(texts.join(''));
  if (want === got) return { preserved: true };
  let at = 0;
  while (at < want.length && want[at] === got[at]) at += 1;
  return { preserved: false, at, expected: want.slice(at, at + 24), found: got.slice(at, at + 24) };
};

/** Runs of flagged cues, 1-based, for the report. */
const unresolvedRanges = (results) => {
  const ranges = [];
  results.forEach((r, i) => {
    if (r.flag !== 'overrun' && r.flag !== 'ran-out' && r.flag !== 'collapsed') return;
    const last = ranges[ranges.length - 1];
    if (last && last.reason === r.flag && last.lastCue === i) last.lastCue = i + 1;
    else ranges.push({ firstCue: i + 1, lastCue: i + 1, reason: r.flag });
  });
  return ranges;
};

/**
 * Aligns a whole script onto cues. A script written in several lines keeps
 * them: each cue takes whole lines, and a line is cut only where it runs over
 * several cues.
 *
 * @param {{id: string, text: string}[]} cues
 * @param {string} script
 * @param {object} options
 * @param {(prompt: string) => Promise<unknown>} options.callModel Returns the
 *   parsed JSON reply for one window.
 * @param {{firstCue: number, lastCue: number}} [options.coverage] The cues the
 *   script covers, 1-based, when the user has said; otherwise it is found.
 * @param {boolean} [options.lineAnchors] Whether the script's lines are kept
 *   (default true).
 * @returns {Promise<{cues: {id: string, text: string, fit?: string, estimated: boolean}[],
 *   wordCount: number, windows: number, failedWindows: number,
 *   coverage: {firstCue: number, lastCue: number} | null}>} `coverage` is set,
 *   1-based, when the script covers only part of the cues.
 */
export const alignScript = async (
  cues,
  script,
  { callModel, targetLanguage, extraRules = '', onProgress, isCancelled, onWindowError, coverage, lineAnchors = true, ...tuning } = {}
) => {
  const settings = { ...ALIGN_DEFAULTS, ...tuning };
  const tokens = tokenizeScript(script);
  const weights = cues.map(cueWeight);
  const results = cues.map((cue) => ({ id: String(cue.id), text: '', fit: undefined, estimated: false }));
  const report = { wordCount: tokens.length, windows: 0, failedWindows: 0, coverage: null, collapsed: 0, unresolved: [], integrity: { preserved: true } };

  if (cues.length === 0 || tokens.length === 0) return { cues: results, ...report };

  // `reached`: whether any call has come back yet; until one has, a failure
  // to reach the model is reported rather than papered over. `guard` counts
  // the second looks the run may still take.
  const ctx = {
    callModel,
    targetLanguage,
    extraRules,
    onProgress,
    isCancelled,
    onWindowError,
    settings,
    report,
    state: { reached: false },
    guard: { budget: settings.guardBudget },
  };

  // The cues the script is placed over: all of them unless it covers only part.
  let from = 0;
  let to = cues.length;
  const { firstCue, lastCue } = coverage ?? {};
  if (Number.isInteger(firstCue) && Number.isInteger(lastCue) && firstCue >= 1 && firstCue <= lastCue && lastCue <= cues.length) {
    // The user said where it sits, so no margin is added.
    from = firstCue - 1;
    to = lastCue;
    if (from > 0 || to < cues.length) report.coverage = { firstCue, lastCue };
  } else if (cues.length > settings.windowSize + settings.overlap) {
    onProgress?.({ done: 0, total: cues.length, message: 'Finding where your script starts and ends' });
    try {
      const span = await locateCoverage({ cues, tokens, targetLanguage, callModel });
      ctx.state.reached = true;
      if (span) {
        report.coverage = { firstCue: span.first + 1, lastCue: span.last + 1 };
        from = Math.max(0, span.first - settings.coverageMargin);
        to = Math.min(cues.length, span.last + 1 + settings.coverageMargin);
      }
    } catch (err) {
      if (err?.code === 'cancelled' || isCancelled?.()) throw err;
      if (err?.retryable === false && err?.status && err.status < 500) throw err;
      if (err?.code !== 'bad_model_output') throw err;
      // Without a location the whole transcript is used.
    }
  }
  for (let i = 0; i < cues.length; i += 1) {
    if ((i < from || i >= to) && weights[i]) results[i].fit = 'none';
  }

  const lines = lineAnchors ? scriptLines(script) : [];
  if (lines.length >= 2) await placeByLines({ cues, lines, weights, from, to, results, ctx });
  else await placeWords({ cues, tokens, weights, from, to, results, ctx, extraRules, onProgress });
  await spreadCollapsed({ cues, weights, from, to, results, ctx });

  // A cue with English that the script does not say stays empty, and says so.
  for (let i = from; i < to; i += 1) {
    if (weights[i] && !results[i].text.trim() && !results[i].flag) results[i].flag = 'missing';
  }
  report.unresolved = unresolvedRanges(results);
  report.integrity = checkPreservation(script, results.map((r) => r.text));
  if (!report.integrity.preserved) {
    // Never hand back cues that do not hold the script word for word.
    throw Object.assign(new Error(`The placed script does not match the pasted script near character ${report.integrity.at}.`), {
      code: 'integrity',
    });
  }
  return { cues: results, ...report };
};

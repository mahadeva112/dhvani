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
    estimated[count - 1] = !(Number.isInteger(own) && own + 1 === stop);
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
    ? `These are the last cues of the transcript, so every numbered word must be used: cue ${cues.length} ends at word {${stop - 1}}.`
    : `The numbered words run on past these cues and the later words belong to later cues. Stop where the meaning of cue ${cues.length} ends; you do not have to use every word.`;

  return `You are aligning a ${language} dubbing script to the English cues it translates.

The English is a timed transcript cut into numbered cues. The ${language} script is a translation of the same speech; its words are numbered {${start}} to {${stop - 1}}. For every cue, find the ${language} words that say what that cue's English says, and give the number of the cue's last word. Each cue starts right after the previous one ends; the first cue starts at word {${start}}.

HOW TO DECIDE
1. Match by meaning, not by length. Read a whole sentence in both languages before cutting it.
2. Languages order words differently (in Indian languages the verb usually comes last). When one English sentence runs over several cues, cut the ${language} sentence at the phrase boundary closest to where the English cue breaks. Never cut inside a phrase that has to be said together.
3. A pause "…" or "..." between two cues belongs to the earlier cue. Punctuation is part of the numbered word it touches.
4. Almost every cue gets words. Give "last": null only for a cue marked (no speech), or when the script has nothing at all for that cue.
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
  const seen = new Set();
  list.forEach((item, position) => {
    const n = Number(item?.n);
    const i = Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : position;
    if (i >= count || seen.has(i)) return;
    seen.add(i);
    answers[i] = checkedIndex(item?.last, item?.word, tokens);
    const fit = String(item?.fit ?? '').toLowerCase();
    if (FITS.has(fit)) fits[i] = fit;
  });
  return { answers, fits };
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

export const ALIGN_DEFAULTS = { windowSize: 30, overlap: 6, slack: 1.6, margin: 40, minWindow: 8, attempts: 3 };

/**
 * Aligns a whole script onto cues.
 *
 * @param {{id: string, text: string}[]} cues
 * @param {string} script
 * @param {object} options
 * @param {(prompt: string) => Promise<unknown>} options.callModel Returns the
 *   parsed JSON reply for one window.
 * @returns {Promise<{cues: {id: string, text: string, fit?: string, estimated: boolean}[],
 *   wordCount: number, windows: number, failedWindows: number}>}
 */
export const alignScript = async (
  cues,
  script,
  { callModel, targetLanguage, extraRules = '', onProgress, isCancelled, onWindowError, ...tuning } = {}
) => {
  const { windowSize, overlap, slack, margin, minWindow, attempts } = { ...ALIGN_DEFAULTS, ...tuning };
  const tokens = tokenizeScript(script);
  const total = tokens.length;
  const weights = cues.map(cueWeight);
  const results = cues.map((cue) => ({ id: String(cue.id), text: '', fit: undefined, estimated: false }));
  const report = { wordCount: total, windows: 0, failedWindows: 0 };

  if (cues.length === 0 || total === 0) return { cues: results, ...report };

  let cueIndex = 0;
  let cursor = 0;

  /** Which cues and words one call covers, for a window of `size` cues. */
  const planWindow = (size) => {
    const keep = Math.min(overlap, Math.floor(size / 4));
    const remainingCues = cues.length - cueIndex;
    const final = remainingCues <= size + keep;
    const count = final ? remainingCues : size;
    const windowWeights = weights.slice(cueIndex, cueIndex + count);
    const rate = (total - cursor) / (sum(weights.slice(cueIndex)) || 1);
    return {
      final,
      count,
      commit: final ? count : count - keep,
      windowCues: cues.slice(cueIndex, cueIndex + count),
      windowWeights,
      rate,
      slice: final ? total : Math.min(total, cursor + Math.ceil(sum(windowWeights) * rate * slack) + margin),
    };
  };

  while (cueIndex < cues.length) {
    if (isCancelled?.()) throw Object.assign(new Error('Alignment was cancelled.'), { code: 'cancelled' });

    let plan = planWindow(windowSize);
    report.windows += 1;

    if (cursor >= total) {
      // The script ran out before the cues did.
      for (let i = 0; i < plan.commit; i += 1) results[cueIndex + i].fit = plan.windowWeights[i] ? 'none' : undefined;
      cueIndex += plan.commit;
      continue;
    }

    onProgress?.({
      done: cueIndex,
      total: cues.length,
      message: `Matching cues ${cueIndex + 1}–${cueIndex + plan.count} of ${cues.length} by meaning`,
    });

    const previousIndex = cueIndex - 1;
    const previous =
      previousIndex >= 0
        ? { source: String(cues[previousIndex].text ?? '').trim(), target: results[previousIndex].text }
        : null;

    let resolved;
    let fits;
    let failure = null;
    let widened = false;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let answers = new Array(plan.count).fill(undefined);
      fits = new Array(plan.count).fill(undefined);
      failure = null;
      let givenUp = false;
      try {
        const parsed = await callModel(
          buildAlignPrompt({ cues: plan.windowCues, tokens, start: cursor, stop: plan.slice, final: plan.final, targetLanguage, previous, extraRules })
        );
        ({ answers, fits } = readAnswers(parsed, plan.count, tokens));
        givenUp = looksGivenUp(answers, fits, plan.windowWeights);
      } catch (err) {
        if (err?.code === 'cancelled' || isCancelled?.()) throw err;
        // A bad key or a bad request will not get better by asking again.
        if (err?.retryable === false && err?.status && err.status < 500) throw err;
        failure = err;
      }
      resolved = resolveBoundaries({ answers, weights: plan.windowWeights, start: cursor, stop: plan.slice, final: plan.final, rate: plan.rate });
      if (attempt === attempts) break;

      if (failure || givenUp) {
        // Fewer cues are easier to place; ask again with half as many. A
        // last reply that still places nothing is taken as the verdict.
        if (plan.count > minWindow) plan = planWindow(Math.max(minWindow, Math.ceil(plan.count / 2)));
        continue;
      }
      // The committed cues ran to the edge of the slice: it was probably too
      // short for them, so give the model more words once.
      if (!widened && !plan.final && plan.slice < total && resolved.ends[plan.commit - 1] >= plan.slice - 1) {
        widened = true;
        plan = { ...plan, slice: Math.min(total, cursor + (plan.slice - cursor) * 2 + margin) };
        continue;
      }
      break;
    }
    if (failure) {
      report.failedWindows += 1;
      onWindowError?.(failure, { from: cueIndex, to: cueIndex + plan.count });
    }

    let from = cursor;
    for (let i = 0; i < plan.commit; i += 1) {
      const end = resolved.ends[i];
      const result = results[cueIndex + i];
      result.text = joinTokens(tokens.slice(from, end));
      result.estimated = resolved.estimated[i];
      result.fit = result.estimated ? undefined : result.text ? fits[i] : plan.windowWeights[i] ? 'none' : undefined;
      from = end;
    }
    cursor = from;
    cueIndex += plan.commit;
  }

  onProgress?.({ done: cues.length, total: cues.length, message: 'Every cue has its part of the script' });
  return { cues: results, ...report };
};

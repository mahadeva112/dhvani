/**
 * Grammar check of dub lines, asked for by the user in Review, never by itself.
 *
 * The text model reads the dub lines in their own language and proposes the
 * smallest fix for each line with a real mistake: spelling, a matra or bindu,
 * gender or number agreement, punctuation (a question read flat), a word said
 * twice. It does not reword, shorten, translate or "improve" a line: meaning
 * and word choice are the translation's, and the meaning check lives elsewhere
 * (syncRewrite.js). The source line goes along only so the model can tell a
 * question from a statement, or who a verb's gender refers to.
 *
 * Every fix is checked in code before it is offered (`acceptFix`): it may not
 * touch a [tag], a pause mark, a number or a word in Latin letters (names and
 * glossary terms), may not change the line count inside a cue, and may only
 * change a small part of the line. A fix that fails is dropped, never repaired:
 * a grammar check that rewrites lines would be worse than none. Nothing here
 * changes the script; the user accepts or skips each fix.
 */
import { logger } from '../logger.js';
import { generateText } from '../providers/textModel.js';
import { reviewEffort } from '../providers/gemini/translation.js';
import { parseJsonResponse } from '../providers/gemini/client.js';

/** Lines sent to the model in one call. */
export const GRAMMAR_BATCH = 25;
/** Calls in flight at once. */
const PARALLEL = 3;
/** Most lines one request may check. */
export const MAX_GRAMMAR_LINES = 2000;
/** Longest line text kept. */
const MAX_LINE_CHARS = 1000;

/** The kinds of mistake a fix may name; anything else is shown as Grammar. */
export const GRAMMAR_KINDS = ['Spelling', 'Matra', 'Agreement', 'Punctuation', 'Repeated word', 'Grammar'];

/** Of a line this long, the most characters a fix may change. */
const editBudget = (length) => Math.max(4, Math.ceil(length * 0.35));

/** [tags], pause marks, numbers and Latin-letter words, in order: what a fix must keep exactly. */
const fixedParts = (text) => (text.match(/\[[^\]]*\]|‖|\d+(?:[.,:]\d+)*|[A-Za-z][A-Za-z'’-]*/g) || []).join('\u0001');

/** Characters changed between two strings (Levenshtein over code points), stopping once past `limit`. */
export const editDistance = (a, b, limit = Infinity) => {
  const x = Array.from(a);
  const y = Array.from(b);
  if (Math.abs(x.length - y.length) > limit) return limit + 1;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      if (row[j] < best) best = row[j];
    }
    if (best > limit) return limit + 1;
    prev = row;
  }
  return prev[y.length];
};

/**
 * Whether a proposed fix may be offered: different from the line, keeps every
 * tag, pause, number and Latin word, keeps the line breaks, and changes only a
 * small part. Returns the reason it may not, or null.
 */
export const acceptFix = (text, fixed) => {
  if (typeof fixed !== 'string' || !fixed.trim()) return 'empty';
  const a = text.trim();
  const b = fixed.trim();
  if (a === b) return 'unchanged';
  if ((a.match(/\n/g) || []).length !== (b.match(/\n/g) || []).length) return 'lines';
  if (fixedParts(a) !== fixedParts(b)) return 'kept parts';
  const budget = editBudget(Array.from(a).length);
  if (editDistance(a, b, budget) > budget) return 'too big';
  return null;
};

export const buildGrammarPrompt = ({ lines, language }) => {
  const lang = language || 'the dub language';
  const rows = lines.map((l) => JSON.stringify({ id: l.id, line: l.text, ...(l.sourceText && { original: l.sourceText }) })).join('\n');
  return `You are a careful ${lang} proofreader checking a dubbing script. Each row is one dub line in ${lang}, with the original line it translates for reference.

Find real mistakes in the ${lang} dub lines only:
- Spelling: a wrongly written word, including wrong conjuncts.
- Matra: a wrong or missing vowel sign, bindu, chandrabindu, nukta or halant.
- Agreement: gender, number or person agreement between subject, verb, adjective and postposition.
- Punctuation: a question that ends with a danda or full stop although the original line asks it, a missing or doubled mark.
- Repeated word: a word written twice by mistake.
- Grammar: a wrong postposition, case or verb form.

Rules:
- Make the smallest fix. Keep every other word, its order and its spelling exactly as written.
- Do not reword, shorten, lengthen, translate or make a line sound better. Style, word choice, register and Hindi/Urdu/English word mixes are not mistakes.
- Spoken, informal grammar that people really say is not a mistake.
- Never change anything inside square brackets, the mark ‖, numbers, or words in Latin letters.
- Keep line breaks inside a line.
- Use the original line only to understand the dub line (is it a question, who is speaking about whom). Never bring its words in.
- If you are not sure it is a mistake, leave the line out.

Rows:
${rows}

Respond with ONLY this JSON, listing only lines that have a mistake:
{"fixes":[{"id":"<row id>","fixed":"<the whole dub line with the fix>","kind":"<one of: ${GRAMMAR_KINDS.join(', ')}>","why":"<what was wrong, in a few plain English words>"}]}`;
};

/** One batch: its fixes, each passed by acceptFix. */
const checkBatch = async (lines, language, { apiKey, generate, effort }) => {
  const { response } = await generate({
    contents: { role: 'user', parts: [{ text: buildGrammarPrompt({ lines, language }) }] },
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    ...(effort && { effort }),
    apiKey,
  });
  let parsed;
  try {
    parsed = parseJsonResponse(response?.text, 'Grammar check');
  } catch {
    return { fixes: [], unread: lines.length };
  }
  const byId = new Map(lines.map((l) => [l.id, l]));
  const seen = new Set();
  const fixes = [];
  let dropped = 0;
  for (const f of Array.isArray(parsed?.fixes) ? parsed.fixes : []) {
    const id = f?.id == null ? '' : String(f.id);
    const line = byId.get(id);
    if (!line || seen.has(id)) continue;
    seen.add(id);
    const fixed = typeof f.fixed === 'string' ? f.fixed.trim() : '';
    if (acceptFix(line.text, fixed)) {
      dropped++;
      continue;
    }
    const kind = GRAMMAR_KINDS.includes(f.kind) ? f.kind : 'Grammar';
    const why = typeof f.why === 'string' ? f.why.trim().slice(0, 200) : '';
    fixes.push({ id, fixed, kind, why });
  }
  return { fixes, dropped, unread: 0 };
};

/**
 * Checks `lines` ([{ id, text, sourceText }]) in `language`, batch by batch.
 * Returns `{ fixes, dropped, unread }`: `fixes` in line order, `dropped` the
 * fixes acceptFix turned away, `unread` lines whose batch gave no readable
 * answer. Throws when the text model can't be reached.
 */
export const checkGrammar = async ({ lines, language }, { apiKey, generate = generateText, effort = reviewEffort() } = {}) => {
  const clean = (Array.isArray(lines) ? lines : [])
    .filter((l) => l && l.id != null && typeof l.text === 'string' && l.text.trim())
    .slice(0, MAX_GRAMMAR_LINES)
    .map((l) => ({
      id: String(l.id),
      text: l.text.slice(0, MAX_LINE_CHARS),
      sourceText: typeof l.sourceText === 'string' ? l.sourceText.slice(0, MAX_LINE_CHARS) : '',
    }));
  const batches = [];
  for (let i = 0; i < clean.length; i += GRAMMAR_BATCH) batches.push(clean.slice(i, i + GRAMMAR_BATCH));
  const started = Date.now();
  const results = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const n = next++;
      results[n] = await checkBatch(batches[n], language, { apiKey, generate, effort });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker));
  const order = new Map(clean.map((l, n) => [l.id, n]));
  const fixes = results.flatMap((r) => r.fixes).sort((a, b) => order.get(a.id) - order.get(b.id));
  const dropped = results.reduce((s, r) => s + (r.dropped || 0), 0);
  const unread = results.reduce((s, r) => s + (r.unread || 0), 0);
  logger.info(
    `Grammar check of ${clean.length} line(s) in ${((Date.now() - started) / 1000).toFixed(1)} s: ${fixes.length} fix(es)${dropped ? `, ${dropped} dropped` : ''}${unread ? `, ${unread} unread` : ''}.`
  );
  return { fixes, dropped, unread };
};

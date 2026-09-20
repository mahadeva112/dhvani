/**
 * Pre-delivery QA.
 *
 * Everything here is computed from data the app already holds — ElevenLabs
 * timings, the translated cue text, and the house glossary — so a report is
 * reproducible and needs no network call. Each rule either passes, raises
 * warnings, or blocks; blocking findings are what stand between a job and a
 * sign-off.
 *
 * Rules that cannot be judged (no source text at all, no glossary for this
 * language) report `skipped` rather than a false pass: a check nobody ran is
 * not a check that passed.
 */

import { useEffect, useState } from 'react';
import { AudioSegment } from '../types';
import { GlossaryTerm } from './glossaryService';

export type QaSeverity = 'warn' | 'block';
export type QaStatus = 'pass' | 'warn' | 'block' | 'skipped';

export type QaRuleId =
  | 'timing-integrity'
  | 'cue-order'
  | 'timing-source'
  | 'translation-coverage'
  | 'reading-speed'
  | 'cue-length'
  | 'locked-terms'
  | 'preferred-terms'
  | 'script-purity'
  | 'latin-digits'
  | 'speaker-coverage';

export interface QaRuleConfig {
  /** Characters per second a viewer can comfortably read. */
  maxCps: number;
  /** A cue shorter than this flashes past before it can be read. */
  minCueSeconds: number;
  /** A cue longer than this has almost certainly merged two thoughts. */
  maxCueSeconds: number;
  /** Characters in one cue before it stops fitting a two-line subtitle. */
  maxCharsPerCue: number;
  /** Shortest run of Latin letters in a non-Latin target worth flagging. */
  minLatinRun: number;
  /** Flag 0-9 left in a target whose script has its own numerals. */
  flagLatinDigits: boolean;
}

export const DEFAULT_QA_CONFIG: QaRuleConfig = {
  maxCps: 17,
  minCueSeconds: 0.7,
  maxCueSeconds: 7,
  maxCharsPerCue: 90,
  minLatinRun: 4,
  flagLatinDigits: false,
};

export interface QaFinding {
  /** Stable across re-runs, so an override survives a recheck. */
  id: string;
  ruleId: QaRuleId;
  severity: QaSeverity;
  segmentId: string | number;
  /** 1-based position in the cue list, i.e. the SRT cue number. */
  cueNumber: number;
  startTime: number;
  endTime: number;
  title: string;
  detail: string;
  /** The offending substring of the target text, for highlighting. */
  match?: string;
  /** A one-click correction, when the rule can produce one safely. */
  fix?: { label: string; nextTarget: string };
}

export interface QaRuleResult {
  id: QaRuleId;
  label: string;
  description: string;
  /** What this rule raises when it fails. */
  severity: QaSeverity;
  status: QaStatus;
  findingCount: number;
  /** One line a reviewer can read without opening the findings. */
  detail: string;
}

export interface QaReport {
  generatedAt: number;
  language: string;
  cueCount: number;
  rules: QaRuleResult[];
  findings: QaFinding[];
  counts: { pass: number; warn: number; block: number; skipped: number };
  blockingCount: number;
  warningCount: number;
}

/* ------------------------------------------------------------------ */
/* Script ranges                                                       */
/* ------------------------------------------------------------------ */

/**
 * Where each target language's letters live in Unicode. Used only to tell
 * "this is the target script" from "this is untranslated English". A language
 * missing here simply skips the script checks.
 */
const SCRIPT_RANGES: Record<string, string[]> = {
  Assamese: ['ঀ-৿'],
  Bengali: ['ঀ-৿'],
  Bodo: ['ऀ-ॿ'],
  Dogri: ['ऀ-ॿ'],
  Gujarati: ['઀-૿'],
  Hindi: ['ऀ-ॿ'],
  Kannada: ['ಀ-೿'],
  Kashmiri: ['؀-ۿ', 'ݐ-ݿ'],
  Konkani: ['ऀ-ॿ'],
  Maithili: ['ऀ-ॿ'],
  Malayalam: ['ഀ-ൿ'],
  // Manipuri is written in both Meetei Mayek and the Bengali script.
  Manipuri: ['ꯀ-꯿', 'ঀ-৿'],
  Marathi: ['ऀ-ॿ'],
  Nepali: ['ऀ-ॿ'],
  Odia: ['଀-୿'],
  Punjabi: ['਀-੿'],
  Sanskrit: ['ऀ-ॿ'],
  Santali: ['᱐-᱿', 'ऀ-ॿ'],
  Sindhi: ['؀-ۿ', 'ݐ-ݿ'],
  Tamil: ['஀-௿'],
  Telugu: ['ఀ-౿'],
  Urdu: ['؀-ۿ', 'ݐ-ݿ'],
};

function rangesForLanguage(language: string): string[] | null {
  const name = (language || '').trim();
  if (!name) return null;
  if (SCRIPT_RANGES[name]) return SCRIPT_RANGES[name];
  const lower = name.toLowerCase();
  for (const [key, ranges] of Object.entries(SCRIPT_RANGES)) {
    if (lower.startsWith(key.toLowerCase())) return ranges;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

const sourceOf = (seg: AudioSegment) => (seg.textSource || seg.originalText || '').trim();
const targetOf = (seg: AudioSegment) => (seg.textTarget || seg.targetText || '').trim();

const durationOf = (seg: AudioSegment) => {
  const measured = seg.endTime - seg.startTime;
  if (Number.isFinite(measured) && measured > 0) return measured;
  return Number.isFinite(seg.duration) ? seg.duration : 0;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Case-insensitive containment that does not fire on a word fragment in Latin
 * text ("Isha" must not match "Ishaan"). Indic scripts have no case and no
 * \b support worth relying on, so those fall back to plain containment.
 */
function containsTerm(haystack: string, needle: string): boolean {
  if (!needle) return false;
  if (/^[\x20-\x7E]+$/.test(needle)) {
    const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(needle)}([^A-Za-z0-9]|$)`, 'i');
    return re.test(haystack);
  }
  return haystack.includes(needle);
}

/** The first occurrence of `needle`, matched the same way as containsTerm. */
function findTerm(haystack: string, needle: string): string | null {
  if (!needle) return null;
  if (/^[\x20-\x7E]+$/.test(needle)) {
    const re = new RegExp(`(^|[^A-Za-z0-9])(${escapeRegExp(needle)})([^A-Za-z0-9]|$)`, 'i');
    const m = re.exec(haystack);
    return m ? m[2] : null;
  }
  return haystack.includes(needle) ? needle : null;
}

function replaceTerm(haystack: string, needle: string, replacement: string): string {
  if (/^[\x20-\x7E]+$/.test(needle)) {
    const re = new RegExp(`(^|[^A-Za-z0-9])(${escapeRegExp(needle)})([^A-Za-z0-9]|$)`, 'gi');
    return haystack.replace(re, (_m, before, _hit, after) => `${before}${replacement}${after}`);
  }
  return haystack.split(needle).join(replacement);
}

export const formatTimecode = (seconds: number): string => {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
};

/* ------------------------------------------------------------------ */
/* The rules                                                           */
/* ------------------------------------------------------------------ */

interface RuleDefinition {
  id: QaRuleId;
  label: string;
  description: string;
  severity: QaSeverity;
}

const RULES: RuleDefinition[] = [
  {
    id: 'timing-integrity',
    label: 'Timestamps well formed',
    description: 'Every cue ends after it starts and carries a real duration.',
    severity: 'block',
  },
  {
    id: 'cue-order',
    label: 'Cues continuous, no overlap',
    description: 'Cues run in order and never sit on top of one another.',
    severity: 'block',
  },
  {
    id: 'timing-source',
    label: 'Timings measured, not derived',
    description: 'Each cue is cut on ElevenLabs word boundaries rather than an estimate.',
    severity: 'warn',
  },
  {
    id: 'translation-coverage',
    label: 'Every spoken cue translated',
    description: 'No cue with dialogue was left without target text.',
    severity: 'block',
  },
  {
    id: 'reading-speed',
    label: 'Reading speed within limit',
    description: 'Target text fits its window at a readable characters-per-second rate.',
    severity: 'warn',
  },
  {
    id: 'cue-length',
    label: 'Cue duration and length sane',
    description: 'No cue flashes past, runs long, or overflows two subtitle lines.',
    severity: 'warn',
  },
  {
    id: 'locked-terms',
    label: 'Do-not-translate terms intact',
    description: 'Names and programme titles survived translation unchanged.',
    severity: 'block',
  },
  {
    id: 'preferred-terms',
    label: 'House renderings used',
    description: 'No cue uses a rendering the language lead has rejected.',
    severity: 'block',
  },
  {
    id: 'script-purity',
    label: 'No untranslated source text',
    description: 'No runs of Latin text left sitting in a non-Latin target.',
    severity: 'warn',
  },
  {
    id: 'latin-digits',
    label: 'Numerals localised',
    description: 'Digits use the target script rather than 0-9.',
    severity: 'warn',
  },
  {
    id: 'speaker-coverage',
    label: 'Speakers labelled',
    description: 'Every cue is attributed, so voice casting can be applied.',
    severity: 'warn',
  },
];

export interface RunQaOptions {
  language: string;
  glossary?: GlossaryTerm[];
  config?: Partial<QaRuleConfig>;
}

export function runQa(segments: AudioSegment[], options: RunQaOptions): QaReport {
  const config: QaRuleConfig = { ...DEFAULT_QA_CONFIG, ...(options.config || {}) };
  const language = options.language || '';
  const glossary = options.glossary || [];
  const cues = segments || [];

  const findings: QaFinding[] = [];
  /** Rules deliberately not judged this run, with the reason shown to the user. */
  const skipped = new Map<QaRuleId, string>();

  const push = (f: Omit<QaFinding, 'id'> & { key?: string }) => {
    const { key, ...rest } = f;
    findings.push({ ...rest, id: `${f.ruleId}:${String(f.segmentId)}${key ? `:${key}` : ''}` });
  };

  const scriptRanges = rangesForLanguage(language);
  const targetScriptRe = scriptRanges ? new RegExp(`[${scriptRanges.join('')}]`) : null;

  if (!scriptRanges) {
    const reason = language
      ? `No script profile for ${language}`
      : 'No target language selected';
    skipped.set('script-purity', reason);
    skipped.set('latin-digits', reason);
  } else if (!config.flagLatinDigits) {
    skipped.set('latin-digits', 'Turned off in check settings');
  }

  const languageGlossary = glossary.filter((t) => {
    const scope = (t.language || '').trim().toLowerCase();
    return scope === '' || scope === language.trim().toLowerCase();
  });
  const keepTerms = languageGlossary.filter((t) => t.policy === 'keep');
  const preferTerms = languageGlossary.filter(
    (t) => t.policy === 'prefer' && (t.forbidden || []).some((f) => f.trim() !== '')
  );
  if (keepTerms.length === 0) {
    skipped.set('locked-terms', 'No do-not-translate terms defined');
  }
  if (preferTerms.length === 0) {
    skipped.set('preferred-terms', 'No house renderings defined');
  }

  let anySourceText = false;
  let previousEnd: number | null = null;

  cues.forEach((seg, index) => {
    const cueNumber = index + 1;
    const source = sourceOf(seg);
    const target = targetOf(seg);
    const duration = durationOf(seg);
    const base = {
      segmentId: seg.id,
      cueNumber,
      startTime: seg.startTime,
      endTime: seg.endTime,
    };
    if (source) anySourceText = true;

    /* --- timing integrity ------------------------------------------ */
    if (!Number.isFinite(seg.startTime) || !Number.isFinite(seg.endTime) || duration <= 0) {
      push({
        ...base,
        ruleId: 'timing-integrity',
        severity: 'block',
        title: `Cue ${cueNumber} has no usable duration`,
        detail: `Starts at ${formatTimecode(seg.startTime)} and ends at ${formatTimecode(
          seg.endTime
        )}. A cue must end after it starts.`,
      });
    } else if (Math.abs(duration - (seg.duration ?? duration)) > 0.05) {
      push({
        ...base,
        ruleId: 'timing-integrity',
        severity: 'block',
        title: `Cue ${cueNumber} duration disagrees with its timestamps`,
        detail: `Stored duration ${(seg.duration ?? 0).toFixed(2)}s, timestamps say ${duration.toFixed(
          2
        )}s. Export would carry the timestamps, so the stored value is wrong.`,
      });
    }

    /* --- ordering and overlap -------------------------------------- */
    if (previousEnd !== null && Number.isFinite(seg.startTime)) {
      if (seg.startTime < previousEnd - 0.001) {
        push({
          ...base,
          ruleId: 'cue-order',
          severity: 'block',
          title: `Cue ${cueNumber} overlaps the cue before it`,
          detail: `Starts at ${formatTimecode(seg.startTime)}, but cue ${
            cueNumber - 1
          } is still on screen until ${formatTimecode(previousEnd)}.`,
        });
      }
    }
    if (Number.isFinite(seg.endTime)) previousEnd = seg.endTime;

    /* --- timing provenance ----------------------------------------- */
    if (seg.timingSource === 'derived') {
      push({
        ...base,
        ruleId: 'timing-source',
        severity: 'warn',
        title: `Cue ${cueNumber} timing was derived, not measured`,
        detail:
          'This cue was split by hand inside a measured cue, so its boundary is an estimate rather than an ElevenLabs word boundary.',
      });
    }

    /* --- translation coverage -------------------------------------- */
    if (source && !target) {
      push({
        ...base,
        ruleId: 'translation-coverage',
        severity: 'block',
        title: `Cue ${cueNumber} has no ${language || 'target'} text`,
        detail: `Source reads “${source.slice(0, 80)}${source.length > 80 ? '…' : ''}”.`,
      });
    }

    /* --- reading speed --------------------------------------------- */
    if (target && duration > 0) {
      const cps = target.length / duration;
      if (cps > config.maxCps) {
        push({
          ...base,
          ruleId: 'reading-speed',
          severity: 'warn',
          title: `Cue ${cueNumber} reads at ${cps.toFixed(1)} cps`,
          detail: `${target.length} characters in ${duration.toFixed(
            2
          )}s, over the ${config.maxCps} cps limit. Either shorten the line or the dub will race.`,
        });
      }
    }

    /* --- cue length ------------------------------------------------- */
    if (duration > 0 && duration < config.minCueSeconds) {
      push({
        ...base,
        key: 'short',
        ruleId: 'cue-length',
        severity: 'warn',
        title: `Cue ${cueNumber} is only ${duration.toFixed(2)}s`,
        detail: `Under the ${config.minCueSeconds}s floor — it will flash past before it can be read.`,
      });
    } else if (duration > config.maxCueSeconds) {
      push({
        ...base,
        key: 'long',
        ruleId: 'cue-length',
        severity: 'warn',
        title: `Cue ${cueNumber} runs ${duration.toFixed(2)}s`,
        detail: `Over the ${config.maxCueSeconds}s ceiling — it has most likely merged two sentences.`,
      });
    }
    if (target.length > config.maxCharsPerCue) {
      push({
        ...base,
        key: 'chars',
        ruleId: 'cue-length',
        severity: 'warn',
        title: `Cue ${cueNumber} is ${target.length} characters`,
        detail: `Over the ${config.maxCharsPerCue}-character ceiling for a two-line subtitle.`,
      });
    }

    /* --- glossary: do-not-translate --------------------------------- */
    keepTerms.forEach((term) => {
      const required = (term.target || term.source).trim();
      if (!source || !containsTerm(source, term.source)) return;
      if (containsTerm(target, required)) return;
      push({
        ...base,
        key: term.id,
        ruleId: 'locked-terms',
        severity: 'block',
        title: `Cue ${cueNumber} dropped the locked term “${term.source}”`,
        detail:
          term.note ||
          `The source cue uses “${term.source}”, which must appear in the target as “${required}”.`,
      });
    });

    /* --- glossary: house renderings --------------------------------- */
    preferTerms.forEach((term) => {
      const approved = (term.target || '').trim();
      (term.forbidden || []).forEach((rejected) => {
        const trimmed = rejected.trim();
        if (!trimmed) return;
        const hit = findTerm(target, trimmed);
        if (!hit) return;
        push({
          ...base,
          key: `${term.id}:${trimmed}`,
          ruleId: 'preferred-terms',
          severity: 'block',
          title: `Cue ${cueNumber} uses “${trimmed}” for “${term.source}”`,
          detail:
            term.note ||
            (approved
              ? `The house rendering is “${approved}”.`
              : `“${trimmed}” is not an approved rendering of “${term.source}”.`),
          match: hit,
          fix: approved
            ? {
                label: `Apply house term “${approved}”`,
                nextTarget: replaceTerm(target, trimmed, approved),
              }
            : undefined,
        });
      });
    });

    /* --- script purity ---------------------------------------------- */
    if (targetScriptRe && target && targetScriptRe.test(target)) {
      const latinRuns = target.match(
        new RegExp(`[A-Za-z][A-Za-z'’\\-]{${Math.max(0, config.minLatinRun - 1)},}`, 'g')
      );
      if (latinRuns && latinRuns.length > 0) {
        // A run that a glossary rule requires to stay in Latin is not a defect.
        const allowed = new Set(
          keepTerms
            .map((t) => (t.target || t.source).trim().toLowerCase())
            .filter((v) => v !== '')
        );
        const offenders = latinRuns.filter((run) => !allowed.has(run.toLowerCase()));
        if (offenders.length > 0) {
          push({
            ...base,
            ruleId: 'script-purity',
            severity: 'warn',
            title: `Cue ${cueNumber} still carries Latin text`,
            detail: `Found ${offenders.length === 1 ? '' : `${offenders.length} runs, starting with `}“${
              offenders[0]
            }”. Either translate it or add it to the glossary as a do-not-translate term.`,
            match: offenders[0],
          });
        }
      }
    }

    /* --- numerals ---------------------------------------------------- */
    if (config.flagLatinDigits && targetScriptRe && target) {
      const digits = target.match(/\d+/g);
      if (digits && digits.length > 0) {
        push({
          ...base,
          ruleId: 'latin-digits',
          severity: 'warn',
          title: `Cue ${cueNumber} uses Latin numerals`,
          detail: `Found “${digits[0]}”. House style is to write numerals in the target script.`,
          match: digits[0],
        });
      }
    }

    /* --- speaker coverage --------------------------------------------- */
    if (!(seg.speaker || '').trim()) {
      push({
        ...base,
        ruleId: 'speaker-coverage',
        severity: 'warn',
        title: `Cue ${cueNumber} has no speaker`,
        detail: 'Without a speaker label this cue cannot be routed to a cast voice.',
      });
    }
  });

  if (!anySourceText) {
    skipped.set('translation-coverage', 'No source transcript to compare against');
    skipped.set('locked-terms', 'No source transcript to compare against');
  }
  if (cues.length === 0) {
    RULES.forEach((r) => skipped.set(r.id, 'No cues to check'));
  }

  const visibleFindings = findings.filter((f) => !skipped.has(f.ruleId));

  const rules: QaRuleResult[] = RULES.map((rule) => {
    const skipReason = skipped.get(rule.id);
    const own = visibleFindings.filter((f) => f.ruleId === rule.id);
    if (skipReason) {
      return { ...rule, status: 'skipped' as QaStatus, findingCount: 0, detail: skipReason };
    }
    if (own.length === 0) {
      return {
        ...rule,
        status: 'pass' as QaStatus,
        findingCount: 0,
        detail: describePass(rule.id, cues.length),
      };
    }
    return {
      ...rule,
      status: rule.severity as QaStatus,
      findingCount: own.length,
      detail: `${own.length} ${own.length === 1 ? 'cue' : 'cues'} flagged`,
    };
  });

  const counts = rules.reduce(
    (acc, r) => {
      acc[r.status] += 1;
      return acc;
    },
    { pass: 0, warn: 0, block: 0, skipped: 0 }
  );

  return {
    generatedAt: Date.now(),
    language,
    cueCount: cues.length,
    rules,
    findings: visibleFindings.sort(
      (a, b) =>
        (a.severity === b.severity ? 0 : a.severity === 'block' ? -1 : 1) ||
        a.cueNumber - b.cueNumber
    ),
    counts,
    blockingCount: visibleFindings.filter((f) => f.severity === 'block').length,
    warningCount: visibleFindings.filter((f) => f.severity === 'warn').length,
  };
}

/* ------------------------------------------------------------------ */
/* Threshold persistence                                               */
/* ------------------------------------------------------------------ */

const CONFIG_KEY = 'dhvani_qa_config';
const CONFIG_EVENT = 'dhvani:qa-config-changed';

export function loadQaConfig(): QaRuleConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_QA_CONFIG, ...JSON.parse(raw) };
  } catch {
    // fall through to defaults
  }
  return DEFAULT_QA_CONFIG;
}

export function saveQaConfig(config: QaRuleConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Storage full or blocked; the thresholds hold for this session only.
  }
  try {
    window.dispatchEvent(new CustomEvent<QaRuleConfig>(CONFIG_EVENT, { detail: config }));
  } catch {
    // ignore
  }
}

/**
 * The thresholds as live state, so the badge on the review ribbon and the
 * cockpit that edits them never disagree.
 */
export function useQaConfig(): [QaRuleConfig, (next: QaRuleConfig) => void] {
  const [config, setConfig] = useState<QaRuleConfig>(() => loadQaConfig());

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<QaRuleConfig>).detail;
      setConfig(detail && typeof detail === 'object' ? detail : loadQaConfig());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === CONFIG_KEY) setConfig(loadQaConfig());
    };
    window.addEventListener(CONFIG_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CONFIG_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return [config, saveQaConfig];
}

function describePass(id: QaRuleId, cueCount: number): string {
  switch (id) {
    case 'cue-order':
      return `${cueCount} cues in order`;
    case 'translation-coverage':
      return `${cueCount} of ${cueCount} translated`;
    default:
      return `${cueCount} ${cueCount === 1 ? 'cue' : 'cues'} clear`;
  }
}

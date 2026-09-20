/**
 * The sign-off chain.
 *
 * A dub leaves the studio only after three things have happened in order:
 * the automated checks passed, a language lead put their name to the script,
 * and brand or compliance accepted it. Each stage records who signed and when,
 * and an overridden blocking finding records who waived it and why — that
 * record is the point of the whole feature.
 *
 * Sign-offs are keyed by job and target language, because the same master
 * dubbed into Tamil and Hindi is two separate approvals.
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'dhvani_signoffs_v1';
const CHANGE_EVENT = 'dhvani:signoffs-changed';
const REVIEWER_KEY = 'dhvani_reviewer_name';

export type SignoffStageId = 'machine' | 'language-lead' | 'compliance';
export type SignoffStageStatus = 'pending' | 'passed' | 'signed' | 'rejected';

export interface SignoffStage {
  status: SignoffStageStatus;
  by?: string;
  at?: number;
  note?: string;
}

export interface FindingOverride {
  by: string;
  at: number;
  reason: string;
}

export interface JobSignoff {
  key: string;
  jobId: string;
  language: string;
  stages: Record<SignoffStageId, SignoffStage>;
  /** Blocking findings a human has explicitly waived, by finding id. */
  overrides: Record<string, FindingOverride>;
  /** Bumped whenever the script changes under a completed sign-off. */
  updatedAt: number;
}

export const SIGNOFF_STAGES: { id: SignoffStageId; label: string; description: string }[] = [
  {
    id: 'machine',
    label: 'Automated QA',
    description: 'Timing, coverage, reading speed and locked terminology.',
  },
  {
    id: 'language-lead',
    label: 'Language lead',
    description: 'A native reviewer signs for meaning, tone and register.',
  },
  {
    id: 'compliance',
    label: 'Brand & compliance',
    description: 'Final acceptance before the file leaves the studio.',
  },
];

export function signoffKey(jobId: string, language: string): string {
  return `${jobId}::${(language || '').trim().toLowerCase()}`;
}

function emptySignoff(jobId: string, language: string): JobSignoff {
  return {
    key: signoffKey(jobId, language),
    jobId,
    language,
    stages: {
      machine: { status: 'pending' },
      'language-lead': { status: 'pending' },
      compliance: { status: 'pending' },
    },
    overrides: {},
    updatedAt: Date.now(),
  };
}

function readAll(): Record<string, JobSignoff> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, JobSignoff>;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, JobSignoff>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage full or blocked; this session keeps its copy in memory.
  }
  try {
    window.dispatchEvent(new CustomEvent<Record<string, JobSignoff>>(CHANGE_EVENT, { detail: all }));
  } catch {
    // ignore
  }
}

export function getSignoff(jobId: string, language: string): JobSignoff {
  const all = readAll();
  const existing = all[signoffKey(jobId, language)];
  if (!existing) return emptySignoff(jobId, language);
  // Older records may predate a stage; fill the gaps rather than crash on read.
  return {
    ...emptySignoff(jobId, language),
    ...existing,
    stages: { ...emptySignoff(jobId, language).stages, ...(existing.stages || {}) },
    overrides: existing.overrides || {},
  };
}

function mutate(jobId: string, language: string, fn: (s: JobSignoff) => JobSignoff): JobSignoff {
  const all = readAll();
  const key = signoffKey(jobId, language);
  const next = { ...fn(getSignoff(jobId, language)), key, jobId, language, updatedAt: Date.now() };
  all[key] = next;
  writeAll(all);
  return next;
}

export function recordMachineResult(
  jobId: string,
  language: string,
  passed: boolean,
  note: string
): JobSignoff {
  return mutate(jobId, language, (s) => ({
    ...s,
    stages: {
      ...s.stages,
      machine: { status: passed ? 'passed' : 'pending', at: Date.now(), note },
    },
  }));
}

export function signStage(
  jobId: string,
  language: string,
  stage: SignoffStageId,
  by: string,
  note?: string
): JobSignoff {
  return mutate(jobId, language, (s) => ({
    ...s,
    stages: { ...s.stages, [stage]: { status: 'signed', by, at: Date.now(), note } },
  }));
}

export function rejectStage(
  jobId: string,
  language: string,
  stage: SignoffStageId,
  by: string,
  note: string
): JobSignoff {
  return mutate(jobId, language, (s) => ({
    ...s,
    stages: { ...s.stages, [stage]: { status: 'rejected', by, at: Date.now(), note } },
  }));
}

export function clearStage(jobId: string, language: string, stage: SignoffStageId): JobSignoff {
  return mutate(jobId, language, (s) => ({
    ...s,
    stages: { ...s.stages, [stage]: { status: 'pending' } },
  }));
}

export function overrideFinding(
  jobId: string,
  language: string,
  findingId: string,
  by: string,
  reason: string
): JobSignoff {
  return mutate(jobId, language, (s) => ({
    ...s,
    overrides: { ...s.overrides, [findingId]: { by, at: Date.now(), reason } },
  }));
}

export function clearOverride(jobId: string, language: string, findingId: string): JobSignoff {
  return mutate(jobId, language, (s) => {
    const next = { ...s.overrides };
    delete next[findingId];
    return { ...s, overrides: next };
  });
}

/**
 * Editing the script after someone signed invalidates their signature: they
 * approved words that are no longer there.
 */
export function invalidateHumanStages(jobId: string, language: string): JobSignoff {
  return mutate(jobId, language, (s) => ({
    ...s,
    stages: {
      ...s.stages,
      'language-lead':
        s.stages['language-lead'].status === 'signed'
          ? { status: 'pending', note: 'Cleared — the script changed after signing.' }
          : s.stages['language-lead'],
      compliance:
        s.stages.compliance.status === 'signed'
          ? { status: 'pending', note: 'Cleared — the script changed after signing.' }
          : s.stages.compliance,
    },
  }));
}

export function getReviewerName(): string {
  try {
    return localStorage.getItem(REVIEWER_KEY) || '';
  } catch {
    return '';
  }
}

export function setReviewerName(name: string): void {
  try {
    localStorage.setItem(REVIEWER_KEY, name);
  } catch {
    // ignore
  }
}

/** One job's sign-off as live state, kept in step with other open views. */
export function useSignoff(
  jobId: string | null,
  language: string
): {
  signoff: JobSignoff | null;
  refresh: () => void;
} {
  const [signoff, setSignoff] = useState<JobSignoff | null>(() =>
    jobId ? getSignoff(jobId, language) : null
  );

  const refresh = useCallback(() => {
    setSignoff(jobId ? getSignoff(jobId, language) : null);
  }, [jobId, language]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onChange = () => refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) refresh();
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [refresh]);

  return { signoff, refresh };
}

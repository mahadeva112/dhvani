/**
 * Locked terminology — the house vocabulary a dub is checked against.
 *
 * Two policies, because two different mistakes get made:
 *
 * - `keep`   a name that must survive translation untouched (a teacher's name,
 *            a programme title). Violated when the source cue uses it and the
 *            target cue has dropped it.
 * - `prefer` a word the house has already settled on. Violated when a cue uses
 *            one of the rejected renderings instead.
 *
 * Terms live in localStorage next to the rest of the app's settings, and every
 * change is broadcast so an open QA cockpit re-runs its checks immediately.
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'dhvani_glossary_terms';
const CHANGE_EVENT = 'dhvani:glossary-changed';

export type GlossaryPolicy = 'keep' | 'prefer';

export interface GlossaryTerm {
  id: string;
  /** The source-language term, as it appears in the transcript. */
  source: string;
  policy: GlossaryPolicy;
  /**
   * `keep`: the exact string that must appear in the target cue. Blank means
   * "the source term, unchanged".
   * `prefer`: the approved target rendering that replaces any rejected one.
   */
  target?: string;
  /** `prefer` only: renderings that must not appear in a target cue. */
  forbidden?: string[];
  /**
   * Target language this rule applies to. Blank means every language, which is
   * the normal case for a `keep` rule on a proper noun.
   */
  language?: string;
  note?: string;
}

function read(): GlossaryTerm[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is GlossaryTerm =>
        !!t && typeof t.id === 'string' && typeof t.source === 'string' && t.source.trim() !== ''
    );
  } catch {
    return [];
  }
}

function write(terms: GlossaryTerm[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(terms));
  } catch {
    // Storage full or blocked; the list stays in memory for this session only.
  }
  try {
    window.dispatchEvent(new CustomEvent<GlossaryTerm[]>(CHANGE_EVENT, { detail: terms }));
  } catch {
    // ignore
  }
}

export function getGlossaryTerms(): GlossaryTerm[] {
  return read();
}

/** The terms that apply to one target language, in the order they were added. */
export function getTermsForLanguage(language: string): GlossaryTerm[] {
  const lang = (language || '').trim().toLowerCase();
  return read().filter((t) => {
    const scope = (t.language || '').trim().toLowerCase();
    return scope === '' || scope === lang;
  });
}

export function addGlossaryTerm(term: Omit<GlossaryTerm, 'id'>): GlossaryTerm {
  const created: GlossaryTerm = {
    ...term,
    id: `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  };
  write([...read(), created]);
  return created;
}

export function updateGlossaryTerm(id: string, updates: Partial<GlossaryTerm>): void {
  write(read().map((t) => (t.id === id ? { ...t, ...updates, id: t.id } : t)));
}

export function removeGlossaryTerm(id: string): void {
  write(read().filter((t) => t.id !== id));
}

export function replaceGlossaryTerms(terms: GlossaryTerm[]): void {
  write(terms);
}

/**
 * The glossary as a live list. Any component using this hook re-renders when a
 * term is added or edited anywhere in the app, including in another tab.
 */
export function useGlossaryTerms(): {
  terms: GlossaryTerm[];
  add: (term: Omit<GlossaryTerm, 'id'>) => void;
  update: (id: string, updates: Partial<GlossaryTerm>) => void;
  remove: (id: string) => void;
} {
  const [terms, setTerms] = useState<GlossaryTerm[]>(() => read());

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<GlossaryTerm[]>).detail;
      setTerms(Array.isArray(detail) ? detail : read());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setTerms(read());
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const add = useCallback((term: Omit<GlossaryTerm, 'id'>) => {
    addGlossaryTerm(term);
  }, []);
  const update = useCallback((id: string, updates: Partial<GlossaryTerm>) => {
    updateGlossaryTerm(id, updates);
  }, []);
  const remove = useCallback((id: string) => {
    removeGlossaryTerm(id);
  }, []);

  return { terms, add, update, remove };
}

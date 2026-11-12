import { apiJson } from './apiClient';

/** One fix the grammar check proposes for one cue's dub text. */
export interface GrammarFix {
  id: string;
  /** The cue's text when it was checked. */
  text: string;
  /** The whole text with the fix. */
  fixed: string;
  kind: string;
  why: string;
}

export type GrammarState = 'open' | 'accepted' | 'skipped';

/**
 * Asks the server for grammar fixes of these lines (POST /sync/grammar-check).
 * Only lines that need a fix come back, each with the text it was checked on.
 */
export const checkGrammar = async (
  lines: { id: string; text: string; sourceText?: string }[],
  language: string,
  { signal }: { signal?: AbortSignal } = {}
): Promise<{ fixes: GrammarFix[]; unread: number }> => {
  const result = await apiJson<{ fixes?: { id: string; fixed: string; kind?: string; why?: string }[]; unread?: number }>('/sync/grammar-check', {
    body: { lines, language },
    signal,
  });
  const byId = new Map(lines.map((l) => [l.id, l.text]));
  const fixes = (Array.isArray(result.fixes) ? result.fixes : [])
    .filter((f) => typeof f?.fixed === 'string' && byId.has(String(f.id)))
    .map((f) => ({ id: String(f.id), text: byId.get(String(f.id)) as string, fixed: f.fixed, kind: f.kind || 'Grammar', why: f.why || '' }));
  return { fixes, unread: Number(result.unread) || 0 };
};

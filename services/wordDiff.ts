export type DiffPart = { text: string; type: 'same' | 'del' | 'ins' };

/** Words, spaces and marks, so a diff shows a changed word or a changed mark on its own. */
const tokens = (text: string) => text.match(/\s+|[।॥?!,.;:"'“”‘’…—–-]|[^\s।॥?!,.;:"'“”‘’…—–-]+/g) || [];

/** What changed from `a` to `b`, word by word, for showing a fix with the old words struck out. */
export const diffWords = (a: string, b: string): DiffPart[] => {
  const x = tokens(a);
  const y = tokens(b);
  const lcs: number[][] = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (text: string, type: DiffPart['type']) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ text, type });
  };
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      push(x[i], 'same');
      i++;
      j++;
    } else if (j < y.length && (i >= x.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      push(y[j++], 'ins');
    } else {
      push(x[i++], 'del');
    }
  }
  return out;
};

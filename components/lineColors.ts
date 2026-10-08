/**
 * A colour per line, so one line can be followed from Review's script
 * through the sync preview to the sync report: line N is the same colour in
 * every lane, list and link. Lines are numbered as Sync groups them (a sync
 * unit's index), and a cue takes the colour of the line it belongs to.
 *
 * The colours repeat and leave out green, amber and red, which say how a line
 * fits or landed.
 */
export const LINE_HUES = ['#7dd3fc', '#c4b5fd', '#f9a8d4', '#5eead4', '#a5b4fc', '#e9d5a8'];

export const hueOf = (index: number) => LINE_HUES[((index % LINE_HUES.length) + LINE_HUES.length) % LINE_HUES.length];

export const withAlpha = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/** Each cue's line number, from lines that list their cues; a cue in no line is missing from the map. */
export const lineIndexByCue = (lines: { index: number; cueIds: (string | number)[] }[] | null | undefined) => {
  const map = new Map<string, number>();
  for (const line of lines ?? []) for (const id of line.cueIds) map.set(String(id), line.index);
  return map;
};

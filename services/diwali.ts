/**
 * When the Happy Diwali greeting shows: on every new project around Diwali,
 * from two days before to four days after.
 */

/** Diwali (Lakshmi Puja) by year, as month (1-12) and day. */
export const DIWALI_DATES: Record<number, [number, number]> = {
  2026: [11, 8],
  2027: [10, 29],
  2028: [10, 17],
  2029: [11, 5],
  2030: [10, 26],
};

const DAYS_BEFORE = 2;
const DAYS_AFTER = 4;
const DAY_MS = 86_400_000;

/** The local calendar day, as YYYY-MM-DD. */
export function localDay(now: Date): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/** True when the local day falls in the Diwali days of its year. */
export function isDiwaliTime(now: Date): boolean {
  const date = DIWALI_DATES[now.getFullYear()];
  if (!date) return false;
  // Whole local days, counted at noon so a clock change never shifts the count.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
  const diwali = new Date(now.getFullYear(), date[0] - 1, date[1], 12).getTime();
  const offset = Math.round((today - diwali) / DAY_MS);
  return offset >= -DAYS_BEFORE && offset <= DAYS_AFTER;
}

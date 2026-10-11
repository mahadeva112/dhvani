/**
 * Places dub clips on the source timeline without stretching them.
 *
 * Every clip is rigid: it can only move. Each clip wants its first word to
 * land where its source phrase starts, clips must stay in order, and each
 * must leave at least a minimum pause before the next. When a clip is too long
 * for its slot those wishes conflict, and the placement that disagrees with
 * them least (weighted squared error of each clip's start) is found exactly:
 *
 *   minimise  Σ wᵢ (pᵢ − wantᵢ)²   subject to  pᵢ₊₁ ≥ pᵢ + lengthᵢ + gapᵢ
 *
 * Subtracting the running total Cᵢ of lengths and gaps turns the constraint
 * into uᵢ₊₁ ≥ uᵢ with uᵢ = pᵢ − Cᵢ, which is isotonic regression, solved in
 * linear time by pool-adjacent-violators. The error of a long clip is shared
 * by the clips around it rather than pushed onto every clip after it.
 *
 * This is the placer Samanvaya uses in REAPER (sync_matcher.py, _place_isotonic).
 */

/**
 * Weighted pool-adjacent-violators: the non-decreasing sequence closest to
 * `values` in weighted least squares.
 */
export const pava = (values, weights = values.map(() => 1)) => {
  const blocks = [];
  values.forEach((value, i) => {
    blocks.push({ value, weight: weights[i], count: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].value > blocks[blocks.length - 1].value) {
      const last = blocks.pop();
      const prev = blocks.pop();
      const weight = prev.weight + last.weight;
      blocks.push({
        value: (prev.value * prev.weight + last.value * last.weight) / weight,
        weight,
        count: prev.count + last.count,
      });
    }
  });
  return blocks.flatMap((block) => Array(block.count).fill(block.value));
};

/**
 * Chooses a start position for each clip.
 *
 * `clips[i]` is `{ want, length, gapAfter, weight?, earliest?, latest?, fixed?, floor? }`:
 * `want` is the position that puts its first word on the source phrase,
 * `length` the clip's length, `gapAfter` the minimum pause before the next
 * clip, `earliest` the soonest it may start (a dub line may not start
 * noticeably before the source line it translates) and `floor` the lowest
 * position the track allows (0 by default; negative when what comes before
 * the first word may be dropped). `latest` is an upper bound; `fixed` holds
 * the position exactly at `want`. A clip whose bounds can't be met (the clips
 * before it need more room) is placed as early as they allow, later than its
 * bounds, and its index is added to `conflicts`, so the dub is still made and
 * the line is flagged. Returns positions in the same order.
 */
export const placeClips = (clips, { conflicts = [] } = {}) => {
  if (clips.length === 0) return [];

  const offsets = [];
  let running = 0;
  clips.forEach((clip, i) => {
    offsets.push(running);
    running += clip.length + (i < clips.length - 1 ? clip.gapAfter : 0);
  });

  if (clips.some((clip) => Number.isFinite(clip.latest) || clip.fixed === true)) {
    const blocks = [];
    let lower = -Infinity;
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      let low = (clip.fixed ? clip.want : Math.max(clip.floor ?? 0, clip.earliest ?? -Infinity)) - offsets[i];
      let high = (clip.fixed ? clip.want : clip.latest ?? Infinity) - offsets[i];
      lower = Math.max(lower, low);
      if (lower > high + 1e-9) {
        // Held at the earliest the clips before it allow.
        conflicts.push(i);
        low = lower;
        high = lower;
      }
      const weight = clip.weight ?? 1;
      const sum = (clip.want - offsets[i]) * weight;
      blocks.push({ low, high, weight, sum, count: 1, value: Math.min(high, Math.max(low, sum / weight)) });
      while (blocks.length > 1 && blocks.at(-2).value > blocks.at(-1).value) {
        const b = blocks.pop();
        const a = blocks.pop();
        const merged = { low: Math.max(a.low, b.low), high: Math.min(a.high, b.high), weight: a.weight + b.weight, sum: a.sum + b.sum, count: a.count + b.count };
        merged.value = Math.min(merged.high, Math.max(merged.low, merged.sum / merged.weight));
        blocks.push(merged);
      }
    }
    return blocks.flatMap((block) => Array(block.count).fill(block.value)).map((value, i) => value + offsets[i]);
  }

  const solved = pava(
    clips.map((clip, i) => clip.want - offsets[i]),
    clips.map((clip) => clip.weight ?? 1)
  );

  // Lower bounds in u become non-decreasing once each is raised to the largest
  // before it (uᵢ ≥ uⱼ ≥ boundⱼ for j < i), and for a non-decreasing bound the
  // bounded optimum is the unbounded one clamped to it. Clamping keeps u
  // non-decreasing, so every gap still holds.
  let floor = -Infinity;
  return solved.map((u, i) => {
    floor = Math.max(floor, Math.max(clips[i].floor ?? 0, clips[i].earliest ?? -Infinity) - offsets[i]);
    return Math.max(u, floor) + offsets[i];
  });
};

const percentile = (sorted, p) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

/**
 * How well a placement lines up with the source.
 *
 * `units[i]` is the sync unit, `clips[i]` is `{ lead, speech, length }`
 * (seconds from the clip's start to its first word, from its first to last
 * word, and the clip's whole length) and `positions[i]` where the clip was
 * placed. A line is in sync when its first
 * word is within `tolerance` of the source line's, and it ends before the next
 * source line starts (give or take `tolerance`).
 */
export const measureSync = (units, clips, positions, { tolerance }) => {
  const lines = units.map((unit, i) => {
    const onset = positions[i] + clips[i].lead;
    const end = onset + clips[i].speech;
    const offset = onset - unit.srcStart;
    const overrun = unit.nextStart === null ? 0 : Math.max(0, end - unit.nextStart);
    return {
      offset,
      overrun,
      placedStart: onset,
      placedEnd: end,
      inSync: Math.abs(offset) <= tolerance && overrun <= tolerance,
    };
  });

  let overlaps = 0;
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] < positions[i - 1] + clips[i - 1].length - 1e-6) overlaps++;
  }

  const errors = lines.map((line) => Math.abs(line.offset)).sort((a, b) => a - b);
  return {
    lines,
    summary: {
      lines: lines.length,
      inSync: lines.filter((line) => line.inSync).length,
      medianError: percentile(errors, 0.5),
      p90Error: percentile(errors, 0.9),
      maxError: errors.length ? errors[errors.length - 1] : 0,
      overlaps,
    },
  };
};

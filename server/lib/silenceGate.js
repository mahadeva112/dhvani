/**
 * The silence gate REAPER's Dynamic split uses, shared by Chunk sync (a dub
 * line split at its pauses) and pause detection (a source file split into
 * cues). Pure: no Node APIs, so the app imports it too.
 *
 * The gate opens when a frame's peak reaches `openDb` and closes only once
 * the level stays below `openDb - hysteresisDb` for `minSilenceFrames` in a
 * row. A soft sound between the two levels (an "s", a breath into a word, a
 * consonant the speaker swallows) neither opens a cue nor splits one.
 */

/** The gate reads the level in frames this long. */
export const GATE_FRAME_SECONDS = 0.005;

export const dbToGain = (db) => 10 ** (db / 20);

/** One peak per `frameSeconds` of `samples` (the last frame may be short). */
export const peakLevels = (samples, sampleRate, frameSeconds = GATE_FRAME_SECONDS) => {
  const hop = Math.max(1, Math.round(frameSeconds * sampleRate));
  const levels = new Float32Array(Math.ceil(samples.length / hop));
  for (let frame = 0; frame < levels.length; frame++) {
    let peak = 0;
    const end = Math.min(samples.length, (frame + 1) * hop);
    for (let i = frame * hop; i < end; i++) {
      const value = samples[i] < 0 ? -samples[i] : samples[i];
      if (value > peak) peak = value;
    }
    levels[frame] = peak;
  }
  return { levels, hop };
};

/**
 * The sounds in `levels` as `[{ from, to }]` frame ranges (`to` exclusive,
 * one past the last frame at or above the close level). `softOnsetFrames`
 * lets a sound reach back that far before the frame that opened the gate,
 * over frames still at or above the close level, never into the sound before.
 */
export const gateSounds = (levels, { openDb, hysteresisDb, minSilenceFrames, softOnsetFrames = 0 }) => {
  const open = dbToGain(openDb);
  const close = dbToGain(openDb - Math.abs(hysteresisDb));
  const silence = Math.max(1, Math.round(minSilenceFrames));
  const sounds = [];
  let on = false;
  let start = 0;
  let lastLoud = 0;
  let below = 0;
  for (let frame = 0; frame < levels.length; frame++) {
    const peak = levels[frame];
    if (!on) {
      if (peak >= open) {
        on = true;
        const earliest = Math.max(sounds.length ? sounds.at(-1).to : 0, frame - softOnsetFrames);
        start = frame;
        while (start > earliest && levels[start - 1] >= close) start--;
        lastLoud = frame;
        below = 0;
      }
    } else if (peak >= close) {
      lastLoud = frame;
      below = 0;
    } else if (++below >= silence) {
      sounds.push({ from: start, to: lastLoud + 1 });
      on = false;
    }
  }
  if (on) sounds.push({ from: start, to: lastLoud + 1 });
  return sounds;
};

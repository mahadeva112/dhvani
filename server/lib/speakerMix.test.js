import test from 'node:test';
import assert from 'node:assert/strict';
import { mixSpeakers, speakerGains } from './speakerMix.js';
import { planConversation, runConversation, turnPause, MIN_TURN_PAUSE_SECONDS, MAX_TURN_PAUSE_SECONDS } from './conversationDub.js';
import { runSync, clearClipCache } from './syncDub.js';
import { speakerLabel, buildCuesFromWords } from './srt.js';

const RATE = 8000;

/** Silence, then `tone` s of a sine at `level`, then silence. */
const clip = ({ lead = 0.2, tone = 1, tail = 0.2, level = 0.3 } = {}) => {
  const samples = new Float32Array(Math.round((lead + tone + tail) * RATE));
  const a = Math.round(lead * RATE);
  const b = a + Math.round(tone * RATE);
  for (let i = a; i < b; i++) samples[i] = level * Math.sin((2 * Math.PI * 220 * i) / RATE);
  return samples;
};

const peakOf = (samples) => samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0);

test('Scribe speaker ids read as numbered speakers, and a speaker change starts a new cue', () => {
  assert.equal(speakerLabel('speaker_0'), 'Speaker 1');
  assert.equal(speakerLabel('speaker_11'), 'Speaker 12');
  assert.equal(speakerLabel(''), null);
  const cues = buildCuesFromWords([
    { text: 'Hello', start: 0, end: 0.4, type: 'word', speaker_id: 'speaker_0' },
    { text: 'there.', start: 0.45, end: 0.8, type: 'word', speaker_id: 'speaker_0' },
    { text: 'Hi', start: 0.85, end: 1.1, type: 'word', speaker_id: 'speaker_1' },
  ]);
  assert.deepEqual(cues.map((c) => c.speaker), ['Speaker 1', 'Speaker 2']);
});

test('the stems sum to the mix, and a mix over full scale is kept as summed in float', () => {
  const loud = clip({ tone: 0.5, level: 0.8 });
  const clips = [
    { samples: loud, startSample: 0, speaker: 'A' },
    { samples: loud, startSample: 0, speaker: 'B' },
    { samples: clip({ tone: 0.3 }), startSample: RATE * 2, speaker: 'A' },
  ];
  const { mix, stems, report } = mixSpeakers(clips, { sampleRate: RATE, length: 3, runOut: 0 });
  assert.deepEqual(report.speakers, ['A', 'B']);
  assert.equal(stems.length, 2);
  for (const stem of stems) assert.equal(stem.samples.length, mix.length, 'every stem is as long as the mix');
  let worst = 0;
  for (let i = 0; i < mix.length; i++) worst = Math.max(worst, Math.abs(stems[0].samples[i] + stems[1].samples[i] - mix[i]));
  assert.ok(worst < 1e-6, `stems sum to the mix (off by ${worst})`);
  assert.ok(report.overFullScale);
  assert.ok(peakOf(mix) > 1, 'float keeps the overlap exactly as summed');
  assert.equal(report.loweredDb, 0);
  assert.ok(report.peakDb > 0);
  assert.ok(Math.abs(report.peakAt - 0.2) < 0.25, 'the peak is where the speakers overlap');
});

test('"lower" turns the whole mix down by one gain, and leaves the stems as voiced', () => {
  const loud = clip({ tone: 0.5, level: 0.8 });
  const clips = [
    { samples: loud, startSample: 0, speaker: 'A' },
    { samples: loud, startSample: 0, speaker: 'B' },
  ];
  const { mix, stems, report } = mixSpeakers(clips, { sampleRate: RATE, length: 1, runOut: 0, peak: 'lower' });
  assert.ok(peakOf(mix) <= 1 + 1e-6);
  assert.ok(report.loweredDb > 0);
  assert.ok(Math.abs(peakOf(stems[0].samples) - peakOf(loud)) < 1e-3, 'a stem keeps its level');
});

test('evening out speakers gives one gain per speaker; a single speaker is left alone', () => {
  const quiet = clip({ level: 0.1 });
  const loud = clip({ level: 0.4 });
  const gains = speakerGains(
    [
      { samples: quiet, speaker: 'A' },
      { samples: quiet, speaker: 'A' },
      { samples: loud, speaker: 'B' },
    ],
    RATE
  );
  assert.ok(gains.get('A') > 1 && gains.get('B') < 1, 'the quiet speaker comes up and the loud one down');
  assert.equal(speakerGains([{ samples: quiet, speaker: 'A' }, { samples: loud, speaker: 'A' }], RATE).get('A'), 1);
});

test('a conversation is planned turn by turn, with pauses that follow the original within bounds', () => {
  assert.equal(turnPause(0.05), MIN_TURN_PAUSE_SECONDS);
  assert.equal(turnPause(9), MAX_TURN_PAUSE_SECONDS);
  assert.equal(turnPause(0.6), 0.6);
  const passages = planConversation([
    { speaker: 'Host', text: 'Hello there.', gapAfter: 0.5 },
    { speaker: 'Guest', text: '   ', gapAfter: 2 },
    { speaker: 'Guest', text: 'Hi.', gapAfter: null },
  ]);
  assert.deepEqual(
    passages.map((p) => [p.speaker, p.text, p.pauseAfter]),
    [
      ['Host', 'Hello there.', MAX_TURN_PAUSE_SECONDS],
      ['Guest', 'Hi.', 0.4],
    ]
  );
});

test('each speaker is voiced by their own voice, told only their own lines, with a stem each', async () => {
  const calls = [];
  const voices = { Host: { voiceId: 'host' }, Guest: { voiceId: 'guest' } };
  const { mix, stems, report } = await runConversation(
    {
      turns: [
        { speaker: 'Host', text: 'One.', gapAfter: 0.4 },
        { speaker: 'Guest', text: 'Two.', gapAfter: 0.4 },
        { speaker: 'Host', text: 'Three.', gapAfter: 0.4 },
      ],
      sampleRate: RATE,
      voiceFor: (speaker) => voices[speaker],
    },
    {
      voiceLines: async (voice, lines, { onLine }) => {
        calls.push({ voice: voice.voiceId, lines });
        return lines.map((_, n) => {
          onLine(n + 1);
          return clip({ tone: 0.4 });
        });
      },
      decode: async (samples) => samples,
    }
  );
  assert.deepEqual(calls.map((c) => c.voice), ['host', 'guest']);
  assert.deepEqual(calls[0].lines.map((l) => l.text), ['One.', 'Three.']);
  assert.equal(calls[0].lines[1].previousText, 'One.', 'context comes from the same speaker');
  assert.equal(calls[1].lines[0].previousText, undefined, "another speaker's line is never context");
  assert.deepEqual(stems.map((s) => s.speaker), ['Host', 'Guest']);
  assert.equal(report.passages, 3);
  assert.ok(mix.length > 0 && stems.every((s) => s.samples.length === mix.length));
});

const cue = (id, startTime, endTime, text, speaker) => ({ id, startTime, endTime, duration: endTime - startTime, textTarget: text, textSource: `src ${id}`, speaker });
const SECONDS_PER_CHAR = 0.08;
const syncDeps = () => {
  const calls = [];
  return {
    calls,
    deps: {
      voiceLines: async (lines, { voice, onLine }) => {
        calls.push({ voice: voice.voiceId, lines });
        return lines.map((line, n) => {
          onLine(n + 1);
          return clip({ lead: 0.15, tone: line.text.length * SECONDS_PER_CHAR, tail: 0.15 });
        });
      },
      decode: async (samples) => samples,
      encode: async (samples, { float } = {}) => ({ buffer: Buffer.from(new Uint8Array(samples.buffer.slice(0))), contentType: float ? 'audio/float' : 'audio/test' }),
    },
  };
};

test('a synced dub with several speakers voices each with their own voice and returns a stem each', async () => {
  clearClipCache();
  const segments = [cue(1, 1, 2, 'aaaaaaaaaa', 'Host'), cue(2, 3, 4, 'bbbbbbbbbb', 'Guest'), cue(3, 5, 6, 'cccccccccc', 'Host')];
  const voices = { Host: { voiceId: 'host', modelId: 'm' }, Guest: { voiceId: 'guest', modelId: 'm' } };
  const { calls, deps } = syncDeps();
  const result = await runSync(
    { segments, sourceDuration: 8, sampleRate: RATE, voice: { voiceId: 'main' }, voiceFor: (s) => voices[s], multiSpeaker: true },
    deps
  );
  assert.deepEqual(calls.map((c) => c.voice), ['host', 'guest']);
  assert.equal(calls[0].lines[1].previousText, 'aaaaaaaaaa', 'context comes from the same speaker');
  assert.equal(calls[1].lines[0].previousText, undefined);
  assert.deepEqual(result.stems.map((s) => s.speaker), ['Host', 'Guest']);
  assert.equal(result.contentType, 'audio/float');
  assert.equal(result.report.mix.selfOverlaps, 0);
  assert.equal(result.report.units[1].speaker, 'Guest');
});

test('where the original speakers overlap, the dub keeps the overlap instead of pushing the line back', async () => {
  clearClipCache();
  // Guest starts at 2.0 s while Host talks until 2.6 s.
  const segments = [cue(1, 1, 2.6, 'aaaaaaaaaaaaaaaaaa', 'Host'), cue(2, 2, 3.5, 'bbbbbbbbbbbbbbb', 'Guest')];
  const { deps } = syncDeps();
  const several = await runSync({ segments, sourceDuration: 5, sampleRate: RATE, voice: { voiceId: 'v' }, multiSpeaker: true }, deps);
  const guest = several.report.units[1];
  assert.ok(Math.abs(guest.offset) < 0.05, `the overlapping line starts on time (offset ${guest.offset})`);
  assert.equal(several.report.mix.overlapsKept, 1);
  assert.equal(guest.tightJoin, false);

  clearClipCache();
  const one = await runSync({ segments, sourceDuration: 5, sampleRate: RATE, voice: { voiceId: 'v' } }, syncDeps().deps);
  assert.ok(one.report.units[1].offset > 0.3, 'a one-voice dub still keeps lines apart');
  assert.equal(one.stems, undefined);
  assert.equal(one.report.mix, undefined);
});

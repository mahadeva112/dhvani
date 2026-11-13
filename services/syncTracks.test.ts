import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_CLIP_PREFIX,
  audioClipsOf,
  audioLines,
  audioParts,
  isClip,
  originalParts,
  rebaseEdits,
  renderPayload,
  trackLane,
  trackOfLane,
  withoutAudioClips,
  type AudioFileInfo,
  type AudioTrack,
  type SyncBank,
  type SyncBankLine,
  type SyncEditPart,
  type SyncEdits,
} from './syncEditModel.ts';
import { liveClips } from './liveDubEngine.ts';
import { describeProjectChange, HISTORY_FIELDS } from './projectHistory.ts';
import { exportProject, importProject } from './projectArchive.ts';
import type { BatchJob } from '../types';

const RATE = 1000;

const line = (key: string, start: number): SyncBankLine => ({
  key,
  speaker: 'A',
  bankStart: 0,
  length: 2 * RATE,
  startSample: start * RATE,
  lead: 0.1,
  speech: 1.8,
  gain: 1,
  hash: `h${key}`,
  cuts: [],
  crossfade: 0,
  dropped: 0,
  locked: true,
});
const bank = (lines: SyncBankLine[]): SyncBank => ({ bankId: 'b', sampleRate: RATE, float: false, lines, speakerGains: {} });
const part = (id: string, start: number, from: number, to: number, extra: Partial<SyncEditPart> = {}): SyncEditPart => ({
  id,
  start,
  from,
  to,
  rate: 1,
  gainDb: 0,
  fadeIn: 0,
  fadeOut: 0,
  muted: false,
  ...extra,
});

const music: AudioFileInfo = { id: 'f1', name: 'music.wav', duration: 10, sampleRate: 44100, channels: 2 };
const files = { f1: music };
const tracks: AudioTrack[] = [{ id: 't1', name: 'Music', color: '#34d399', gainDb: -6 }];
const clipKey = `${AUDIO_CLIP_PREFIX}1`;
const edits: SyncEdits = {
  [clipKey]: { audio: { file: 'f1', track: 't1' }, parts: [part('p1', 3, 0, 4), part('p2', 8, 4, 12), part('p3', 1, 0, 1, { muted: true })], locked: true },
  l1: { parts: [part('l1#0', 0.5, 0, 2)], locked: true },
};

test('a clip on a track is a clip, never a line of the dub', () => {
  assert.equal(isClip(clipKey), true);
  assert.equal(isClip('original:1'), true);
  assert.equal(isClip('l1'), false);
  assert.equal(trackOfLane(trackLane('t1')), 't1');
  assert.equal(trackOfLane('t1'), null, 'a speaker called like a track id is not a track');
});

test('the parts of a clip that play are cut to its file, with their track', () => {
  const parts = audioParts(edits, tracks, files);
  assert.deepEqual(
    parts.map(({ part: p, file, track }) => [p.id, p.from, p.to, file, track]),
    [
      ['p1', 0, 4, 'f1', 't1'],
      ['p2', 4, 10, 'f1', 't1'],
    ],
    'the muted part plays nothing, and a part past the end of the file stops at it'
  );
  assert.deepEqual(audioParts(edits, [], files), [], 'a clip on a track that is gone plays nothing');
  assert.deepEqual(audioParts(edits, tracks, {}), [], 'nor does a clip of a file that is gone');
});

test('the synced dub is rendered without the clips on tracks', () => {
  const b = bank([line('l1', 0.5)]);
  assert.deepEqual(Object.keys(withoutAudioClips(edits)), ['l1']);
  assert.deepEqual(Object.keys(audioClipsOf(edits)), [clipKey]);
  // The render payload and the clips of the original never pick up a clip on a track.
  assert.equal(renderPayload(b, edits).length, 1);
  assert.deepEqual(originalParts(edits, 60), []);
});

test('a clip on a track is drawn as its file, on its track', () => {
  const [clip] = audioLines(edits, files, RATE);
  assert.equal(clip.key, clipKey);
  assert.equal(clip.speaker, trackLane('t1'));
  assert.equal(clip.length, 10 * RATE);
  assert.equal(clip.original, true);
});

test('Sync again leaves the clips on tracks where they are', () => {
  const before = bank([line('l1', 0.5)]);
  const after = { ...bank([line('l1', 0.5)]), bankId: 'b2' };
  const { edits: kept } = rebaseEdits(edits, before, after);
  assert.deepEqual(kept[clipKey], edits[clipKey]);
});

test('the live dub plays a clip on a track from its file, at the track level', () => {
  const b = bank([line('l1', 0.5)]);
  const trackParts = audioParts(edits, tracks, files).map(({ part: p, file }) => ({ part: p, file, gain: 10 ** (-6 / 20) }));
  const clips = liveClips(b, edits, false, [], new Set(), trackParts);
  const fromFile = clips.filter((clip) => clip.file === 'f1');
  assert.equal(fromFile.length, 2);
  assert.equal(fromFile[0].bankFrom, 0);
  assert.equal(fromFile[0].bankTo, 4);
  assert.ok(Math.abs(fromFile[0].gain - 10 ** (-6 / 20)) < 1e-9);
  assert.equal(clips.filter((clip) => !clip.file).length, 1, 'the dub line plays too');
});

test('tracks are in the project history, and a change to them says so', () => {
  assert.ok((HISTORY_FIELDS as readonly string[]).includes('syncAudioTracks'));
  const before = { syncAudioTracks: null } as never;
  const after = { syncAudioTracks: tracks } as never;
  assert.equal(describeProjectChange(before, after)?.label, 'Tracks');
});

test('a full project keeps its tracks and their files; a light one leaves both out', async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
  const job = {
    id: 'j',
    name: 'Talk',
    file: new File([new Uint8Array([4])], 'talk.mp4', { type: 'video/mp4' }),
    segments: [],
    history: { past: [], future: [] },
    syncedBlob: new Blob([new Uint8Array([9])], { type: 'audio/wav' }),
    syncEdits: edits,
    syncAudioTracks: tracks,
    syncAudioFiles: [{ ...music, blob }],
  } as unknown as BatchJob;
  const full = (await importProject(await exportProject(job), 'n1')).job;
  assert.deepEqual(full.syncAudioTracks, tracks);
  assert.equal(full.syncAudioFiles?.[0].name, 'music.wav');
  assert.deepEqual([...new Uint8Array(await full.syncAudioFiles![0].blob.arrayBuffer())], [1, 2, 3]);
  assert.ok(full.syncEdits?.[clipKey]);

  const light = (await importProject(await exportProject(job, [], { light: true }), 'n2')).job;
  assert.equal(light.syncAudioTracks, null);
  assert.equal(light.syncAudioFiles, null);
  assert.deepEqual(Object.keys(light.syncEdits ?? {}), ['l1']);
});

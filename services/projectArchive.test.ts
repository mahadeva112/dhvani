import test from 'node:test';
import assert from 'node:assert/strict';
import { exportProject, importProject, packJob, projectFileName } from './projectArchive.ts';
import type { BatchJob } from '../types';

class FakeAudioBuffer {
  length = 10;
}

const bytes = async (blob: Blob) => Buffer.from(await blob.arrayBuffer());

const sampleJob = () => {
  const source = new File([new Uint8Array([1, 2, 3, 4])], 'talk.mp4', { type: 'video/mp4', lastModified: 1_700_000_000_000 });
  const synced = new Blob([new Uint8Array([9, 8, 7])], { type: 'audio/wav' });
  const bank = new Blob([new Uint8Array([5, 5, 5, 5, 5])], { type: 'audio/wav' });
  const job = {
    id: 'old-id',
    name: 'Talk',
    file: source,
    status: 'COMPLETED',
    script: 'hello',
    language: 'Hindi',
    segments: [{ id: 1, startTime: 0, endTime: 1, duration: 1, textSource: 'Hi', textTarget: 'नमस्ते' }],
    history: { past: [], future: [] },
    audioBuffer: new FakeAudioBuffer(),
    synthAudioBuffer: null,
    syncedAudioBuffer: new FakeAudioBuffer(),
    synthesizedAudioUrl: 'blob:old',
    synthesizedBlob: null,
    syncedAudioUrl: 'blob:old2',
    syncedBlob: synced,
    srtUrl: null,
    srtBlob: null,
    syncBank: { bankId: 'b1', sampleRate: 48000, lines: [{ key: 'l1', start: 0.5 }] },
    syncBankBlob: bank,
    syncEdits: { lines: { l1: { shift: 0.2 } } },
    syncTakes: { l1: { takes: [{ seed: 3 }], playing: 0 } },
    syncedStems: [{ speaker: 'A', blob: synced }],
    syncBeforeVoiceChange: { syncedBlob: synced, syncBankBlob: bank },
  };
  return job as unknown as BatchJob;
};

test('packJob stores each file once and leaves out what the page rebuilds', () => {
  const { data, media } = packJob(sampleJob());
  const packed = data as Record<string, unknown>;
  assert.equal(media.size, 3, 'source, synced dub and bank, each once');
  assert.equal(packed.audioBuffer, null);
  assert.equal(packed.syncedAudioBuffer, null);
  assert.equal(packed.synthesizedAudioUrl, null);
  assert.ok([...media.keys()].some((p) => p.endsWith('talk.mp4')));
  JSON.stringify(packed);
});

test('a project comes back from its file with every edit, take and file', async () => {
  const job = sampleJob();
  const file = await exportProject(job, [
    { key: 'old-id::hindi', jobId: 'old-id', language: 'Hindi', stages: {} as never, overrides: {}, updatedAt: 1 },
    { key: 'other::hindi', jobId: 'other', language: 'Hindi', stages: {} as never, overrides: {}, updatedAt: 1 },
  ]);
  const { job: back, signoffs } = await importProject(file, 'new-id');

  assert.equal(back.id, 'new-id');
  assert.equal(back.name, 'Talk');
  assert.deepEqual(back.segments, job.segments);
  assert.deepEqual(back.syncBank, job.syncBank);
  assert.deepEqual(back.syncEdits, job.syncEdits);
  assert.deepEqual(back.syncTakes, job.syncTakes);

  assert.ok(back.file instanceof File);
  assert.equal(back.file.name, 'talk.mp4');
  assert.equal(back.file.type, 'video/mp4');
  assert.equal(back.file.lastModified, 1_700_000_000_000);
  assert.deepEqual(await bytes(back.file), Buffer.from([1, 2, 3, 4]));
  assert.deepEqual(await bytes(back.syncedBlob!), Buffer.from([9, 8, 7]));
  assert.equal(back.syncedBlob!.type, 'audio/wav');
  assert.deepEqual(await bytes(back.syncBankBlob!), Buffer.from([5, 5, 5, 5, 5]));
  assert.equal(back.syncedStems![0].blob, back.syncedBlob, 'one file stays one Blob');
  assert.equal(back.syncBeforeVoiceChange!.syncBankBlob, back.syncBankBlob);

  assert.deepEqual(signoffs.map((s) => [s.key, s.jobId]), [['new-id::hindi', 'new-id']]);
});

test('a file that is not a project is refused in plain words', async () => {
  await assert.rejects(importProject(new Blob(['not a zip']), 'x'), /isn't a Dhvani project file/);
});

test('project files are named after the project', () => {
  assert.equal(projectFileName('Talk: part 1'), 'Talk_ part 1.dhvani');
  assert.equal(projectFileName('  '), 'Dhvani project.dhvani');
});

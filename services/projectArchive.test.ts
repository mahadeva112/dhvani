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

const wav16 = (values: number[]) => {
  const view = new DataView(new ArrayBuffer(44 + values.length * 2));
  const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + values.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 1000, true);
  view.setUint32(28, 2000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, values.length * 2, true);
  values.forEach((v, i) => view.setInt16(44 + i * 2, v, true));
  return new Blob([view.buffer], { type: 'audio/wav' });
};

test('a light project leaves out the source, unplayed takes and undo, and asks for the original', async () => {
  const take = (id: string, bankStart: number) => ({ id, kind: 'line', bankStart, length: 2, lead: 0, speech: 0, gain: 1, hash: id, cutOff: false, cuts: [], crossfade: 0, dropped: 0, text: 'x' });
  const job = {
    ...sampleJob(),
    history: { past: [{ script: 'old', segments: [], pronunciations: [], timestamp: 1 }], future: [] },
    reviewHistory: { steps: [], at: 0 },
    syncBank: { bankId: 'b1', sampleRate: 1000, float: false, lines: [{ key: 'l1', speaker: '', bankStart: 2, length: 2 }], speakerGains: {} },
    syncBankBlob: wav16([10, 11, 12, 13, 14, 15]),
    syncTakes: { l1: { takes: [take('sync', 0), take('t2', 2)], active: 't2' } },
  } as unknown as BatchJob;
  const file = await exportProject(job, [], { light: true });
  const { job: back, needsMedia } = await importProject(file, 'new-id');
  assert.equal(needsMedia?.name, 'talk.mp4');
  assert.ok(!back.file, 'the source media is not in the file');
  assert.deepEqual(back.history, { past: [], future: [] });
  assert.equal(back.reviewHistory, null);
  assert.equal(back.syncBeforeVoiceChange, null);
  assert.deepEqual([...(await bytes(back.syncedBlob!))], [9, 8, 7], 'the dub is byte for byte');
  assert.deepEqual(Array.from(new Int16Array((await back.syncBankBlob!.arrayBuffer()).slice(44))), [12, 13]);
  assert.equal(back.syncBank!.lines[0].bankStart, 0);
  assert.notEqual(back.syncBank!.bankId, 'b1', 'a new bank id, so a server copy of the old bank is never used');
  assert.deepEqual(back.syncTakes!.l1.takes.map((t) => [t.id, t.bankStart]), [['t2', 0]]);
  assert.equal(back.segments[0].textTarget, 'नमस्ते');
});

test('a full project still needs no media', async () => {
  const { needsMedia } = await importProject(await exportProject(sampleJob()), 'n');
  assert.equal(needsMedia, null);
});

test('a full project carries the banks of earlier Syncs for its undo history; a light one leaves them out', async () => {
  const job = sampleJob();
  const banks = [
    { epoch: 'e1', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }), kind: 'bank' as const },
    { epoch: 'e2', blob: new Blob([new Uint8Array([9])], { type: 'audio/wav' }), kind: 'file' as const },
  ];
  const { job: back, historyBanks } = await importProject(await exportProject(job, [], { historyBanks: banks }), 'new-id');
  assert.deepEqual(historyBanks.map((b) => [b.epoch, b.kind]), [['e1', 'bank'], ['e2', 'file']]);
  assert.deepEqual([...(await bytes(historyBanks[0].blob))], [1, 2, 3]);
  assert.equal('__historyBanks' in back, false, 'the banks are not part of the project');
  const light = await importProject(await exportProject(job, [], { light: true, historyBanks: banks }), 'n2');
  assert.deepEqual(light.historyBanks, []);
  assert.equal(light.job.projectHistory, null);
});

test('a full project carries its review video; a light one and one without leave it out', async () => {
  const job = sampleJob();
  const video = new File([new Uint8Array([7, 7, 7])], 'picture.mp4', { type: 'video/mp4', lastModified: 1_700_000_000_123 });
  const { job: back, reviewVideo } = await importProject(await exportProject(job, [], { reviewVideo: video }), 'new-id');
  assert.ok(reviewVideo instanceof File);
  assert.equal(reviewVideo.name, 'picture.mp4');
  assert.equal(reviewVideo.type, 'video/mp4');
  assert.deepEqual([...(await bytes(reviewVideo))], [7, 7, 7]);
  assert.equal('__reviewVideo' in back, false, 'the video is not part of the project');
  const light = await importProject(await exportProject(job, [], { light: true, reviewVideo: video }), 'n2');
  assert.equal(light.reviewVideo, null);
  const none = await importProject(await exportProject(job), 'n3');
  assert.equal(none.reviewVideo, null);
});

test('a project file opens in JSZip, as older Dhvani and unzip tools read it', async () => {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await (await exportProject(sampleJob())).arrayBuffer());
  const manifest = JSON.parse(await zip.file('project.json')!.async('string'));
  assert.equal(manifest.kind, 'dhvani-project');
  const source = Object.keys(zip.files).find((n) => n.endsWith('talk.mp4'))!;
  assert.deepEqual([...(await zip.file(source)!.async('uint8array'))], [1, 2, 3, 4]);
});

test('a project file JSZip wrote (older Dhvani) still opens', async () => {
  const { default: JSZip } = await import('jszip');
  const { packJob: pack } = await import('./projectArchive.ts');
  const job = sampleJob();
  const { data, media } = pack(job);
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify({ kind: 'dhvani-project', version: 1, exportedAt: 1, job: data, signoffs: [] }), { compression: 'DEFLATE' });
  for (const [path, blob] of media) zip.file(path, new Uint8Array(await blob.arrayBuffer()), { compression: 'STORE' });
  const old = new Blob([await zip.generateAsync({ type: 'uint8array' })]);
  const { job: back } = await importProject(old, 'n');
  assert.deepEqual([...(await bytes(back.file as Blob))], [1, 2, 3, 4]);
  assert.deepEqual([...(await bytes(back.syncBankBlob as Blob))], [5, 5, 5, 5, 5]);
});

test('ZIP64 fields, written for files past 4 GB, read back here and in JSZip', async () => {
  const { writeZip, readZip } = await import('./zipStore.ts');
  const { default: JSZip } = await import('jszip');
  const big = new Uint8Array(70_000).map((_, i) => (i * 7) & 0xff);
  const file = await writeZip(
    [
      { name: 'a.txt', data: new Blob(['hello ভাষা']), deflate: true },
      { name: 'media/0-big.wav', data: new Blob([big]) },
      { name: 'media/1-small.wav', data: new Blob([new Uint8Array([3, 2, 1])]) },
    ],
    { zip64At: 10 }
  );
  const ours = await readZip(file);
  assert.equal(await (await ours.get('a.txt')!()).text(), 'hello ভাষা');
  assert.deepEqual(new Uint8Array(await (await ours.get('media/0-big.wav')!()).arrayBuffer()), big);
  assert.deepEqual([...(await bytes(await ours.get('media/1-small.wav')!()))], [3, 2, 1]);
  const theirs = await JSZip.loadAsync(await file.arrayBuffer());
  assert.equal(await theirs.file('a.txt')!.async('string'), 'hello ভাষা');
  assert.deepEqual(await theirs.file('media/0-big.wav')!.async('uint8array'), big);
});

test('CRC-32 across slices matches the whole', async () => {
  const { crc32OfBlob } = await import('./zipStore.ts');
  assert.equal(await crc32OfBlob(new Blob(['123456789'])), 0xcbf43926);
});

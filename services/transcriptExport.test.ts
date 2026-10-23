import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeTimingProblem, srtTime, transcriptParagraphs, transcriptSrt } from './transcriptExport.ts';
import { exportProjectJson, isProjectJson, readProjectJson } from './projectArchive.ts';
import { mergeSegments, splitSegment, transcriptText } from './transcriptSegments.ts';
import { openSteps } from './steps.ts';
import type { AudioSegment, BatchJob } from '../types';

const seg = (id: string | number, startTime: number, endTime: number, textSource: string, extra: Partial<AudioSegment> = {}): AudioSegment => ({
  id,
  startTime,
  endTime,
  duration: endTime - startTime,
  textSource,
  textTarget: '',
  ...extra,
});

const transcript = (): AudioSegment[] => [
  seg('cue-1', 0.4123456, 3.4, 'আজ আমরা কথা বলব ধ্যান নিয়ে।', {
    speaker: 'A',
    timingSource: 'elevenlabs',
    words: [
      { text: 'আজ', start: 0.4123456, end: 0.7 },
      { text: 'আমরা', start: 0.75, end: 1.2 },
      { text: 'কথা', start: 1.25, end: 1.6 },
      { text: 'বলব', start: 1.65, end: 2.1 },
      { text: 'ধ্যান', start: 2.15, end: 2.7 },
      { text: 'নিয়ে।', start: 2.75, end: 3.4 },
    ],
  }),
  seg('cue-2', 3.9, 7.25, 'आप सब यहाँ बैठिए, and just listen…', { speaker: 'A' }),
  seg('cue-3', 9.8, 12.0, '“The mind is a tool.” মনে রাখবেন।', { speaker: 'B' }),
  seg('cue-4', 12.1, 13.0, '   ', { speaker: 'B' }),
];

const job = (segments = transcript(), extra: Partial<BatchJob> = {}): BatchJob =>
  ({
    id: 'old-id',
    name: 'Satsang talk',
    file: new File([new Uint8Array([1, 2, 3])], 'satsang-talk.mp3', { type: 'audio/mpeg' }),
    status: 'IDLE',
    script: '',
    language: 'Hindi',
    sourceLanguage: '',
    detectedLanguage: 'Bengali',
    manualDuration: '',
    expression: 'Warm',
    pronunciations: [],
    history: { past: [{ script: 'x', segments: [], pronunciations: [], timestamp: 1 }], future: [] },
    audioMetadata: { duration: 192.5, fileName: 'satsang-talk.mp3', fileType: 'audio/mpeg' },
    audioBuffer: null,
    segments,
    xmlOutput: '',
    validationResult: null,
    synthesizedAudioUrl: 'blob:http://localhost/abc',
    synthesizedBlob: new Blob([new Uint8Array([9])]),
    synthAudioBuffer: null,
    srtUrl: null,
    srtBlob: null,
    errorMsg: null,
    targetSource: 'pending',
    ...extra,
  }) as BatchJob;

test('paragraphs keep every word, in order, and break at pauses and speakers', () => {
  const text = transcriptParagraphs(transcript());
  assert.equal(
    text,
    'আজ আমরা কথা বলব ধ্যান নিয়ে। आप सब यहाँ बैठिए, and just listen…\n\n“The mind is a tool.” মনে রাখবেন।\n'
  );
  assert.ok(!/\d:\d\d/.test(text), 'no timestamps');
  assert.equal(text.replace(/\s+/g, ' ').trim(), transcriptText(transcript()));
});

test('paragraphs need no hand segmentation, and an empty transcript gives nothing', () => {
  const one = [seg(1, 0, 60, 'A whole talk in one segment, as transcribed.')];
  assert.equal(transcriptParagraphs(one), 'A whole talk in one segment, as transcribed.\n');
  assert.equal(transcriptParagraphs([seg(1, 0, 1, '')]), '');
});

test('SRT has one numbered cue per spoken segment, standard times, text as transcribed', () => {
  const result = transcriptSrt(transcript());
  if (result.kind !== 'ready') return assert.fail('expected subtitles');
  assert.equal(result.count, 3);
  assert.equal(
    result.content,
    '1\n00:00:00,412 --> 00:00:03,400\nআজ আমরা কথা বলব ধ্যান নিয়ে।\n\n' +
      '2\n00:00:03,900 --> 00:00:07,250\nआप सब यहाँ बैठिए, and just listen…\n\n' +
      '3\n00:00:09,800 --> 00:00:12,000\n“The mind is a tool.” মনে রাখবেন।\n'
  );
  assert.equal(srtTime(3725.5), '01:02:05,500');
  assert.equal(srtTime(59.9996), '00:01:00,000');
});

test('SRT refuses bad timing, names it, and leaves the segments alone', () => {
  const segs = transcript();
  segs[1] = { ...segs[1], startTime: 7.25, endTime: 3.9 };
  segs[2] = { ...segs[2], startTime: 9.8, endTime: 9.8002 };
  const before = JSON.stringify(segs);
  const result = transcriptSrt(segs);
  if (result.kind !== 'blocked') return assert.fail('expected the timing to be refused');
  assert.deepEqual(result.problems.map((p) => [p.index, p.kind]), [
    [1, 'reversed'],
    [2, 'zero'],
  ]);
  assert.equal(describeTimingProblem(result.problems[0]), '02 ends before it starts (0:07.25 → 0:03.90)');
  assert.equal(JSON.stringify(segs), before);
});

test('JSON keeps text, ids, order, language and full-precision times, and no media or machine data', () => {
  const file = exportProjectJson(job());
  assert.ok(!file.includes('blob:'), 'no object URLs');
  const data = JSON.parse(file);
  assert.equal(data.kind, 'dhvani-project');
  assert.equal(data.media, 'external');
  assert.equal(data.sourceMedia.name, 'satsang-talk.mp3');
  assert.equal(data.sourceMedia.duration, 192.5);
  assert.equal(data.project.history, undefined);
  assert.equal(data.project.synthesizedBlob, undefined);
  assert.equal(data.project.file, undefined);

  const { project, sourceMedia } = readProjectJson(file, 'new-id');
  assert.equal(sourceMedia.name, 'satsang-talk.mp3');
  assert.deepEqual(
    project.segments.map((s) => s.id),
    ['cue-1', 'cue-2', 'cue-3', 'cue-4']
  );
  assert.equal(project.segments[0].startTime, 0.4123456);
  assert.deepEqual(project.segments[0].words, transcript()[0].words);
  assert.equal(project.segments[2].textSource, '“The mind is a tool.” মনে রাখবেন।');
  assert.equal(project.detectedLanguage, 'Bengali');
  assert.equal(project.language, 'Hindi');
  assert.equal(project.targetSource, 'pending');
});

test('an untranslated transcript opens untranslated: targets empty, never the source', () => {
  const segments = transcript().map((s) => ({ ...s, textTarget: s.textSource, targetText: s.textSource }));
  const { project } = readProjectJson(exportProjectJson(job(segments)), 'n');
  for (const s of project.segments) {
    assert.equal(s.textTarget, '');
    assert.equal(s.targetText, undefined);
  }
  const opened = { ...job(), ...project, id: 'n' } as BatchJob;
  // Review opens for translating; Dub waits for the script.
  assert.equal(openSteps(opened).upTo, 2);
});

test('split and merge survive export and reopening, and translation lands on the right cues', () => {
  const segs = transcript();
  const { first, second } = splitSegment(segs[0], 3, 'cue-1-a')!;
  const edited = [first, second, mergeSegments(segs[1], { ...segs[2], speaker: 'A' }), segs[3]];
  const { project } = readProjectJson(exportProjectJson(job(edited, { transcriptCuts: segs })), 'n');
  assert.deepEqual(
    project.segments.map((s) => [s.id, s.startTime, s.endTime]),
    edited.map((s) => [s.id, s.startTime, s.endTime])
  );
  assert.equal(transcriptText(project.segments), transcriptText(segs));
  assert.equal(project.transcriptCuts!.length, 4);

  // The translation merges by id, as retranslateCues does.
  const reply = new Map([
    ['cue-1-a', 'हम ध्यान के बारे में बात करेंगे।'],
    ['cue-1', 'आज'],
  ]);
  const translated = project.segments.map((s) => (reply.has(String(s.id)) ? { ...s, textTarget: reply.get(String(s.id)) } : s));
  assert.equal(translated[0].textSource, 'আজ আমরা কথা');
  assert.equal(translated[0].textTarget, 'आज');
  assert.equal(translated[1].textSource, 'বলব ধ্যান নিয়ে।');
  assert.equal(translated[1].textTarget, 'हम ध्यान के बारे में बात करेंगे।');
});

test('a translated, reviewed project keeps its translation and sign-offs through JSON', () => {
  const segs = transcript().map((s, i) => ({ ...s, textTarget: `अनुवाद ${i}`, targetText: `अनुवाद ${i}` }));
  const signoffs = [{ key: 'old-id::Hindi', jobId: 'old-id', language: 'Hindi', stages: {} }] as any;
  const { project, signoffs: moved } = readProjectJson(exportProjectJson(job(segs, { targetSource: 'translated' }), signoffs), 'new');
  assert.deepEqual(
    project.segments.map((s) => s.textTarget),
    segs.map((s) => s.textTarget)
  );
  assert.equal(project.targetSource, 'translated');
  assert.equal(openSteps({ ...job(), ...project } as BatchJob).upTo, 3);
  assert.deepEqual(moved.map((s) => [s.key, s.jobId]), [['new::Hindi', 'new']]);
});

test('invalid timing is kept for review rather than turned into zero', () => {
  const segs = transcript();
  segs[1] = { ...segs[1], startTime: NaN };
  const { project } = readProjectJson(exportProjectJson(job(segs)), 'n');
  assert.ok(Number.isNaN(project.segments[1].startTime));
  assert.equal(project.segments[1].textSource, segs[1].textSource);
});

test('other files are told apart: script files, newer versions, and things that are not projects', async () => {
  assert.throws(() => readProjectJson('{"kind":"dhvani-script","version":1,"cues":[]}', 'n'), /script file/);
  assert.throws(() => readProjectJson('{"kind":"dhvani-project","version":99,"media":"external","project":{"segments":[]}}', 'n'), /newer Dhvani/);
  assert.throws(() => readProjectJson('not json', 'n'), /isn't a Dhvani project/);
  assert.throws(() => readProjectJson('{"kind":"dhvani-project","version":1,"project":{"segments":[]}}', 'n'), /isn't a Dhvani project/);
  assert.equal(await isProjectJson(new File(['{}'], 'a.dhvani.json')), true);
  assert.equal(await isProjectJson(new Blob(['\uFEFF  {"kind"'])), true);
  assert.equal(await isProjectJson(new Blob([new Uint8Array([0x50, 0x4b, 3, 4])])), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeScript, secondsOfAudio } from './speech.js';
import { startDubJob, updateDubJob, finishDubJob, getDubProgress, cancelDubJob } from '../../lib/dubJobs.js';

const SETTINGS = { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 };
// pcm_16000 is 32,000 bytes a second and joins without ffmpeg.
const FORMAT = 'pcm_16000';
const LONG_TEXT = 'The mind is restless, but you can watch it without judgement. '.repeat(120);

/** A fake ElevenLabs: streams each passage in `pieces` chunks, or refuses streaming. */
const mockFetch = ({ refuseStream = false, pieces = 4, bytes = 32000, onRequest = () => {} } = {}) => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(url);
    onRequest(url, init);
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (refuseStream && url.includes('/stream')) {
      return new Response(JSON.stringify({ detail: { message: 'Streaming is not supported for this model' } }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Non-zero samples: the joiner trims silence, and all-zero audio is nothing but silence.
    const chunk = new Uint8Array(bytes / pieces).fill(64);
    let sent = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (sent++ < pieces) controller.enqueue(chunk);
        else controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'audio/pcm', 'request-id': `r${calls.length}` } });
  };
  return calls;
};

test('bytes convert to seconds for mp3, pcm and ulaw formats', () => {
  assert.equal(secondsOfAudio(16000, 'mp3_44100_128'), 1);
  assert.equal(secondsOfAudio(32000, 'pcm_16000'), 1);
  assert.equal(secondsOfAudio(8000, 'ulaw_8000'), 1);
  assert.equal(secondsOfAudio(100, 'opus_48000'), null);
});

test('a dub streams its passages and reports progress until every passage is done', async () => {
  const calls = mockFetch();
  const updates = [];
  const { buffer } = await synthesizeScript(
    { voiceId: 'v1', text: LONG_TEXT, modelId: 'eleven_multilingual_v2', outputFormat: FORMAT, voiceSettings: SETTINGS },
    { apiKey: 'test-key', onProgress: (p) => updates.push({ ...p }) }
  );

  assert.ok(buffer.length > 0);
  assert.ok(calls.every((url) => url.includes('/stream')), 'every passage uses the streaming endpoint');
  const voicing = updates.filter((u) => u.phase === 'voicing');
  const last = voicing.at(-1);
  assert.ok(last.passageCount > 1, 'the long script is split into passages');
  assert.equal(last.passagesDone, last.passageCount);
  assert.equal(last.charsDone, last.totalChars);
  // Seconds only ever grow, and arrive in steps smaller than a whole passage.
  const seconds = voicing.map((u) => u.secondsGenerated);
  assert.deepEqual(seconds, [...seconds].sort((a, b) => a - b));
  assert.ok(seconds.some((s) => s % 1 !== 0), 'progress arrives mid-passage');
  assert.equal(updates.at(-1).phase, 'joining');
});

test('when streaming is refused the dub still completes without live progress', async () => {
  const calls = mockFetch({ refuseStream: true });
  const updates = [];
  await synthesizeScript(
    { voiceId: 'v1', text: LONG_TEXT, modelId: 'eleven_multilingual_v2', outputFormat: FORMAT, voiceSettings: SETTINGS },
    { apiKey: 'test-key', onProgress: (p) => updates.push({ ...p }) }
  );
  assert.equal(calls.filter((url) => url.includes('/stream')).length, 1, 'streaming is only tried once');
  const last = updates.filter((u) => u.phase === 'voicing').at(-1);
  assert.equal(last.streaming, false);
  assert.equal(last.passagesDone, last.passageCount);
});

test('cancelling stops the dub before the remaining passages are requested', async () => {
  const controller = new AbortController();
  let requests = 0;
  mockFetch({
    onRequest: () => {
      requests += 1;
      if (requests === 1) queueMicrotask(() => controller.abort());
    },
  });
  await assert.rejects(
    synthesizeScript(
      { voiceId: 'v1', text: LONG_TEXT, modelId: 'eleven_multilingual_v2', outputFormat: FORMAT, voiceSettings: SETTINGS },
      { apiKey: 'test-key', signal: controller.signal }
    ),
    (err) => err.code === 'cancelled' && err.status === 499
  );
  assert.equal(requests, 1, 'no passage after the cancel is requested');
});

test('dub jobs track progress, cancel once, and reject malformed ids', () => {
  assert.equal(startDubJob('bad id!'), null);
  const job = startDubJob('job-12345678');
  updateDubJob('job-12345678', { phase: 'voicing', passagesDone: 1 });
  assert.equal(getDubProgress('job-12345678').passagesDone, 1);
  assert.equal(cancelDubJob('job-12345678'), true);
  assert.equal(job.controller.signal.aborted, true);
  assert.equal(cancelDubJob('job-12345678'), false);
  finishDubJob('job-12345678', 'cancelled');
  assert.equal(getDubProgress('job-12345678').phase, 'cancelled');
  assert.equal(getDubProgress('nope-12345678'), null);
});

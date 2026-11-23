import type { AudioSegment } from '../types';
import { pcmWavLayout } from './audioService.ts';
import { speakerOf } from './speakers.ts';

/**
 * One read with several speakers: each speaker's lines are read in one take
 * by their own voice, and the takes are joined one after another, with
 * silence between, into one file Sync cuts every line from as it does from a
 * one-voice read (server/lib/dubTakes.js). The joined file is never heard as
 * the dub: only the lines cut from it are placed.
 *
 * Nothing is changed about any take: their samples are copied as they are.
 */

/** Silence between two speakers' takes, so a cut between them lands in it. */
export const READ_GAP_SECONDS = 1;

/** The cues with words, by speaker in the order each first speaks; each speaker's cues in script order. */
export const speakerReadPlan = (segments: AudioSegment[]): { speaker: string; segments: AudioSegment[] }[] => {
  const bySpeaker = new Map<string, AudioSegment[]>();
  for (const segment of segments) {
    if (!(segment.textTarget || segment.targetText || '').trim()) continue;
    const speaker = speakerOf(segment);
    const own = bySpeaker.get(speaker);
    if (own) own.push(segment);
    else bySpeaker.set(speaker, [segment]);
  }
  return [...bySpeaker].map(([speaker, own]) => ({ speaker, segments: own }));
};

/** Bytes of a WAV read to find its layout: room for any header a voice gives. */
const HEAD_BYTES = 64 * 1024;

const header = (dataBytes: number, sampleRate: number, float: boolean): ArrayBuffer => {
  const bytesPerSample = float ? 4 : 2;
  const b = new ArrayBuffer(44);
  const v = new DataView(b);
  const tag = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, float ? 3 : 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * bytesPerSample, true);
  v.setUint16(32, bytesPerSample, true);
  v.setUint16(34, bytesPerSample * 8, true);
  tag(36, 'data');
  v.setUint32(40, dataBytes, true);
  return b;
};

/**
 * The takes joined in order, `gapSeconds` of silence between each two, as one
 * mono WAV in their own sample format. Null when they can't be joined without
 * changing them: not mono 16-bit or float WAV (an MP3 take), or not all at one
 * sample rate and format.
 */
export const joinReads = async (takes: Blob[], gapSeconds = READ_GAP_SECONDS): Promise<Blob | null> => {
  if (takes.length === 0) return null;
  const layouts = await Promise.all(takes.map(async (take) => pcmWavLayout(await take.slice(0, HEAD_BYTES).arrayBuffer(), take.size)));
  const first = layouts[0];
  if (!first || layouts.some((l) => !l || l.channels !== 1 || l.sampleRate !== first.sampleRate || l.float !== first.float)) return null;
  const bytesPerSample = first.float ? 4 : 2;
  const gap = new ArrayBuffer(Math.max(0, Math.round(gapSeconds * first.sampleRate)) * bytesPerSample);
  const parts: (Blob | ArrayBuffer)[] = [];
  let dataBytes = 0;
  takes.forEach((take, i) => {
    const { offset, frames } = layouts[i]!;
    if (i > 0) {
      parts.push(gap);
      dataBytes += gap.byteLength;
    }
    parts.push(take.slice(offset, offset + frames * bytesPerSample));
    dataBytes += frames * bytesPerSample;
  });
  return new Blob([header(dataBytes, first.sampleRate, first.float), ...parts], { type: 'audio/wav' });
};

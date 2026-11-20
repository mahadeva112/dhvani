import path from 'node:path';
import { Transform } from 'node:stream';
import { pathToFileURL } from 'node:url';

/**
 * Export for DaVinci Resolve: a folder Resolve's free version imports with no
 * scripts. The timeline is FCPXML (File › Import › Timeline): the dub's lines
 * as clips in place, one track per speaker, problem lines marked. The WAVs
 * keep every sample as it was; only a BWF `bext` chunk is added, so Resolve
 * reads where the file starts on the timeline.
 */

/** The frame rates offered, as FCPXML frame durations (seconds = num / den per frame). */
export const FRAME_RATES = {
  '23.976': { num: 1001, den: 24000, base: 24 },
  '24': { num: 1, den: 24, base: 24 },
  '25': { num: 1, den: 25, base: 25 },
  '29.97': { num: 1001, den: 30000, base: 30 },
  '30': { num: 1, den: 30, base: 30 },
  '50': { num: 1, den: 50, base: 50 },
  '59.94': { num: 1001, den: 60000, base: 60 },
  '60': { num: 1, den: 60, base: 60 },
};

export const rateOf = (fps) => {
  const rate = FRAME_RATES[String(fps)];
  if (!rate) throw new Error(`Frame rate ${fps} is not one Resolve timelines use.`);
  return rate;
};

/**
 * Frames from midnight for a non-drop timecode "HH:MM:SS:FF" (";" accepted
 * as the last separator). Null for anything that isn't one at this rate.
 */
export const timecodeFrames = (timecode, fps) => {
  const { base } = rateOf(fps);
  const m = /^(\d{1,2})[:.](\d{2})[:.](\d{2})[:;.](\d{2,3})$/.exec(String(timecode || '').trim());
  if (!m) return null;
  const [h, min, s, f] = m.slice(1).map(Number);
  if (min > 59 || s > 59 || f >= base || h > 23) return null;
  return ((h * 60 + min) * 60 + s) * base + f;
};

/** Seconds of `frames` frames at this rate. */
export const framesToSeconds = (frames, fps) => {
  const { num, den } = rateOf(fps);
  return (frames * num) / den;
};

/** An FCPXML time for `frames` frames: a rational, exact at every rate. */
export const fcpTime = (frames, fps) => {
  const { num, den } = rateOf(fps);
  if (frames === 0) return '0s';
  return den === 1 ? `${frames * num}s` : `${frames * num}/${den}s`;
};

const toFrames = (seconds, fps, round = Math.round) => {
  const { num, den } = rateOf(fps);
  return round((seconds * den) / num);
};

/**
 * Cuts one track's file into a clip per line, on frame boundaries, edge to
 * edge: each cut falls halfway between a line's last word and the next one's
 * first, the first clip starts at 0 and the last ends at the file's end. So
 * the clips together play the file exactly as it is: nothing between lines
 * is dropped, and each line can still be moved on its own in Resolve.
 *
 * `lines`: { start, end, name, note? } in seconds, any order. Lines too close
 * to fit a frame of their own join the clip before them.
 */
export const partitionClips = (lines, duration, fps) => {
  const total = toFrames(duration, fps, Math.floor);
  const placed = lines
    .filter((l) => Number.isFinite(l.start) && Number.isFinite(l.end) && l.end > l.start)
    .sort((a, b) => a.start - b.start);
  if (total < 1 || placed.length === 0) return [];
  const clips = [];
  let from = 0;
  placed.forEach((line, i) => {
    const next = placed[i + 1];
    const to = next ? Math.min(total, toFrames((line.end + next.start) / 2, fps)) : total;
    const notes = line.note ? [{ at: toFrames(line.start, fps), note: line.note }] : [];
    if (to <= from) {
      // No frame of its own: it plays inside the clip before it.
      const prev = clips[clips.length - 1];
      if (prev) prev.notes.push(...notes);
      return;
    }
    clips.push({ name: line.name, from, to, notes });
    from = to;
  });
  // A line that ended up with no frame at the very start still has its audio in the next clip.
  if (clips.length && clips[clips.length - 1].to < total) clips[clips.length - 1].to = total;
  return clips;
};

const xml = (text) =>
  String(text ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * The FCPXML timeline. `tracks`: { name, file (absolute path), duration
 * (seconds), sampleRate, channels, lines: [{ start, end, name, note? }] }, in
 * track order: the first is the top audio track. Every file starts at the
 * timeline's start timecode, as its `bext` says.
 */
export const buildFcpxml = ({ title, fps, startTimecode = '01:00:00:00', width = 1920, height = 1080, tracks }) => {
  const startFrames = timecodeFrames(startTimecode, fps);
  if (startFrames === null) throw new Error(`"${startTimecode}" is not a timecode at ${fps} fps.`);
  const length = Math.max(1, ...tracks.map((t) => toFrames(t.duration, fps, Math.floor)));
  const t = (frames) => fcpTime(frames, fps);
  const assets = tracks.map(
    (track, i) =>
      `    <asset id="a${i + 1}" name="${xml(path.basename(track.file))}" start="${t(startFrames)}" duration="${t(toFrames(track.duration, fps, Math.floor))}" hasAudio="1" audioSources="1" audioChannels="${track.channels || 1}" audioRate="${track.sampleRate || 48000}">\n` +
      `      <media-rep kind="original-media" src="${xml(pathToFileURL(track.file).href)}"/>\n` +
      `    </asset>`
  );
  const clips = tracks.flatMap((track, i) =>
    partitionClips(track.lines, track.duration, fps).map((clip) => {
      const at = startFrames + clip.from;
      const attrs = `ref="a${i + 1}" lane="${-(i + 1)}" name="${xml(clip.name)}" offset="${t(at)}" start="${t(at)}" duration="${t(clip.to - clip.from)}" audioRole="dialogue"`;
      if (clip.notes.length === 0) return `              <asset-clip ${attrs}/>`;
      const markers = clip.notes.map((n) => {
        const frame = startFrames + Math.min(Math.max(n.at, clip.from), clip.to - 1);
        return `                <marker start="${t(frame)}" duration="${t(1)}" value="${xml(n.note)}"/>`;
      });
      return [`              <asset-clip ${attrs}>`, ...markers, '              </asset-clip>'].join('\n');
    })
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE fcpxml>',
    '<fcpxml version="1.9">',
    '  <resources>',
    `    <format id="r1" name="${xml(`DHVANI ${height}p${fps}`)}" frameDuration="${t(1)}" width="${width}" height="${height}"/>`,
    ...assets,
    '  </resources>',
    '  <library>',
    '    <event name="DHVANI">',
    `      <project name="${xml(title)}">`,
    `        <sequence format="r1" duration="${t(length)}" tcStart="${t(startFrames)}" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    '          <spine>',
    `            <gap name="Gap" offset="${t(startFrames)}" start="${t(startFrames)}" duration="${t(length)}">`,
    ...clips,
    '            </gap>',
    '          </spine>',
    '        </sequence>',
    '      </project>',
    '    </event>',
    '  </library>',
    '</fcpxml>',
    '',
  ].join('\n');
};

/** A file name Windows, macOS and Resolve all take: the name kept, only what they refuse swapped. */
export const safeFileName = (name, fallback = 'DHVANI dub') => {
  const clean = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 120);
  return clean || fallback;
};

/**
 * A BWF `bext` chunk (version 1): the description, DHVANI as originator, and
 * the time reference, samples from midnight, which is where Resolve puts the
 * file's start timecode.
 */
export const bextChunk = ({ timeReference, description = '', date = new Date() }) => {
  const body = Buffer.alloc(602);
  body.write(String(description).slice(0, 255), 0, 256, 'latin1');
  body.write('DHVANI', 256, 32, 'latin1');
  const pad = (n) => String(n).padStart(2, '0');
  body.write(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, 320, 10, 'latin1');
  body.write(`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`, 330, 8, 'latin1');
  const ref = BigInt(Math.max(0, Math.round(timeReference)));
  body.writeUInt32LE(Number(ref & 0xffffffffn), 338);
  body.writeUInt32LE(Number(ref >> 32n), 342);
  body.writeUInt16LE(1, 346);
  const head = Buffer.alloc(8);
  head.write('bext', 0, 4, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
};

/**
 * Reads a WAV's chunks up to its audio: the format and where the samples
 * start. Null until `head` holds the `data` chunk's header, or for anything
 * that isn't a RIFF WAV.
 */
export const wavLayout = (head) => {
  if (head.length < 12 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') return { wav: false };
  let format = null;
  let hasBext = false;
  for (let at = 12; at + 8 <= head.length; ) {
    const id = head.toString('latin1', at, at + 4);
    const size = head.readUInt32LE(at + 4);
    if (id === 'fmt ' && at + 24 <= head.length) {
      format = {
        channels: head.readUInt16LE(at + 10),
        sampleRate: head.readUInt32LE(at + 12),
        blockAlign: head.readUInt16LE(at + 20),
      };
    }
    if (id === 'bext') hasBext = true;
    if (id === 'data') return { wav: true, format, hasBext, dataAt: at, dataSize: size };
    at += 8 + size + (size % 2);
  }
  return { wav: true, incomplete: true };
};

/** Seconds of audio a WAV's layout holds. */
export const wavDuration = (layout) =>
  layout?.format?.blockAlign && layout.format.sampleRate ? layout.dataSize / layout.format.blockAlign / layout.format.sampleRate : null;

/**
 * Passes a WAV through with a `bext` chunk put in just before its audio and
 * the RIFF size grown to match; the samples go through byte for byte. Anything
 * that isn't a WAV (an MP3), or a WAV that already has a `bext`, passes
 * through untouched. `onLayout` gets the WAV's layout once it is read.
 */
export const withBextTimecode = ({ timeReferenceSeconds, description, onLayout = () => {} }) => {
  let head = Buffer.alloc(0);
  let done = false;
  const MAX_HEAD = 1024 * 1024;
  return new Transform({
    transform(chunk, _enc, callback) {
      if (done) return callback(null, chunk);
      head = Buffer.concat([head, chunk]);
      if (head.length < 12) return callback();
      const layout = wavLayout(head);
      if (layout.incomplete && head.length < MAX_HEAD) return callback();
      done = true;
      if (!layout.wav || layout.incomplete || !layout.format || layout.hasBext) {
        onLayout(layout.wav && !layout.incomplete ? layout : null);
        return callback(null, head);
      }
      onLayout(layout);
      const bext = bextChunk({ timeReference: timeReferenceSeconds * layout.format.sampleRate, description });
      const before = Buffer.from(head.subarray(0, layout.dataAt));
      before.writeUInt32LE((head.readUInt32LE(4) + bext.length) >>> 0, 4);
      callback(null, Buffer.concat([before, bext, head.subarray(layout.dataAt)]));
    },
    flush(callback) {
      if (!done && head.length) {
        onLayout(null);
        this.push(head);
      }
      callback();
    },
  });
};

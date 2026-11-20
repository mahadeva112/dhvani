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

/** The FRAME_RATES key for a rate ffmpeg reports ("25", "29.97", "23.98"), or null when Resolve has no such timeline rate. */
export const rateFromFps = (fps) => {
  const value = Number(fps);
  if (!Number.isFinite(value) || value <= 0) return null;
  // The nearest one: 23.98 is 23.976, not 24.
  const [best] = Object.entries(FRAME_RATES)
    .map(([key, r]) => [key, Math.abs(r.den / r.num - value)])
    .sort((a, b) => a[1] - b[1]);
  return best && best[1] < 0.015 ? best[0] : null;
};

/**
 * What ffmpeg says about a media file (its `-i` report): length, the first
 * video stream's size and rate, the first audio stream's rate and channels,
 * and a start timecode if the file carries one. Fields it doesn't find are null.
 */
export const parseMediaInfo = (text) => {
  const report = String(text || '');
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(report);
  const videoLine = report.split(/\r?\n/).find((l) => /Stream #.*: Video:/.test(l) && !/attached pic/.test(l)) || null;
  const audioLine = report.split(/\r?\n/).find((l) => /Stream #.*: Audio:/.test(l)) || null;
  const size = videoLine && /\b(\d{2,5})x(\d{2,5})\b/.exec(videoLine);
  const fps = videoLine && (/(\d+(?:\.\d+)?) fps/.exec(videoLine) || /(\d+(?:\.\d+)?) tbr/.exec(videoLine));
  const channels = audioLine
    ? /\bmono\b/.test(audioLine)
      ? 1
      : /\bstereo\b/.test(audioLine)
        ? 2
        : /\b5\.1\b/.test(audioLine)
          ? 6
          : Number(/(\d+) channels/.exec(audioLine)?.[1]) || 2
    : null;
  const tc = /timecode\s*:\s*(\d{2}:\d{2}:\d{2}[:;.]\d{2})/.exec(report);
  return {
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null,
    hasVideo: Boolean(videoLine),
    width: size ? Number(size[1]) : null,
    height: size ? Number(size[2]) : null,
    fps: fps ? Number(fps[1]) : null,
    rate: fps ? rateFromFps(fps[1]) : null,
    hasAudio: Boolean(audioLine),
    sampleRate: audioLine ? Number(/(\d+) Hz/.exec(audioLine)?.[1]) || 48000 : null,
    channels,
    timecode: tc ? tc[1] : null,
  };
};

/**
 * The FCPXML timeline. `tracks`: { name, file (absolute path), duration
 * (seconds), sampleRate, channels, lines: [{ start, end, name, note? }] }, in
 * track order: the first is the top audio track. Every file starts at the
 * timeline's start timecode, as its `bext` says.
 *
 * `video` (the original's picture on V1) and `guide` (the original's sound
 * on a track of its own, turned off) are { file, duration, start (the file's
 * own first frame, in timeline frames), hasVideo, hasAudio, width, height,
 * rate, sampleRate, channels }; both may be the same file. Without them the
 * timeline is the dub alone, as before.
 */
export const buildFcpxml = ({ title, fps, startTimecode = '01:00:00:00', width = 1920, height = 1080, tracks, video = null, guide = null }) => {
  const startFrames = timecodeFrames(startTimecode, fps);
  if (startFrames === null) throw new Error(`"${startTimecode}" is not a timecode at ${fps} fps.`);
  const t = (frames) => fcpTime(frames, fps);
  const frames = (seconds) => toFrames(seconds || 0, fps, Math.floor);
  const videoLen = video ? Math.max(1, frames(video.duration)) : 0;
  const length = Math.max(1, ...tracks.map((tr) => frames(tr.duration)), videoLen, guide ? frames(guide.duration) : 0);
  const picture = video ? { width: video.width || width, height: video.height || height } : { width, height };

  // The original's files: one asset each, the same one when picture and sound are one file.
  const media = [];
  const mediaId = (m) => {
    let found = media.find((x) => x.file === m.file);
    if (!found) media.push((found = { ...m, id: `s${media.length + 1}` }));
    return found.id;
  };
  const videoId = video ? mediaId(video) : null;
  const guideId = guide ? mediaId(guide) : null;
  const ownRate = video?.rate && video.rate !== String(fps) && FRAME_RATES[video.rate] ? video.rate : null;
  const formats = [`    <format id="r1" name="${xml(`DHVANI ${picture.height}p${fps}`)}" frameDuration="${t(1)}" width="${picture.width}" height="${picture.height}"/>`];
  if (ownRate) formats.push(`    <format id="r2" name="${xml(`DHVANI ${picture.height}p${ownRate}`)}" frameDuration="${fcpTime(1, ownRate)}" width="${picture.width}" height="${picture.height}"/>`);

  const assets = tracks.map(
    (track, i) =>
      `    <asset id="a${i + 1}" name="${xml(path.basename(track.file))}" start="${t(startFrames)}" duration="${t(frames(track.duration))}" hasAudio="1" audioSources="1" audioChannels="${track.channels || 1}" audioRate="${track.sampleRate || 48000}">\n` +
      `      <media-rep kind="original-media" src="${xml(pathToFileURL(track.file).href)}"/>\n` +
      `    </asset>`
  );
  for (const m of media) {
    const pic = m.hasVideo ? ` hasVideo="1" format="${ownRate && m.id === videoId ? 'r2' : 'r1'}"` : '';
    const sound = m.hasAudio ? ` hasAudio="1" audioSources="1" audioChannels="${m.channels || 2}" audioRate="${m.sampleRate || 48000}"` : '';
    assets.push(
      `    <asset id="${m.id}" name="${xml(path.basename(m.file))}" start="${t(m.start || 0)}" duration="${t(Math.max(1, frames(m.duration)))}"${pic}${sound}>\n` +
        `      <media-rep kind="original-media" src="${xml(pathToFileURL(m.file).href)}"/>\n` +
        `    </asset>`
    );
  }

  // The primary storyline: the video when there is one (then a gap if the dub runs longer), else one gap.
  const spine = video
    ? [{ kind: 'video', at: 0, len: videoLen, start: video.start || 0, children: [] }]
    : [{ kind: 'gap', at: 0, len: length, start: startFrames, children: [] }];
  if (video && length > videoLen) spine.push({ kind: 'gap', at: videoLen, len: length - videoLen, start: startFrames + videoLen, children: [] });
  /** The spine element a clip starting `frame` frames into the timeline hangs from, and that frame in its own time. */
  const anchor = (frame) => {
    const el = spine.find((e) => frame < e.at + e.len) || spine[spine.length - 1];
    return { el, local: el.start + (frame - el.at) };
  };

  tracks.forEach((track, i) => {
    for (const clip of partitionClips(track.lines, track.duration, fps)) {
      const at = startFrames + clip.from;
      const { el, local } = anchor(clip.from);
      const attrs = `ref="a${i + 1}" lane="${-(i + 1)}" name="${xml(clip.name)}" offset="${t(local)}" start="${t(at)}" duration="${t(clip.to - clip.from)}" audioRole="dialogue"`;
      if (clip.notes.length === 0) {
        el.children.push(`<asset-clip ${attrs}/>`);
        continue;
      }
      const markers = clip.notes.map((n) => {
        const frame = startFrames + Math.min(Math.max(n.at, clip.from), clip.to - 1);
        return `  <marker start="${t(frame)}" duration="${t(1)}" value="${xml(n.note)}"/>`;
      });
      el.children.push([`<asset-clip ${attrs}>`, ...markers, '</asset-clip>'].join('\n'));
    }
  });
  if (guide) {
    const { el, local } = anchor(0);
    el.children.push(
      `<asset-clip ref="${guideId}" lane="${-(tracks.length + 1)}" name="Original (guide)" offset="${t(local)}" start="${t(guide.start || 0)}" duration="${t(Math.max(1, frames(guide.duration)))}" srcEnable="audio" enabled="0" audioRole="dialogue"/>`
    );
  }

  const indent = (text, pad) => text.split('\n').map((l) => pad + l).join('\n');
  const spineXml = spine.map((el) => {
    const open =
      el.kind === 'video'
        ? `            <asset-clip ref="${videoId}" name="${xml(path.basename(video.file))}" offset="${t(startFrames + el.at)}" start="${t(el.start)}" duration="${t(el.len)}" srcEnable="video">`
        : `            <gap name="Gap" offset="${t(startFrames + el.at)}" start="${t(el.start)}" duration="${t(el.len)}">`;
    return [open, ...el.children.map((c) => indent(c, '              ')), el.kind === 'video' ? '            </asset-clip>' : '            </gap>'].join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE fcpxml>',
    '<fcpxml version="1.9">',
    '  <resources>',
    ...formats,
    ...assets,
    '  </resources>',
    '  <library>',
    '    <event name="DHVANI">',
    `      <project name="${xml(title)}">`,
    `        <sequence format="r1" duration="${t(length)}" tcStart="${t(startFrames)}" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    '          <spine>',
    ...spineXml,
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
  let timeReference = null;
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
    if (id === 'bext') {
      hasBext = true;
      // Where the file starts, in samples from midnight.
      if (at + 8 + 346 <= head.length) timeReference = head.readUInt32LE(at + 8 + 338) + head.readUInt32LE(at + 8 + 342) * 2 ** 32;
    }
    if (id === 'data') return { wav: true, format, hasBext, timeReference, dataAt: at, dataSize: size };
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

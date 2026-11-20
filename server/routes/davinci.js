import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError, badRequest } from '../errors.js';
import { mediaReport } from '../lib/media.js';
import {
  buildFcpxml,
  framesToSeconds,
  parseMediaInfo,
  rateOf,
  safeFileName,
  timecodeFrames,
  wavDuration,
  wavLayout,
  withBextTimecode,
} from '../lib/davinciExport.js';

/**
 * Export for DaVinci Resolve: writes the dub's files and an FCPXML timeline
 * into a folder on this machine, so Resolve's free version imports them with
 * File › Import › Timeline. Writing to the disk is for the machine running
 * DHVANI only, and never for a page from another site.
 */
export const davinciRouter = Router();

const VIDEO = ['.mp4', '.mov', '.mkv', '.m4v', '.mxf', '.avi', '.webm', '.mts', '.m2ts', '.mpg', '.mpeg', '.ts', '.wmv', '.3gp', '.flv'];
const AUDIO = ['.wav', '.mp3', '.m4a', '.aac', '.flac', '.aif', '.aiff', '.ogg', '.opus', '.wma'];
const FILE_TYPES = {
  ...Object.fromEntries(VIDEO.map((e) => [e, 'video'])),
  ...Object.fromEntries(AUDIO.map((e) => [e, 'audio'])),
  '.srt': 'text',
  '.fcpxml': 'text',
};

/** The request came from this machine. */
const isLoopback = (req) => {
  const address = (req.socket?.remoteAddress || req.ip || '').replace(/^::ffff:/, '');
  return address === '127.0.0.1' || address === '::1' || address.startsWith('127.');
};

const localOnly = (req) => {
  if (!isLoopback(req)) throw new ApiError('Exporting to a folder works only on the machine running DHVANI.', { status: 403, code: 'remote_export_forbidden' });
  // A page from another site can still send a plain POST to localhost; it never gets to write.
  if (req.get('sec-fetch-site') === 'cross-site') throw new ApiError('Refused: the request came from another site.', { status: 403, code: 'cross_site' });
};

/** The folder asked for: a full path, made if it isn't there. */
const folderOf = async (raw) => {
  const folder = typeof raw === 'string' ? raw.trim() : '';
  if (!folder || !path.isAbsolute(folder)) throw badRequest('Pick a full folder path, like D:\\Dubs\\For DaVinci.');
  try {
    await fs.promises.mkdir(folder, { recursive: true });
  } catch (err) {
    throw badRequest(`DHVANI could not make or open that folder: ${err.code === 'EACCES' || err.code === 'EPERM' ? 'Windows does not allow writing there' : err.message}.`);
  }
  return path.resolve(folder);
};

/** A file name in the folder: its own name only, of a type the export writes. */
const fileIn = (folder, rawName) => {
  const ext = path.extname(String(rawName || '')).toLowerCase();
  const base = safeFileName(path.basename(String(rawName || ''), ext), '');
  if (!base || !FILE_TYPES[ext]) throw badRequest('That file name or type is not part of a DaVinci export.');
  return path.join(folder, base + ext);
};

const kindOf = (file) => FILE_TYPES[path.extname(file).toLowerCase()];

/** GET /api/davinci/folder?name=… : where the export goes unless the user picks another folder. */
davinciRouter.get(
  '/davinci/folder',
  asyncHandler(async (req, res) => {
    localOnly(req);
    const docs = path.join(os.homedir(), 'Documents');
    const root = fs.existsSync(docs) ? docs : os.homedir();
    res.json({ folder: path.join(root, 'DHVANI', 'For DaVinci', safeFileName(req.query.name)) });
  })
);

/**
 * POST /api/davinci/fresh-folder { folder } : the folder itself when it is
 * new or empty, else the first of "folder 2", "folder 3"… that isn't there,
 * so an export can leave the files of the one before as they were.
 */
davinciRouter.post(
  '/davinci/fresh-folder',
  asyncHandler(async (req, res) => {
    localOnly(req);
    const raw = typeof req.body?.folder === 'string' ? req.body.folder.trim() : '';
    if (!raw || !path.isAbsolute(raw)) throw badRequest('Pick a full folder path, like D:\\Dubs\\For DaVinci.');
    const base = path.resolve(raw);
    const used = (dir) => fs.existsSync(dir) && (!fs.statSync(dir).isDirectory() || fs.readdirSync(dir).length > 0);
    if (!used(base)) return res.json({ folder: base });
    for (let n = 2; n < 1000; n++) {
      const next = `${base} ${n}`;
      if (!used(next)) return res.json({ folder: next });
    }
    throw badRequest('Too many exports in that folder: pick another one.');
  })
);

/** A WAV in the folder: its rate, channels, length, and where its bext says it starts, read from its header. */
const readWav = async (file) => {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(1024 * 1024), 0, 1024 * 1024, 0);
    const layout = wavLayout(buffer.subarray(0, bytesRead));
    if (!layout.format) return null;
    return {
      sampleRate: layout.format.sampleRate,
      channels: layout.format.channels,
      duration: wavDuration(layout),
      startSeconds: layout.timeReference !== null && layout.timeReference !== undefined ? layout.timeReference / layout.format.sampleRate : 0,
    };
  } finally {
    await handle.close();
  }
};

/** What a media file in the folder holds: a WAV from its header, anything else from ffmpeg's report. */
const describe = async (file) => {
  if (path.extname(file).toLowerCase() === '.wav') {
    const wav = await readWav(file);
    return wav && { ...wav, hasAudio: true, hasVideo: false, width: null, height: null, fps: null, rate: null, timecode: null };
  }
  const report = await mediaReport(file);
  if (!report) return null;
  const info = parseMediaInfo(report);
  return info.duration ? { ...info, startSeconds: null } : null;
};

/** Turns a failed write into words: a full disk, or a file Resolve (or another app) is holding. */
const writeError = (err, file) => {
  if (err.code === 'ENOSPC') return new ApiError('The disk is full: the export stopped. Free some space and export again.', { status: 507, code: 'disk_full' });
  if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')
    return new ApiError(
      `${path.basename(file)} is open in another app, likely Resolve, so it can't be written over. Close the project in Resolve, or turn off "Export again writes over the same files", and export again.`,
      { status: 409, code: 'file_in_use' }
    );
  return err;
};

/**
 * PUT /api/davinci/file?folder=…&name=…&fps=…&tc=… : one media file, its body
 * the file itself. A WAV gets a `bext` chunk saying it starts at the
 * timeline's start timecode; its samples are written as they came. A video
 * or any other file is written exactly as sent. Written beside as .part and
 * renamed, so a stopped export leaves no half file. Replies with what the
 * file holds (for a video: its size, rate and length).
 */
davinciRouter.put(
  '/davinci/file',
  asyncHandler(async (req, res) => {
    localOnly(req);
    const folder = await folderOf(req.query.folder);
    const file = fileIn(folder, req.query.name);
    if (kindOf(file) !== 'audio' && kindOf(file) !== 'video') throw badRequest('Only media files are sent this way.');
    const fps = String(req.query.fps || '25');
    rateOf(fps);
    const startFrames = timecodeFrames(req.query.tc, fps);
    if (startFrames === null) throw badRequest(`"${req.query.tc}" is not a timecode at ${fps} fps. Use HH:MM:SS:FF, like 01:00:00:00.`);
    const part = `${file}.part`;
    let layout = null;
    try {
      await pipeline(
        req,
        withBextTimecode({
          timeReferenceSeconds: framesToSeconds(startFrames, fps),
          description: path.basename(file),
          onLayout: (l) => (layout = l),
        }),
        fs.createWriteStream(part)
      );
      await fs.promises.rename(part, file);
    } catch (err) {
      await fs.promises.rm(part, { force: true });
      throw writeError(err, file);
    }
    const media = layout ? null : await describe(file);
    res.json({ path: file, wav: Boolean(layout), sampleRate: layout?.format?.sampleRate ?? null, duration: wavDuration(layout) ?? media?.duration ?? null, media });
  })
);

/**
 * GET /api/davinci/probe?folder=…&name=… : whether a media file is already in
 * the folder, its size, and what it holds; so an unchanged video is not
 * copied again.
 */
davinciRouter.get(
  '/davinci/probe',
  asyncHandler(async (req, res) => {
    localOnly(req);
    const folder = typeof req.query.folder === 'string' && path.isAbsolute(req.query.folder) ? path.resolve(req.query.folder) : null;
    if (!folder) throw badRequest('Pick a full folder path.');
    const file = fileIn(folder, req.query.name);
    if (!fs.existsSync(file)) return res.json({ exists: false });
    const size = fs.statSync(file).size;
    res.json({ exists: true, size, path: file, media: await describe(file) });
  })
);

/**
 * POST /api/davinci/timeline : the FCPXML (and the SRT, if sent) for files
 * already written. Body: { folder, title, fileName, fps, startTimecode,
 * tracks: [{ name, file, duration, lines: [{ start, end, name, note? }] }],
 * video?: { file }, guide?: { file }, srt?: { name, text } }. A WAV's own
 * header gives its length and rate; the duration sent is used only for an
 * MP3. The video and the guide are read with ffmpeg.
 */
davinciRouter.post(
  '/davinci/timeline',
  asyncHandler(async (req, res) => {
    localOnly(req);
    const { title, fileName, fps = '25', startTimecode = '01:00:00:00', tracks, srt } = req.body || {};
    const folder = await folderOf(req.body?.folder);
    rateOf(String(fps));
    if (!Array.isArray(tracks)) throw badRequest('The timeline has no tracks.');
    const startFrames = timecodeFrames(startTimecode, String(fps));
    if (startFrames === null) throw badRequest(`"${startTimecode}" is not a timecode at ${fps} fps.`);
    const written = [];
    const notes = [];
    let timelineFile = null;
    if (tracks.length > 0) {
      const placed = [];
      for (const track of tracks) {
        const file = fileIn(folder, track.file);
        if (!fs.existsSync(file)) throw badRequest(`${path.basename(file)} is not in the folder: export again.`);
        const wav = path.extname(file).toLowerCase() === '.wav' ? await readWav(file) : null;
        placed.push({
          name: String(track.name || ''),
          file,
          duration: wav?.duration ?? (Number(track.duration) || 0),
          sampleRate: wav?.sampleRate ?? 48000,
          channels: wav?.channels ?? 1,
          lines: Array.isArray(track.lines) ? track.lines : [],
        });
      }
      /** The original's file, as the timeline places it: its first frame in timeline frames. */
      const original = async (raw, what) => {
        if (!raw?.file) return null;
        const file = fileIn(folder, raw.file);
        if (!fs.existsSync(file)) throw badRequest(`${path.basename(file)} is not in the folder: export again.`);
        const info = await describe(file);
        if (!info) throw badRequest(`DHVANI could not read ${what} (${path.basename(file)}). Export without it, or check the file plays.`);
        // A file's own timecode is where Resolve puts its first frame; with none it starts at 00:00:00:00.
        let startSeconds = info.startSeconds ?? 0;
        if (info.timecode) {
          const rate = info.rate || String(fps);
          const tc = timecodeFrames(info.timecode, rate);
          if (tc !== null) startSeconds = framesToSeconds(tc, rate);
        }
        return { ...info, file, start: Math.round((startSeconds * rateOf(String(fps)).den) / rateOf(String(fps)).num) };
      };
      // A video with no picture, or an original with no sound, is left out of the timeline, and the window says so.
      let video = await original(req.body?.video, 'the video');
      if (video && !video.hasVideo) {
        notes.push(`${path.basename(video.file)} has no picture, so V1 is empty`);
        video = null;
      }
      let guide = await original(req.body?.guide, 'the original audio');
      if (guide && !guide.hasAudio) {
        notes.push('The original has no sound, so there is no guide track');
        guide = null;
      }
      let xml;
      try {
        xml = buildFcpxml({ title: String(title || 'DHVANI dub'), fps: String(fps), startTimecode, tracks: placed, video, guide });
      } catch (err) {
        throw badRequest(err.message);
      }
      timelineFile = fileIn(folder, `${fileName || title || 'DHVANI dub'}.fcpxml`);
      await fs.promises.writeFile(timelineFile, xml, 'utf8').catch((err) => {
        throw writeError(err, timelineFile);
      });
      written.push(timelineFile);
    }
    if (srt?.text) {
      const srtFile = fileIn(folder, srt.name);
      // With a BOM, so Resolve and Windows read Hindi or Bangla subtitles as UTF-8.
      await fs.promises.writeFile(srtFile, `\uFEFF${String(srt.text).replace(/^\uFEFF/, '')}`, 'utf8').catch((err) => {
        throw writeError(err, srtFile);
      });
      written.push(srtFile);
    }
    res.json({ folder, timeline: timelineFile, written, notes });
  })
);

/** POST /api/davinci/reveal { folder } : opens the export folder in Explorer or Finder. */
davinciRouter.post(
  '/davinci/reveal',
  asyncHandler(async (req, res) => {
    localOnly(req);
    const folder = typeof req.body?.folder === 'string' ? path.resolve(req.body.folder) : '';
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw badRequest('That folder is not there any more.');
    const opener = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    // Explorer answers 1 even when it opened the folder; only a failure to start is an error.
    execFile(opener, [folder], () => {});
    res.json({ ok: true });
  })
);

/** Where Resolve is installed on this machine, if it is: its usual places only. */
const resolveApp = () => {
  if (process.platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env.ProgramW6432, 'C:\\Program Files'].filter(Boolean);
    for (const root of roots) {
      const exe = path.join(root, 'Blackmagic Design', 'DaVinci Resolve', 'Resolve.exe');
      if (fs.existsSync(exe)) return exe;
    }
    return null;
  }
  if (process.platform === 'darwin') {
    for (const app of ['/Applications/DaVinci Resolve/DaVinci Resolve.app', '/Applications/DaVinci Resolve Studio/DaVinci Resolve Studio.app', '/Applications/DaVinci Resolve.app']) {
      if (fs.existsSync(app)) return app;
    }
    return null;
  }
  return fs.existsSync('/opt/resolve/bin/resolve') ? '/opt/resolve/bin/resolve' : null;
};

const run = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (err, stdout) => resolve(err && !stdout ? null : String(stdout || '')));
  });

let studioSeen = { key: '', studio: null };
/** True for Resolve Studio, false for the free version, null when it can't be told. */
const isStudio = async (app) => {
  const key = `${app}:${fs.statSync(app).mtimeMs}`;
  if (studioSeen.key === key) return studioSeen.studio;
  let studio = null;
  if (process.platform === 'win32') {
    const name = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath '${app.replace(/'/g, "''")}').VersionInfo.ProductName`]);
    if (name !== null && name.trim()) studio = /studio/i.test(name);
  } else if (/studio/i.test(app)) studio = true;
  studioSeen = { key, studio };
  return studio;
};

const isRunning = async () => {
  if (process.platform === 'win32') {
    const out = await run('tasklist', ['/FI', 'IMAGENAME eq Resolve.exe', '/NH', '/FO', 'CSV']);
    return Boolean(out && /"Resolve\.exe"/i.test(out));
  }
  const out = await run('pgrep', ['-x', process.platform === 'darwin' ? 'Resolve' : 'resolve']);
  return Boolean(out && out.trim());
};

/** GET /api/davinci/resolve : whether Resolve is on this machine, which version, and whether it is open. */
davinciRouter.get(
  '/davinci/resolve',
  asyncHandler(async (req, res) => {
    localOnly(req);
    const app = resolveApp();
    if (!app) return res.json({ installed: false, studio: null, running: false });
    const [studio, running] = await Promise.all([isStudio(app), isRunning()]);
    res.json({ installed: true, studio, running });
  })
);

/** POST /api/davinci/open-resolve : starts Resolve, unless it is open already. */
davinciRouter.post(
  '/davinci/open-resolve',
  asyncHandler(async (req, res) => {
    localOnly(req);
    const app = resolveApp();
    if (!app) throw badRequest('DaVinci Resolve is not installed in its usual place on this computer.');
    if (await isRunning()) return res.json({ opened: false, running: true });
    const child =
      process.platform === 'darwin'
        ? spawn('open', ['-a', app], { detached: true, stdio: 'ignore' })
        : spawn(app, [], { detached: true, stdio: 'ignore', cwd: path.dirname(app), windowsHide: false });
    child.on('error', () => {});
    child.unref();
    res.json({ opened: true, running: false });
  })
);

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError, badRequest } from '../errors.js';
import { isLoopback } from './settings.js';
import { buildFcpxml, framesToSeconds, rateOf, safeFileName, timecodeFrames, wavDuration, wavLayout, withBextTimecode } from '../lib/davinciExport.js';

/**
 * Export for DaVinci Resolve: writes the dub's files and an FCPXML timeline
 * into a folder on this machine, so Resolve's free version imports them with
 * File › Import › Timeline. Writing to the disk is for the machine running
 * DHVANI only, and never for a page from another site.
 */
export const davinciRouter = Router();

const FILE_TYPES = { '.wav': 'audio', '.mp3': 'audio', '.srt': 'text', '.fcpxml': 'text' };

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
 * PUT /api/davinci/file?folder=…&name=…&fps=…&tc=… : one audio file, its
 * body the file itself. A WAV gets a `bext` chunk saying it starts at the
 * timeline's start timecode; its samples are written as they came. Written
 * beside as .part and renamed, so a stopped export leaves no half file.
 */
davinciRouter.put(
  '/davinci/file',
  asyncHandler(async (req, res) => {
    localOnly(req);
    const folder = await folderOf(req.query.folder);
    const file = fileIn(folder, req.query.name);
    if (FILE_TYPES[path.extname(file).toLowerCase()] !== 'audio') throw badRequest('Only the dub audio is sent this way.');
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
      if (err.code === 'ENOSPC') throw new ApiError('The disk is full: the export stopped. Free some space and export again.', { status: 507, code: 'disk_full' });
      throw err;
    }
    res.json({ path: file, wav: Boolean(layout), sampleRate: layout?.format?.sampleRate ?? null, duration: wavDuration(layout) });
  })
);

/** A WAV in the folder: its rate, channels and length, read from its header. */
const readWav = async (file) => {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(1024 * 1024), 0, 1024 * 1024, 0);
    const layout = wavLayout(buffer.subarray(0, bytesRead));
    return layout.format ? { sampleRate: layout.format.sampleRate, channels: layout.format.channels, duration: wavDuration(layout) } : null;
  } finally {
    await handle.close();
  }
};

/**
 * POST /api/davinci/timeline : the FCPXML (and the SRT, if sent) for files
 * already written. Body: { folder, title, fileName, fps, startTimecode,
 * tracks: [{ name, file, duration, lines: [{ start, end, name, note? }] }],
 * srt?: { name, text } }. A WAV's own header gives its length and rate; the
 * duration sent is used only for an MP3.
 */
davinciRouter.post(
  '/davinci/timeline',
  asyncHandler(async (req, res) => {
    localOnly(req);
    const { title, fileName, fps = '25', startTimecode = '01:00:00:00', tracks, srt } = req.body || {};
    const folder = await folderOf(req.body?.folder);
    rateOf(String(fps));
    if (!Array.isArray(tracks)) throw badRequest('The timeline has no tracks.');
    const written = [];
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
      let xml;
      try {
        xml = buildFcpxml({ title: String(title || 'DHVANI dub'), fps: String(fps), startTimecode, tracks: placed });
      } catch (err) {
        throw badRequest(err.message);
      }
      timelineFile = fileIn(folder, `${fileName || title || 'DHVANI dub'}.fcpxml`);
      await fs.promises.writeFile(timelineFile, xml, 'utf8');
      written.push(timelineFile);
    }
    if (srt?.text) {
      const srtFile = fileIn(folder, srt.name);
      // With a BOM, so Resolve and Windows read Hindi or Bangla subtitles as UTF-8.
      await fs.promises.writeFile(srtFile, `\uFEFF${String(srt.text).replace(/^\uFEFF/, '')}`, 'utf8');
      written.push(srtFile);
    }
    res.json({ folder, timeline: timelineFile, written });
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

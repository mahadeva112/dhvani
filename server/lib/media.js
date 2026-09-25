import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { config } from '../env.js';
import { logger } from '../logger.js';
import { ApiError } from '../errors.js';

/** Container/codec extensions ElevenLabs accepts directly. */
export const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wma', '.aiff', '.aif', '.amr',
]);

export const SUPPORTED_VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.mkv', '.webm', '.avi', '.wmv', '.flv', '.m4v', '.mpeg', '.mpg', '.3gp', '.ts',
]);

export const isVideoFile = (filename = '', mimetype = '') =>
  SUPPORTED_VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase()) ||
  String(mimetype).startsWith('video/');

export const isSupportedMedia = (filename = '', mimetype = '') => {
  const ext = path.extname(filename).toLowerCase();
  if (SUPPORTED_AUDIO_EXTENSIONS.has(ext) || SUPPORTED_VIDEO_EXTENSIONS.has(ext)) return true;
  return String(mimetype).startsWith('audio/') || String(mimetype).startsWith('video/');
};

/**
 * Resolves the ffmpeg binary. `ffmpeg-static` ships one, but the package is an
 * optional dependency, so a system ffmpeg on PATH is accepted as a fallback and
 * "no ffmpeg at all" is a supported (degraded) state rather than a failure.
 */
let ffmpegPathPromise = null;

const resolveFfmpeg = async () => {
  if (ffmpegPathPromise) return ffmpegPathPromise;

  ffmpegPathPromise = (async () => {
    try {
      const mod = await import('ffmpeg-static');
      const binary = mod.default || mod;
      if (binary && fs.existsSync(binary)) return binary;
    } catch {
      // ffmpeg-static not installed — fall through to PATH lookup.
    }

    const onPath = await new Promise((resolve) => {
      const probe = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
      probe.on('error', () => resolve(false));
      probe.on('close', (code) => resolve(code === 0));
    });

    return onPath ? 'ffmpeg' : null;
  })();

  return ffmpegPathPromise;
};

export const ffmpegAvailable = async () => Boolean(await resolveFfmpeg());

const run = (binary, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, args);
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-600)}`));
    });
  });

/** Runs ffmpeg with `input` on stdin and resolves with everything it wrote to stdout. */
const pipe = (binary, args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, args);
    const out = [];
    let stderr = '';
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    // ffmpeg can exit before reading all of stdin; the exit code reports why.
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-600)}`));
    });
    child.stdin.end(input);
  });

/**
 * Reads an ElevenLabs `output_format` such as `mp3_44100_128`, `pcm_24000`
 * or `ulaw_8000`. Returns null for formats DHVANI cannot decode and re-encode.
 */
export const parseOutputFormat = (outputFormat = '') => {
  const match = /^(mp3|pcm|ulaw|alaw)_(\d+)(?:_(\d+))?$/.exec(String(outputFormat));
  if (!match) return null;
  return { codec: match[1], sampleRate: Number(match[2]), bitrate: match[3] ? Number(match[3]) : null };
};

/** ffmpeg's raw format name for the headerless codecs. */
const RAW_FORMAT = { pcm: 's16le', ulaw: 'mulaw', alaw: 'alaw' };

const pcm16ToFloat = (buffer) => {
  const samples = new Float32Array(Math.floor(buffer.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = buffer.readInt16LE(i * 2) / 32768;
  return samples;
};

const floatToPcm16 = (samples) => {
  const buffer = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), i * 2);
  }
  return buffer;
};

const floatBytes = (samples) => Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);

/**
 * Decodes one ElevenLabs audio response to mono float samples at the format's
 * sample rate. 16-bit PCM needs no ffmpeg; everything else does, and without
 * it this throws so the caller can fall back.
 */
export const decodeAudio = async (buffer, outputFormat) => {
  const format = parseOutputFormat(outputFormat);
  if (!format) throw new Error(`Cannot decode the ${outputFormat} format.`);
  if (format.codec === 'pcm') return pcm16ToFloat(buffer);

  const binary = await resolveFfmpeg();
  if (!binary) throw new Error('ffmpeg is not available.');

  const inputArgs = format.codec === 'mp3' ? [] : ['-f', RAW_FORMAT[format.codec], '-ar', String(format.sampleRate), '-ac', '1'];
  const raw = await pipe(
    binary,
    ['-hide_banner', '-loglevel', 'error', ...inputArgs, '-i', 'pipe:0', '-ac', '1', '-ar', String(format.sampleRate), '-f', 'f32le', 'pipe:1'],
    buffer
  );
  // Copy out of the pooled Buffer so the Float32Array is aligned.
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
};

/** Encodes mono float samples back to the ElevenLabs `outputFormat` they were decoded from. */
export const encodeAudio = async (samples, outputFormat) => {
  const format = parseOutputFormat(outputFormat);
  if (!format) throw new Error(`Cannot encode the ${outputFormat} format.`);
  if (format.codec === 'pcm') return floatToPcm16(samples);

  const binary = await resolveFfmpeg();
  if (!binary) throw new Error('ffmpeg is not available.');

  const inputArgs = ['-f', 'f32le', '-ar', String(format.sampleRate), '-ac', '1', '-i', 'pipe:0'];
  const common = ['-hide_banner', '-loglevel', 'error'];

  if (format.codec !== 'mp3') {
    return pipe(binary, [...common, ...inputArgs, '-f', RAW_FORMAT[format.codec], 'pipe:1'], floatBytes(samples));
  }

  // MP3 goes through a file rather than stdout: ffmpeg can only write the
  // Xing/LAME header (exact duration, gapless trim) to a seekable output.
  const outputPath = path.join(os.tmpdir(), `dhvani-${randomUUID()}.mp3`);
  try {
    await pipe(
      binary,
      [
        ...common, ...inputArgs,
        '-c:a', 'libmp3lame',
        '-b:a', `${format.bitrate || 128}k`,
        '-map_metadata', '-1',
        '-id3v2_version', '0',
        '-write_id3v1', '0',
        '-y', outputPath,
      ],
      floatBytes(samples)
    );
    return await fs.promises.readFile(outputPath);
  } finally {
    await fs.promises.rm(outputPath, { force: true }).catch(() => {});
  }
};

/**
 * Extracts a mono 16 kHz WAV track from a video.
 *
 * The source file is opened read-only and never rewritten, so the user's
 * original video is untouched. Returns `null` when ffmpeg is unavailable or
 * extraction fails, letting the caller upload the original container instead.
 */
export const extractAudioTrack = async (inputPath, { onStatus } = {}) => {
  if (!config.extractAudioFromVideo) return null;

  const binary = await resolveFfmpeg();
  if (!binary) {
    logger.warn('ffmpeg not found — uploading the original media file to ElevenLabs instead.');
    return null;
  }

  const outputPath = path.join(os.tmpdir(), `dhvani-${randomUUID()}.wav`);

  try {
    onStatus?.('Extracting audio track from video...');
    await run(binary, [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', inputPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-c:a', 'pcm_s16le',
      '-y', outputPath,
    ]);

    const stats = await fs.promises.stat(outputPath);
    if (stats.size < 1024) throw new Error('extracted audio track is empty');

    return outputPath;
  } catch (err) {
    logger.warn(`Audio extraction failed (${err.message}); falling back to the original file.`);
    await fs.promises.rm(outputPath, { force: true }).catch(() => {});
    return null;
  }
};

/** Reads the media duration in seconds, or null when ffmpeg cannot report it. */
export const probeDuration = async (inputPath) => {
  const binary = await resolveFfmpeg();
  if (!binary) return null;

  try {
    const stderr = await run(binary, ['-hide_banner', '-i', inputPath, '-f', 'null', '-']).catch(
      (err) => err.message
    );
    const match = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stderr);
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  } catch {
    return null;
  }
};

export const assertSupportedMedia = (file) => {
  if (!file) throw new ApiError('No media file was uploaded.', { status: 400, code: 'no_file' });
  if (!isSupportedMedia(file.originalname, file.mimetype)) {
    throw new ApiError(
      `Unsupported file type "${path.extname(file.originalname) || file.mimetype || 'unknown'}". ` +
        'Upload an audio file (mp3, wav, m4a, flac, ogg, opus, aac) or a video file (mp4, mov, mkv, webm, avi).',
      { status: 415, code: 'unsupported_media' }
    );
  }
};

/** Best-effort cleanup of temp files; never throws. */
export const cleanupFiles = async (...paths) => {
  await Promise.all(
    paths.filter(Boolean).map((target) => fs.promises.rm(target, { force: true }).catch(() => {}))
  );
};

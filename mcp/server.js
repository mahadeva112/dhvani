#!/usr/bin/env node
/*
 * DHVANI MCP server.
 *
 * Gives Claude the DHVANI backend's own operations as tools: check the setup,
 * list voices, transcribe, translate an SRT, speak a line, time a dub's
 * subtitles and read the backend log. Every tool calls the backend that is
 * already running (the desktop app, or `npm run server`), so no key is ever
 * read or held here — the backend uses the keys it already has.
 *
 * Projects are not reachable: the app keeps them in the window's IndexedDB,
 * which no outside process can open.
 *
 * Talks MCP over stdio, so nothing may be written to stdout except protocol
 * messages; diagnostics go to stderr.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(here, '..');

/*
 * Where the backend listens. The desktop app runs it on 8788 (offset from the
 * dev default so both can run), `npm run server` on 8787. DHVANI_URL pins one.
 */
const CANDIDATE_URLS = process.env.DHVANI_URL
  ? [process.env.DHVANI_URL.replace(/\/+$/, '')]
  : ['http://127.0.0.1:8788', 'http://127.0.0.1:8787'];

let baseUrl = null;
let foundAt = 0;

/*
 * Looked up afresh unless the last lookup was moments ago, so a desktop app
 * opened after a dev server takes over at once instead of being passed over
 * for as long as this server runs. The short memory only spares the parallel
 * calls of one tool from probing each in turn.
 */
const REMEMBER_MS = 5000;

/** Finds a backend that answers as DHVANI, the desktop app first. */
const findBackend = async () => {
  if (baseUrl && Date.now() - foundAt < REMEMBER_MS) return baseUrl;
  baseUrl = null;
  for (const url of CANDIDATE_URLS) {
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
      const body = res.ok ? await res.json() : null;
      if (body?.service === 'dhvani-backend') {
        baseUrl = url;
        foundAt = Date.now();
        return url;
      }
    } catch {
      // Not listening there; try the next one.
    }
  }
  throw new Error(
    `No DHVANI backend answered at ${CANDIDATE_URLS.join(' or ')}. Open the DHVANI app (or run ` +
      '`npm run server`) and try again, or set DHVANI_URL to where it listens.'
  );
};

/** Reads the backend's own error message, which is written for a person to read. */
const errorFrom = async (res) => {
  const text = await res.text();
  try {
    const body = JSON.parse(text);
    return body?.error?.message || body?.message || text;
  } catch {
    return text || `${res.status} ${res.statusText}`;
  }
};

/** Calls the backend. `parse` picks how the body is read: json, buffer or ndjson (last event). */
const api = async (route, { method = 'GET', json, form, parse = 'json' } = {}) => {
  const url = await findBackend();
  let res;
  try {
    res = await fetch(`${url}/api${route}`, {
      method,
      headers: json ? { 'Content-Type': 'application/json' } : undefined,
      body: json ? JSON.stringify(json) : form,
    });
  } catch (err) {
    baseUrl = null;
    throw new Error(`The DHVANI backend at ${url} stopped answering: ${err.message}`);
  }
  if (!res.ok) throw new Error(await errorFrom(res));

  if (parse === 'buffer') {
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || '' };
  }
  if (parse === 'ndjson') {
    // Streaming routes report failure inside the stream, as the last line.
    const lines = (await res.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const last = lines.at(-1);
    if (!last) throw new Error('The backend closed the stream without a result.');
    if (last.type === 'error') throw new Error(last.message || 'The backend reported an error.');
    return last;
  }
  return res.json();
};

/** A local file as a multipart part, streamed from disk so a long recording is not read into memory. */
const filePart = async (filePath) => {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`No file at ${resolved}.`);
  return { blob: await fs.openAsBlob(resolved), name: path.basename(resolved) };
};

/** Picks where an output goes: the path asked for, or beside the input. Never replaces a file unless told to. */
const outputPath = (requested, besideInput, suffix, overwrite) => {
  const target = path.resolve(
    requested || path.join(path.dirname(besideInput), `${path.parse(besideInput).name}${suffix}`)
  );
  if (fs.existsSync(target) && !overwrite) {
    throw new Error(`${target} already exists. Pass overwrite: true to replace it, or choose another outputPath.`);
  }
  return target;
};

const AUDIO_EXTENSIONS = { 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/ogg': '.ogg', 'audio/flac': '.flac' };

const text = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

/** Every handler reports a failure as a tool error the model can read, rather than crashing the server. */
const tool = (handler) => async (args) => {
  try {
    return await handler(args);
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err?.message || String(err) }] };
  }
};

/* ---------------------------------------------------------------- tools -- */

const server = new McpServer({ name: 'dhvani', version: '0.1.0' });

const FREE = { readOnlyHint: true, openWorldHint: false };
// Calls a paid provider (ElevenLabs, Gemini or the gateway): each run spends credits.
const PAID = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

server.registerTool(
  'dhvani_status',
  {
    title: 'DHVANI status',
    description:
      'What the running DHVANI backend can do: its version, which keys are set (booleans only), ' +
      'the transcription and translation providers, whether ffmpeg is present, the upload limit and the ' +
      'language names the other tools accept. Free; call it first.',
    annotations: FREE,
  },
  tool(async () => {
    const health = await api('/health');
    return text({ backend: baseUrl, ...health });
  })
);

server.registerTool(
  'dhvani_settings',
  {
    title: 'DHVANI settings',
    description:
      'Where each key comes from (env, saved or none — never the key itself), where translation runs, ' +
      'and the endpoints and model names the backend is configured with. Free.',
    annotations: FREE,
  },
  tool(async () => text(await api('/settings')))
);

server.registerTool(
  'dhvani_credits',
  {
    title: 'Provider credits',
    description:
      'What each paid service has left: the ElevenLabs plan and characters used, the LLM gateway, and ' +
      "Cartesia's spend this month. A service that cannot say answers \"not shared\" instead of failing.",
    annotations: { ...FREE, openWorldHint: true },
  },
  tool(async () => {
    const settle = (promise) => promise.catch((err) => ({ error: err.message }));
    const [elevenLabs, gateway, cartesia] = await Promise.all([
      settle(api('/elevenlabs/user')),
      settle(api('/usage/gateway')),
      settle(api('/usage/cartesia')),
    ]);
    return text({ elevenLabs, gateway, cartesia });
  })
);

server.registerTool(
  'dhvani_voices',
  {
    title: 'List voices',
    description:
      'The voices the dub can use: ElevenLabs voices on the account, and Cartesia voices when Cartesia is set up. ' +
      'Returns id, name and labels; pass an id to dhvani_speak.',
    inputSchema: {
      provider: z.enum(['elevenlabs', 'cartesia']).default('elevenlabs'),
      search: z.string().optional().describe('Only voices whose name or labels contain this text.'),
    },
    annotations: { ...FREE, openWorldHint: true },
  },
  tool(async ({ provider, search }) => {
    const { voices = [] } = await api(provider === 'cartesia' ? '/cartesia/voices' : '/elevenlabs/voices');
    const needle = search?.toLowerCase();
    const list = voices
      .map((voice) => ({
        id: voice.voice_id || voice.id,
        name: voice.name,
        category: voice.category,
        language: voice.language,
        labels: voice.labels,
      }))
      .filter((voice) => !needle || JSON.stringify(voice).toLowerCase().includes(needle));
    return text({ count: list.length, voices: list });
  })
);

server.registerTool(
  'dhvani_transcribe',
  {
    title: 'Transcribe',
    description:
      'Transcribes a local audio or video file with word timestamps (ElevenLabs Scribe) and writes the ' +
      'original-language subtitles as an .srt beside it. Transcription only — it never translates. ' +
      'Spends ElevenLabs credits.',
    inputSchema: {
      filePath: z.string().describe('Absolute path of the audio or video file.'),
      sourceLanguage: z.string().optional().describe('Language name from dhvani_status; leave out to detect it.'),
      diarize: z.boolean().default(false).describe('Label who is speaking.'),
      tagAudioEvents: z.boolean().default(false).describe('Mark laughter, music and other sounds.'),
      outputPath: z.string().optional().describe('Where to write the .srt. Defaults to beside the file.'),
      overwrite: z.boolean().default(false),
    },
    annotations: PAID,
  },
  tool(async ({ filePath, sourceLanguage, diarize, tagAudioEvents, outputPath: requested, overwrite }) => {
    const target = outputPath(requested, filePath, '.srt', overwrite);
    const { blob, name } = await filePart(filePath);
    const form = new FormData();
    form.append('file', blob, name);
    form.append('sourceLanguage', sourceLanguage || '');
    form.append('diarize', String(diarize));
    form.append('tagAudioEvents', String(tagAudioEvents));

    const result = await api('/transcription', { method: 'POST', form });
    fs.writeFileSync(target, result.srt, 'utf8');
    return text({
      srtPath: target,
      detectedLanguage: result.detectedLanguage,
      languageProbability: result.languageProbability,
      durationSeconds: result.duration,
      cueCount: result.cues?.length ?? 0,
      transcript: result.transcript,
    });
  })
);

server.registerTool(
  'dhvani_translate_srt',
  {
    title: 'Translate subtitles',
    description:
      'Translates an .srt file into another language with the same translation the app uses. Only the text ' +
      'changes: every timestamp is kept exactly. Writes the result beside the input. Spends Gemini or gateway credits.',
    inputSchema: {
      srtPath: z.string().describe('Absolute path of the .srt to translate.'),
      targetLanguage: z.string().describe('Language name from dhvani_status, e.g. "Hindi".'),
      sourceLanguage: z.string().optional(),
      customPrompt: z.string().optional().describe('Extra instructions for the translator (glossary, tone).'),
      outputPath: z.string().optional().describe('Defaults to <name>.<language>.srt beside the input.'),
      overwrite: z.boolean().default(false),
    },
    annotations: PAID,
  },
  tool(async ({ srtPath, targetLanguage, sourceLanguage, customPrompt, outputPath: requested, overwrite }) => {
    const resolved = path.resolve(srtPath);
    if (!fs.existsSync(resolved)) throw new Error(`No file at ${resolved}.`);
    const suffix = `.${targetLanguage.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.srt`;
    const target = outputPath(requested, resolved, suffix, overwrite);

    const result = await api('/translation/srt', {
      method: 'POST',
      json: { srt: fs.readFileSync(resolved, 'utf8'), targetLanguage, sourceLanguage: sourceLanguage || '', customPrompt: customPrompt || '' },
    });
    fs.writeFileSync(target, result.srt, 'utf8');
    return text({
      srtPath: target,
      cueCount: result.cueCount,
      translationModel: result.translationModel,
      untranslatedCueIds: result.untranslatedCueIds,
    });
  })
);

server.registerTool(
  'dhvani_speak',
  {
    title: 'Speak a line',
    description:
      "Speaks text in an ElevenLabs voice through the app's own dub path and saves the audio file. The audio is " +
      'returned exactly as the voice made it. Spends ElevenLabs credits.',
    inputSchema: {
      text: z.string().min(1).describe('What the voice says.'),
      voiceId: z.string().describe('A voice id from dhvani_voices.'),
      outputPath: z
        .string()
        .describe('Where to save the audio, e.g. D:\\\\out\\\\line-12. The extension is set to match the audio the voice returns.'),
      modelId: z.string().optional().describe('ElevenLabs model; defaults to the one the backend is set to.'),
      language: z.string().optional().describe('Language code of the text, e.g. "hi".'),
      seed: z.number().int().optional().describe('Same seed and text give a repeatable take.'),
      overwrite: z.boolean().default(false),
    },
    annotations: PAID,
  },
  tool(async ({ text: line, voiceId, outputPath: requested, modelId, language, seed, overwrite }) => {
    const target = path.resolve(requested);
    if (fs.existsSync(target) && !overwrite) {
      throw new Error(`${target} already exists. Pass overwrite: true to replace it.`);
    }
    const { buffer, contentType } = await api('/elevenlabs/tts', {
      method: 'POST',
      json: { text: line, voiceId, modelId, language, seed },
      parse: 'buffer',
    });
    // The backend decides the format (WAV for a dub), so the file is named for what it holds.
    const extension = AUDIO_EXTENSIONS[contentType.split(';')[0].trim()];
    const named = extension ? path.join(path.dirname(target), `${path.parse(target).name}${extension}`) : target;
    // The audio is already paid for, so a name that is taken gets a number rather than losing the take.
    let saved = named;
    for (let n = 2; fs.existsSync(saved) && !overwrite; n += 1) {
      const { dir, name, ext } = path.parse(named);
      saved = path.join(dir, `${name}-${n}${ext}`);
    }
    fs.mkdirSync(path.dirname(saved), { recursive: true });
    fs.writeFileSync(saved, buffer);
    return text({ audioPath: saved, contentType, bytes: buffer.length });
  })
);

server.registerTool(
  'dhvani_dub_subtitles',
  {
    title: 'Time dub subtitles',
    description:
      "Times subtitles to a finished dub: forced alignment places the script's own words in the dub audio, " +
      'then each line becomes a cue. Writes an .srt beside the audio. Spends ElevenLabs credits.',
    inputSchema: {
      audioPath: z.string().describe('Absolute path of the dub audio.'),
      lines: z.array(z.string().min(1)).min(1).describe('The lines the dub says, in order.'),
      outputPath: z.string().optional(),
      overwrite: z.boolean().default(false),
    },
    annotations: PAID,
  },
  tool(async ({ audioPath, lines, outputPath: requested, overwrite }) => {
    const target = outputPath(requested, audioPath, '.dub.srt', overwrite);
    const { blob, name } = await filePart(audioPath);
    const form = new FormData();
    form.append('file', blob, name);
    form.append('cues', JSON.stringify(lines.map((line, index) => ({ id: `line-${index + 1}`, text: line }))));

    // Each line comes back as its words with their times; a line spans its first word to its last.
    const { cues = [], onsetSync } = await api('/subtitles/dub-timing', { method: 'POST', form });
    const timed = cues.map((cue, index) => ({
      text: lines[index],
      startTime: cue.words?.[0]?.start ?? 0,
      endTime: cue.words?.at(-1)?.end ?? 0,
    }));
    fs.writeFileSync(target, toSrt(timed), 'utf8');
    return text({ srtPath: target, cueCount: timed.length, onsetSync });
  })
);

server.registerTool(
  'dhvani_backend_log',
  {
    title: 'Backend log',
    description:
      "The end of the DHVANI backend log, for finding why something failed or froze. 'errors' keeps only " +
      "warnings and errors; 'hangs' keeps the [hang] stacks the app records when its window freezes.",
    inputSchema: {
      lines: z.number().int().min(1).max(2000).default(200),
      filter: z.enum(['all', 'errors', 'hangs']).default('all'),
      contains: z.string().optional().describe('Only lines containing this text.'),
    },
    annotations: FREE,
  },
  tool(async ({ lines, filter, contains }) => {
    const logPath = findLog();
    if (!logPath) {
      throw new Error('No backend.log was found. Set DHVANI_LOG to its path (a portable build keeps it in dhvani-data).');
    }
    const keep = {
      all: () => true,
      errors: (line) => /\b(warn|error|fail|exception)/i.test(line),
      hangs: (line) => line.includes('[hang]'),
    }[filter];
    const matched = readTail(logPath, 8 * 1024 * 1024)
      // The logger colours its levels for a terminal; the codes are noise here.
      .replace(/\x1b\[[0-9;]*m/g, '')
      .split(/\r?\n/)
      .filter((line) => line && keep(line) && (!contains || line.includes(contains)));
    return text(`${logPath} — last ${Math.min(lines, matched.length)} matching lines\n\n${matched.slice(-lines).join('\n')}`);
  })
);

/* -------------------------------------------------------------- helpers -- */

/** Where the backend log is: DHVANI_LOG, the installed app's AppData, then a dev run's logs folder. */
const findLog = () =>
  [
    process.env.DHVANI_LOG,
    process.env.APPDATA && path.join(process.env.APPDATA, 'DHVANI', 'backend.log'),
    path.join(os.homedir(), 'Library', 'Application Support', 'DHVANI', 'backend.log'),
    path.join(os.homedir(), '.config', 'DHVANI', 'backend.log'),
    path.join(REPO_DIR, 'logs', 'backend.log'),
  ].find((candidate) => candidate && fs.existsSync(candidate));

/** The last `maxBytes` of a file, so a log that has grown for months is not read whole. */
const readTail = (filePath, maxBytes) => {
  const { size } = fs.statSync(filePath);
  const length = Math.min(size, maxBytes);
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, size - length);
  } finally {
    fs.closeSync(fd);
  }
  return buffer.toString('utf8');
};

const srtTime = (seconds) => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

const toSrt = (cues) =>
  cues
    .map((cue, index) => `${index + 1}\n${srtTime(cue.startTime)} --> ${srtTime(cue.endTime)}\n${cue.text}\n`)
    .join('\n');

/* ---------------------------------------------------------------- start -- */

await server.connect(new StdioServerTransport());
console.error(`DHVANI MCP server ready; looking for the backend at ${CANDIDATE_URLS.join(' or ')}.`);

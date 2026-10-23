import JSZip from 'jszip';
import type { BatchJob } from '../types';
import type { JobSignoff } from './signoffService';

/**
 * A whole project in one file, to open again later or on another computer:
 * the source media, the transcript and translation, the dub, Sync's bank with
 * every take, the Edit timing edits, the stems, the undo history and the
 * sign-offs. Opening it makes a new project that carries on from where this
 * one was, without voicing anything again.
 *
 * The file is a zip: `project.json` holds the project with each file in it
 * swapped for a reference into `media/`, where the bytes are stored as they
 * are. A file the project holds in several places is stored once.
 */

export const PROJECT_FILE_KIND = 'dhvani-project';
export const PROJECT_FILE_VERSION = 1;
export const PROJECT_FILE_EXTENSION = '.dhvani';

const MANIFEST = 'project.json';
const MEDIA_KEY = '__dhvaniMedia';

interface MediaRef {
  [MEDIA_KEY]: string;
  type: string;
  /** Set for a File: its name and date come back with it. */
  name?: string;
  lastModified?: number;
}

interface ProjectManifest {
  kind: typeof PROJECT_FILE_KIND;
  version: number;
  exportedAt: number;
  job: unknown;
  signoffs: JobSignoff[];
}

/** What the page rebuilds from the files on load; stored as the IndexedDB save stores them. */
const NOT_KEPT: Partial<Record<keyof BatchJob, null>> = {
  audioBuffer: null,
  synthAudioBuffer: null,
  syncedAudioBuffer: null,
  synthesizedAudioUrl: null,
  syncedAudioUrl: null,
  srtUrl: null,
};

const EXTENSIONS: Record<string, string> = {
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/webm': '.webm',
  'audio/flac': '.flac',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'application/x-subrip': '.srt',
  'text/plain': '.txt',
};

const isPlainObject = (v: object) => {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

const safeName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(-120) || 'file';

/**
 * The project as plain data, every Blob and File in it swapped for a reference,
 * with the files to store under those references. Anything else that isn't
 * data (an AudioBuffer) is left out, as the IndexedDB save leaves it.
 */
export const packJob = (job: BatchJob): { data: unknown; media: Map<string, Blob> } => {
  const paths = new Map<Blob, string>();
  const media = new Map<string, Blob>();
  const walk = (value: unknown, key: string): unknown => {
    if (value === null || typeof value !== 'object') return typeof value === 'function' ? undefined : value;
    if (value instanceof Blob) {
      let path = paths.get(value);
      if (!path) {
        const fileName = value instanceof File ? value.name : '';
        const label = fileName ? safeName(fileName) : `${safeName(key)}${EXTENSIONS[value.type.split(';')[0]] ?? '.bin'}`;
        path = `media/${paths.size}-${label}`;
        paths.set(value, path);
        media.set(path, value);
      }
      const ref: MediaRef = { [MEDIA_KEY]: path, type: value.type };
      if (value instanceof File) {
        ref.name = value.name;
        ref.lastModified = value.lastModified;
      }
      return ref;
    }
    if (Array.isArray(value)) return value.map((item) => walk(item, key));
    if (!isPlainObject(value)) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const packed = walk(v, k);
      if (packed !== undefined) out[k] = packed;
    }
    return out;
  };
  return { data: walk({ ...job, ...NOT_KEPT }, 'project'), media };
};

/** The project back from `packJob`'s data, each reference given its file; one stored once comes back as one Blob. */
export const unpackJob = (data: unknown, fileAt: (path: string) => Blob | undefined): BatchJob => {
  const revived = new Map<string, Blob>();
  const walk = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(walk);
    const ref = value as Partial<MediaRef>;
    if (typeof ref[MEDIA_KEY] === 'string') {
      const path = ref[MEDIA_KEY];
      let blob = revived.get(path);
      if (!blob) {
        const bytes = fileAt(path);
        if (!bytes) throw new Error(`This project file is missing ${path.replace(/^media\/\d+-/, '')}.`);
        blob =
          typeof ref.name === 'string'
            ? new File([bytes], ref.name, { type: ref.type ?? '', lastModified: ref.lastModified })
            : new Blob([bytes], { type: ref.type ?? '' });
        revived.set(path, blob);
      }
      return blob;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v);
    return out;
  };
  return walk(data) as BatchJob;
};

/** The project and its sign-offs as one `.dhvani` file. */
export const exportProject = async (job: BatchJob, signoffs: JobSignoff[] = []): Promise<Blob> => {
  const { data, media } = packJob(job);
  const manifest: ProjectManifest = {
    kind: PROJECT_FILE_KIND,
    version: PROJECT_FILE_VERSION,
    exportedAt: Date.now(),
    job: data,
    signoffs,
  };
  const zip = new JSZip();
  zip.file(MANIFEST, JSON.stringify(manifest), { compression: 'DEFLATE' });
  // Media is stored as it is: it is already compressed, and a render stays bit-exact.
  for (const [path, blob] of media) zip.file(path, blob, { compression: 'STORE' });
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
};

const notAProject = () => new Error("This isn't a Dhvani project file.");

/**
 * The project in a `.dhvani` file, given `newId` so it never replaces a project
 * already here, with its sign-offs moved to that id.
 */
export const importProject = async (
  file: Blob,
  newId: string
): Promise<{ job: BatchJob; signoffs: JobSignoff[] }> => {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw notAProject();
  }
  const entry = zip.file(MANIFEST);
  if (!entry) throw notAProject();
  let manifest: Partial<ProjectManifest>;
  try {
    manifest = JSON.parse(await entry.async('string'));
  } catch {
    throw notAProject();
  }
  if (manifest?.kind !== PROJECT_FILE_KIND || !manifest.job || typeof manifest.job !== 'object') throw notAProject();
  if (typeof manifest.version !== 'number' || manifest.version > PROJECT_FILE_VERSION) {
    throw new Error('This project was saved by a newer Dhvani. Update Dhvani to open it.');
  }

  const files = new Map<string, Blob>();
  await Promise.all(
    Object.values(zip.files)
      .filter((f) => !f.dir && f.name.startsWith('media/'))
      .map(async (f) => files.set(f.name, await f.async('blob')))
  );
  const job = unpackJob(manifest.job, (path) => files.get(path));
  if (!(job.file instanceof Blob) || !Array.isArray(job.segments)) throw notAProject();

  const oldId = job.id;
  const signoffs = (Array.isArray(manifest.signoffs) ? manifest.signoffs : [])
    .filter((s) => s && s.jobId === oldId)
    .map((s) => ({ ...s, jobId: newId, key: `${newId}::${s.key.split('::').pop()}` }));
  return { job: { ...job, id: newId }, signoffs };
};

/** The name a project's file is saved under. */
export const projectFileName = (name: string) => `${name.trim() ? safeName(name.trim()) : 'Dhvani project'}${PROJECT_FILE_EXTENSION}`;

/*
 * The project as a JSON file, without its media: the transcript (its cut, ids,
 * times, word timings, speakers and language), any translation, and the
 * settings that steer Translation and Review. Opening it makes a new project
 * once the user picks the original audio again; nothing is transcribed or
 * translated again. Dub audio, takes and timing edits live only in `.dhvani`.
 */

export const PROJECT_JSON_VERSION = 1;
export const PROJECT_JSON_EXTENSION = '.dhvani.json';

/** What a JSON project keeps of a project: plain data the next steps read, and nothing tied to this computer. */
const JSON_KEPT = [
  'name',
  'createdAt',
  'updatedAt',
  'script',
  'language',
  'sourceLanguage',
  'detectedLanguage',
  'manualDuration',
  'expression',
  'pronunciations',
  'customPrompt',
  'promptPresetId',
  'segments',
  'analysisSensitivity',
  'analysisGate',
  'originalSrt',
  'translatedSrt',
  'targetSource',
  'transcriptCuts',
  'cast',
  'untranslatedCueIds',
] as const satisfies readonly (keyof BatchJob)[];

export type ProjectJsonData = Pick<BatchJob, (typeof JSON_KEPT)[number]>;

/** The audio the project was made on, to find it again. */
export interface SourceMedia {
  name: string;
  type: string;
  size: number;
  duration?: number;
}

interface ProjectJson {
  kind: typeof PROJECT_FILE_KIND;
  version: number;
  /** The media is not in the file: the user picks it when opening. */
  media: 'external';
  exportedAt: string;
  sourceMedia: SourceMedia;
  /** The id the project had, which its sign-offs are keyed on. */
  projectId: string;
  project: ProjectJsonData;
  signoffs: JobSignoff[];
}

/** The project and its sign-offs as a JSON file, without any media. */
export const exportProjectJson = (job: BatchJob, signoffs: JobSignoff[] = []): string => {
  const project: Record<string, unknown> = {};
  for (const key of JSON_KEPT) if (job[key] !== undefined) project[key] = job[key];
  // Not translated yet: the target lines are empty, never a copy of the source.
  if (job.targetSource === 'pending') {
    project.segments = job.segments.map(({ targetText: _alias, ...seg }) => ({ ...seg, textTarget: '' }));
  }
  const file: ProjectJson = {
    kind: PROJECT_FILE_KIND,
    version: PROJECT_JSON_VERSION,
    media: 'external',
    exportedAt: new Date().toISOString(),
    sourceMedia: {
      name: job.file?.name || job.audioMetadata?.fileName || '',
      type: job.file?.type || job.audioMetadata?.fileType || '',
      size: job.file?.size ?? 0,
      ...(job.audioMetadata?.duration || job.audioBuffer?.duration
        ? { duration: job.audioMetadata?.duration || job.audioBuffer?.duration }
        : {}),
    },
    projectId: job.id,
    project: project as ProjectJsonData,
    signoffs,
  };
  // Numbers are written as they are held, so every time keeps its full precision.
  return JSON.stringify(file, (_key, value) => (value instanceof Blob ? undefined : value), 2);
};

/** Whether a file is a JSON project rather than a `.dhvani` zip, by its name or its first byte. */
export const isProjectJson = async (file: Blob & { name?: string }): Promise<boolean> => {
  if (file.name && /\.json$/i.test(file.name)) return true;
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const first = [...head].find((b) => b !== 0xef && b !== 0xbb && b !== 0xbf && b > 0x20);
  return first === 0x7b; // "{"
};

const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/**
 * The project in a JSON project file, given `newId`, with its sign-offs moved
 * to that id. The source media is not in the file; `sourceMedia` says which
 * file to ask for.
 */
export const readProjectJson = (
  text: string,
  newId: string
): { project: ProjectJsonData; signoffs: JobSignoff[]; sourceMedia: SourceMedia } => {
  let data: Partial<ProjectJson> & { cues?: unknown };
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw notAProject();
  }
  if ((data?.kind as string) === 'dhvani-script' || (data && Array.isArray(data.cues))) {
    throw new Error(
      "This is a script file, not a project. Open the audio, transcribe it, then choose Use my translated script and paste or open this file there."
    );
  }
  if (data?.kind !== PROJECT_FILE_KIND || data.media !== 'external' || !data.project || typeof data.project !== 'object') throw notAProject();
  if (typeof data.version !== 'number' || data.version > PROJECT_JSON_VERSION) {
    throw new Error('This project was saved by a newer Dhvani. Update Dhvani to open it.');
  }
  const raw = data.project as Record<string, unknown>;
  if (!Array.isArray(raw.segments)) throw notAProject();

  const project: Record<string, unknown> = {};
  for (const key of JSON_KEPT) if (raw[key] !== undefined) project[key] = raw[key];
  // A time JSON could not hold (NaN is written as null) comes back as missing, to be flagged, never as 0.
  const revive = (list: unknown) =>
    Array.isArray(list)
      ? list
          .filter((s) => s && typeof s === 'object' && (s as { id?: unknown }).id !== undefined)
          .map((s: any) => ({ ...s, startTime: finite(s.startTime), endTime: finite(s.endTime), duration: finite(s.duration) }))
      : list;
  project.segments = revive(raw.segments);
  if (raw.transcriptCuts) project.transcriptCuts = revive(raw.transcriptCuts);

  const oldId = typeof data.projectId === 'string' ? data.projectId : '';
  const signoffs = (Array.isArray(data.signoffs) ? data.signoffs : [])
    .filter((s) => s && oldId && s.jobId === oldId && typeof s.key === 'string')
    .map((s) => ({ ...s, jobId: newId, key: `${newId}::${s.key.split('::').pop()}` }));

  const media = (data.sourceMedia || {}) as Partial<SourceMedia>;
  return {
    project: project as ProjectJsonData,
    signoffs,
    sourceMedia: {
      name: typeof media.name === 'string' ? media.name : '',
      type: typeof media.type === 'string' ? media.type : '',
      size: typeof media.size === 'number' ? media.size : 0,
      ...(typeof media.duration === 'number' && media.duration > 0 ? { duration: media.duration } : {}),
    },
  };
};

/** The name a JSON project is saved under. */
export const projectJsonFileName = (name: string) => `${name.trim() ? safeName(name.trim()) : 'Dhvani project'}${PROJECT_JSON_EXTENSION}`;

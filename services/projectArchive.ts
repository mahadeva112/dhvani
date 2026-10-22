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

import { apiGet, apiJson, apiPutBlob } from './apiClient.ts';
import type { SyncReport, SyncUnitReport } from './syncService';

/**
 * Export for DaVinci Resolve: the dub as files Resolve's free version
 * imports with no scripts (server/routes/davinci.js writes them). The
 * timeline is FCPXML: each dub line a clip in place, one track per speaker,
 * problem lines marked. The audio is the synced dub's own files, samples
 * untouched.
 */

export const DAVINCI_FPS = ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] as const;
export type DavinciFps = (typeof DAVINCI_FPS)[number];

const BASE: Record<DavinciFps, number> = { '23.976': 24, '24': 24, '25': 25, '29.97': 30, '30': 30, '50': 50, '59.94': 60, '60': 60 };

/** True for a non-drop timecode HH:MM:SS:FF that exists at this rate. */
export const isTimecode = (tc: string, fps: DavinciFps): boolean => {
  const m = /^(\d{1,2})[:.](\d{2})[:.](\d{2})[:;.](\d{2,3})$/.exec(tc.trim());
  if (!m) return false;
  const [h, min, s, f] = m.slice(1).map(Number);
  return h <= 23 && min <= 59 && s <= 59 && f < BASE[fps];
};

/** What a line's marker says in Resolve; null for a line that needs no look (the Dub page's own "to check" rule). */
export const lineNote = (unit: SyncUnitReport): string | null => {
  const n = unit.index + 1;
  if (unit.silent) return `Line ${n}: came back silent`;
  if (unit.exceeded) return `Line ${n}: too long by ${(unit.exceededBy || 0).toFixed(1)} s`;
  if (unit.short) return `Line ${n}: ends ${(unit.shortBy || 0).toFixed(1)} s before the speaker`;
  if (!unit.inSync) return unit.offset !== null && Number.isFinite(unit.offset) ? `Line ${n}: ${unit.offset > 0 ? 'late' : 'early'} by ${Math.abs(unit.offset).toFixed(1)} s` : `Line ${n}: off its timing`;
  return null;
};

/** A clip's name in Resolve: the line's number and its first words. */
export const clipName = (unit: SyncUnitReport): string => {
  const words = (unit.text || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  const short = words.length > 36 ? `${words.slice(0, 35).trimEnd()}…` : words;
  return short ? `${unit.index + 1} ${short}` : `Line ${unit.index + 1}`;
};

export interface DavinciLine {
  start: number;
  end: number;
  name: string;
  note?: string;
}

export interface DavinciTrack {
  /** Shown in the window; the speaker's name, or "Dub". */
  name: string;
  /** The file it reads, in the export folder. */
  fileName: string;
  blob: Blob;
  color?: string;
  lines: DavinciLine[];
}

/** File names a speaker's name is safe in. */
const part = (text: string) => text.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'speaker';

const extensionOf = (blob: Blob) => (/wav|wave/i.test(blob.type) ? 'wav' : 'mp3');

/**
 * The tracks of the timeline. One per speaker reads each speaker's stem
 * (same length as the dub, so every file starts at the timeline's start);
 * it is possible only when every placed line's speaker has a stem. Otherwise,
 * or when asked, one track reads the whole dub.
 */
export const davinciTracks = ({
  report,
  dub,
  stems,
  fileStem,
  perSpeaker,
  colorOf = () => undefined,
}: {
  report: Pick<SyncReport, 'units'>;
  dub: Blob;
  stems?: { speaker: string; blob: Blob }[] | null;
  fileStem: string;
  perSpeaker: boolean;
  colorOf?: (speaker: string) => string | undefined;
}): { tracks: DavinciTrack[]; perSpeakerPossible: boolean } => {
  const placed = report.units.filter((u) => u.placedStart !== null && u.placedEnd !== null);
  const toLine = (u: SyncUnitReport): DavinciLine => {
    const note = lineNote(u);
    return { start: u.placedStart as number, end: u.placedEnd as number, name: clipName(u), ...(note ? { note } : {}) };
  };
  const bySpeaker = new Map((stems || []).map((s) => [s.speaker, s]));
  const perSpeakerPossible = bySpeaker.size > 1 && placed.length > 0 && placed.every((u) => u.speaker && bySpeaker.has(u.speaker));
  if (perSpeaker && perSpeakerPossible) {
    const tracks = (stems || [])
      .map((stem) => ({
        name: stem.speaker,
        fileName: `${fileStem} - ${part(stem.speaker)}.${extensionOf(stem.blob)}`,
        blob: stem.blob,
        color: colorOf(stem.speaker),
        lines: placed.filter((u) => u.speaker === stem.speaker).map(toLine),
      }))
      .filter((t) => t.lines.length > 0);
    return { tracks, perSpeakerPossible };
  }
  return { tracks: [{ name: 'Dub', fileName: `${fileStem} - dub.${extensionOf(dub)}`, blob: dub, lines: placed.map(toLine) }], perSpeakerPossible };
};

/** What the window remembers between exports: the Resolve timeline's settings and the user's picks. */
export interface DavinciPrefs {
  fps: DavinciFps;
  timecode: string;
  perSpeaker: boolean;
  timeline: boolean;
  fullDub: boolean;
  subtitles: boolean;
  markers: boolean;
}

const PREFS_KEY = 'dhvani_davinci_export';
export const DEFAULT_DAVINCI_PREFS: DavinciPrefs = { fps: '25', timecode: '01:00:00:00', perSpeaker: true, timeline: true, fullDub: true, subtitles: true, markers: true };

export const loadDavinciPrefs = (): DavinciPrefs => {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return DEFAULT_DAVINCI_PREFS;
    const prefs = { ...DEFAULT_DAVINCI_PREFS, ...saved };
    if (!DAVINCI_FPS.includes(prefs.fps)) prefs.fps = DEFAULT_DAVINCI_PREFS.fps;
    return prefs;
  } catch {
    return DEFAULT_DAVINCI_PREFS;
  }
};

export const saveDavinciPrefs = (prefs: DavinciPrefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
};

/** Where the export goes unless the user picks another folder. */
export const defaultDavinciFolder = (name: string) => apiGet<{ folder: string }>(`/davinci/folder?name=${encodeURIComponent(name)}`).then((r) => r.folder);

export const revealDavinciFolder = (folder: string) => apiJson('/davinci/reveal', { body: { folder } });

export interface DavinciExportResult {
  folder: string;
  timeline: string | null;
  files: string[];
}

/**
 * Writes the export: each audio file (a WAV gets its start timecode in a
 * `bext` chunk), then the FCPXML and the SRT. `onStep` says what is being
 * written, for the window's progress line.
 */
export const exportForDavinci = async ({
  folder,
  title,
  fileStem,
  fps,
  timecode,
  tracks,
  timeline,
  markers,
  audio,
  srt,
  onStep = () => {},
  signal,
}: {
  folder: string;
  title: string;
  fileStem: string;
  fps: DavinciFps;
  timecode: string;
  /** The timeline's tracks; their files are written whether or not `audio` lists them. */
  tracks: DavinciTrack[];
  timeline: boolean;
  markers: boolean;
  /** More audio files to write beside the timeline's own (the whole dub). */
  audio: { fileName: string; blob: Blob }[];
  srt: { fileName: string; text: string } | null;
  onStep?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<DavinciExportResult> => {
  const files = new Map<string, Blob>();
  if (timeline) for (const t of tracks) files.set(t.fileName, t.blob);
  for (const a of audio) files.set(a.fileName, a.blob);
  const written: string[] = [];
  for (const [fileName, blob] of files) {
    onStep(`Writing ${fileName}…`);
    const query = new URLSearchParams({ folder, name: fileName, fps, tc: timecode });
    const res = await apiPutBlob<{ path: string }>(`/davinci/file?${query}`, blob.type ? blob : new Blob([blob], { type: 'application/octet-stream' }), { signal });
    written.push(res.path);
  }
  if (!timeline && !srt) return { folder, timeline: null, files: written };
  onStep(timeline ? 'Writing the timeline…' : 'Writing the subtitles…');
  const res = await apiJson<{ folder: string; timeline: string | null; written: string[] }>('/davinci/timeline', {
    signal,
    body: {
      folder,
      title,
      fileName: fileStem,
      fps,
      startTimecode: timecode,
      tracks: timeline
        ? tracks.map((t) => ({
            name: t.name,
            file: t.fileName,
            lines: t.lines.map((l) => (markers ? l : { start: l.start, end: l.end, name: l.name })),
          }))
        : [],
      srt: srt && { name: srt.fileName, text: srt.text },
    },
  });
  return { folder: res.folder, timeline: res.timeline, files: [...written, ...res.written] };
};

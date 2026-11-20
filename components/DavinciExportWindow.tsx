import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, AudioWaveform, Captions, Check, Clipboard, ExternalLink, FileOutput, Film, Flag, FolderOpen, ListVideo, Loader2, Lock, Repeat, X } from 'lucide-react';
import { CenteredPanel } from './CenteredPanel';
import type { SyncReport } from '../services/syncService';
import {
  DAVINCI_FPS,
  type DavinciExportResult,
  type DavinciFps,
  type DavinciPrefs,
  type ResolveStatus,
  davinciTracks,
  defaultDavinciFolder,
  exportForDavinci,
  freshDavinciFolder,
  isTimecode,
  isVideoFile,
  lineNote,
  loadDavinciPrefs,
  openInResolveStudio,
  openResolve,
  originalFileName,
  resolveStatus,
  revealDavinciFolder,
  saveDavinciPrefs,
} from '../services/davinciExport';

/** The desktop shell's folder picker; absent in a browser, where the path is typed. */
const pickFolder = (window as unknown as { dhvaniFiles?: { pickFolder: (start?: string) => Promise<string | null> } }).dhvaniFiles?.pickFolder;

/** Puts text on the clipboard; false when the browser refuses. */
const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
};

const sectionLabel = 'text-[10.5px] uppercase tracking-wider font-semibold text-slate-500';
const LANE_COLORS = ['#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa', '#22d3ee'];

/**
 * Export for DaVinci Resolve: the synced dub as a folder Resolve's free
 * version imports with no scripts. An FCPXML timeline (each line a clip in
 * place, a track per speaker, problem lines marked), the dub as a WAV that
 * says its start timecode, and the subtitles as SRT.
 */
export const DavinciExportWindow: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  fileStem: string;
  report: SyncReport;
  dub: Blob | null;
  stems?: { speaker: string; blob: Blob }[] | null;
  colorOf?: (speaker: string) => string | undefined;
  /** The subtitles timed to the synced dub, built when the export runs; null when there are none. */
  buildSrt: () => string | null;
  subtitleLanguage: string;
  /** Lines changed since the last Sync: the export is the dub as synced, without them. */
  pendingCount?: number;
  /** The project's original media: its picture goes on V1, its sound on the guide track. */
  source?: File | null;
  /** The review video's name, when the original has no picture but one was added for review. */
  reviewVideoName?: string | null;
  /** Reads the review video when the export runs. */
  loadReviewVideo?: () => Promise<File | null>;
  onError: (err: unknown) => void;
}> = ({ open, onClose, title, fileStem, report, dub, stems, colorOf, buildSrt, subtitleLanguage, pendingCount = 0, source = null, reviewVideoName = null, loadReviewVideo, onError }) => {
  const [prefs, setPrefs] = useState<DavinciPrefs>(loadDavinciPrefs);
  const set = (patch: Partial<DavinciPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      saveDavinciPrefs(next);
      return next;
    });
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<DavinciExportResult | null>(null);
  /** What happened after the export: the path copied, Resolve started. */
  const [after, setAfter] = useState<string | null>(null);
  const [resolve, setResolve] = useState<ResolveStatus | null>(null);
  const abort = useRef<AbortController | null>(null);
  const checkResolve = () =>
    resolveStatus()
      .then(setResolve)
      .catch(() => setResolve(null));

  // A fresh window each time it opens: the default folder for this project, nothing left from before.
  useEffect(() => {
    if (!open) return;
    setDone(null);
    setAfter(null);
    checkResolve();
    let live = true;
    defaultDavinciFolder(fileStem)
      .then((f) => live && setFolder((now) => now || f))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, fileStem]);
  useEffect(() => () => abort.current?.abort(), []);

  const { tracks, perSpeakerPossible } = useMemo(
    () =>
      dub
        ? davinciTracks({ report, dub, stems, fileStem, perSpeaker: prefs.perSpeaker, colorOf })
        : { tracks: [], perSpeakerPossible: false },
    [report, dub, stems, fileStem, prefs.perSpeaker, colorOf]
  );
  const problemCount = useMemo(() => report.units.filter((u) => u.placedStart !== null && lineNote(u)).length, [report]);
  const dubFileName = dub ? `${fileStem} - dub.${/wav|wave/i.test(dub.type) ? 'wav' : 'mp3'}` : '';
  const srtFileName = `${fileStem} - ${subtitleLanguage || 'subtitles'}.srt`;
  const timelineName = `${fileStem}.fcpxml`;
  /** One track reads the whole dub, so the whole dub goes in with the timeline. */
  const dubForTimeline = prefs.timeline && tracks.some((t) => t.blob === dub);
  const fullDub = prefs.fullDub || dubForTimeline;
  const tcOk = isTimecode(prefs.timecode, prefs.fps);
  // The original: its picture from itself, or from the review video when it has none.
  const sourceIsVideo = isVideoFile(source);
  const videoName = sourceIsVideo ? source?.name || null : reviewVideoName;
  const videoOn = prefs.timeline && prefs.video && Boolean(videoName);
  const guideOn = prefs.timeline && prefs.guide && Boolean(source);
  const videoFileName = videoOn ? (sourceIsVideo && source ? originalFileName(fileStem, source, 'original') : originalFileName(fileStem, { name: reviewVideoName || '' , type: 'video/mp4' }, 'video')) : null;
  const guideFileName = guideOn && source ? originalFileName(fileStem, source, 'original') : null;
  const fpsAuto = videoOn && prefs.fpsAuto;
  const canOpenResolve = Boolean(resolve?.installed);
  /** Studio, or a Resolve that can't be told apart (macOS): the one-click open is offered, as beta. */
  const studioOffered = Boolean(resolve?.installed && resolve.studio !== false);
  const files = [
    ...(videoFileName ? [videoFileName] : []),
    ...(guideFileName ? [guideFileName] : []),
    ...(prefs.timeline ? [timelineName, ...tracks.map((t) => t.fileName)] : []),
    ...(fullDub ? [dubFileName] : []),
    ...(prefs.subtitles ? [srtFileName] : []),
  ].filter((f, i, all) => f && all.indexOf(f) === i);
  const blocked = !dub
    ? 'The synced dub is not loaded yet.'
    : !folder.trim()
      ? 'Pick a folder.'
      : !tcOk
        ? `Start timecode must be HH:MM:SS:FF at ${prefs.fps} fps.`
        : files.length === 0
          ? 'Pick at least one file.'
          : null;

  const run = async (inStudio = false) => {
    if (blocked || !dub) return;
    const srtText = prefs.subtitles ? buildSrt() : null;
    abort.current = new AbortController();
    setBusy('Starting…');
    setAfter(null);
    try {
      const videoBlob = videoOn ? (sourceIsVideo ? source : await (loadReviewVideo?.() ?? Promise.resolve(null))) : null;
      if (videoOn && !videoBlob) throw new Error('The review video could not be read. Add it again on the Dub page, or export without the video.');
      // Off: this export gets a folder of its own, and the files of the one before stay as they were.
      const target = prefs.sameFiles ? folder.trim() : await freshDavinciFolder(folder.trim());
      if (target !== folder.trim()) setFolder(target);
      const result = await exportForDavinci({
        folder: target,
        title: `${title} dub`,
        fileStem,
        fps: prefs.fps,
        fpsAuto,
        video: videoBlob && videoFileName ? { fileName: videoFileName, blob: videoBlob } : null,
        guide: guideOn && source && guideFileName ? { fileName: guideFileName, blob: source } : null,
        timecode: prefs.timecode.trim(),
        tracks,
        timeline: prefs.timeline,
        markers: prefs.markers,
        audio: fullDub ? [{ fileName: dubFileName, blob: dub }] : [],
        srt: srtText ? { fileName: srtFileName, text: srtText } : null,
        onStep: setBusy,
        signal: abort.current.signal,
      });
      setDone(result);
      if (result.fpsFromVideo && result.fps !== prefs.fps) set({ fps: result.fps });
      const notes: string[] = [];
      if (inStudio && result.timeline) {
        setBusy('Opening in Resolve Studio… (it may take a minute while Resolve starts)');
        try {
          const opened = await openInResolveStudio({
            timeline: result.timeline,
            srt: result.files.find((f) => /\.srt$/i.test(f)) || null,
            name: `${title} dub`,
            fps: result.fps,
          });
          notes.push(
            `Opened in Resolve as "${opened.project}"`,
            opened.subtitles === 'timeline' ? 'subtitles on ST1' : opened.subtitles === 'pool' ? 'subtitles in the Media Pool: drag them to the start' : opened.subtitles === 'failed' ? 'subtitles not imported' : ''
          );
        } catch (err) {
          notes.push('Not opened in Resolve');
          onError(err);
        }
        setAfter(notes.filter(Boolean).join(' · ') || null);
        return;
      }
      if (prefs.copyPath && result.timeline) {
        const copied = await copyText(result.timeline);
        notes.push(copied ? 'Timeline path copied' : 'Could not copy the path');
      }
      if (prefs.openResolve && canOpenResolve) {
        const opened = await openResolve().catch(() => null);
        notes.push(!opened ? 'Resolve did not start' : opened.running ? 'Resolve is already open' : 'Resolve is starting');
      }
      setAfter(notes.join(' · ') || null);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') onError(err);
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  const close = () => {
    abort.current?.abort();
    onClose();
  };

  // The lanes as Resolve shows them after the import: the dub tracks, the markers above, the subtitles below.
  const duration = Math.max(report.duration || 0, 0.001);
  const pct = (s: number) => `${Math.max(0, Math.min(100, (s / duration) * 100))}%`;
  const laneRow = (label: string, body: React.ReactNode, strong = false, h = 'h-5') => (
    <div className="flex items-center gap-2">
      <span className={`w-28 shrink-0 truncate text-[11px] ${strong ? 'text-slate-200' : 'text-slate-500'}`}>{label}</span>
      <div className={`relative flex-1 ${h} rounded bg-slate-800/70 overflow-hidden`}>{body}</div>
    </div>
  );
  const markers = prefs.timeline && prefs.markers ? report.units.filter((u) => u.placedStart !== null && lineNote(u)) : [];

  const row = (on: boolean, onToggle: (() => void) | null, icon: React.ReactNode, name: string, note: string, kind: string) => (
    <label className={`flex items-center gap-3 py-2.5 border-t border-edge first:border-t-0 ${onToggle ? 'cursor-default' : 'opacity-80'}`}>
      <input type="checkbox" checked={on} disabled={!onToggle} onChange={() => onToggle?.()} aria-label={name} className="accent-indigo-500 w-4 h-4" />
      <span className="text-slate-400 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-slate-100">{name}</span>
        <span className="block text-[11.5px] text-slate-400 leading-snug">{note}</span>
      </span>
      <span className="shrink-0 text-[11px] font-mono text-slate-500">{kind}</span>
    </label>
  );

  return (
    <CenteredPanel open={open} onClose={close} label="Export for DaVinci Resolve" className="max-w-[38rem]">
      <header className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-edge">
        <span className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 bg-indigo-500/15 text-indigo-300">
          <FileOutput className="w-[18px] h-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-slate-100">Export for DaVinci Resolve</h2>
          <p className="text-[12px] text-slate-400">Works in the free version. No scripts needed.</p>
        </span>
        <button type="button" onClick={close} aria-label="Close" className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-default">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="px-5 py-4 flex flex-col gap-4">
        {pendingCount > 0 && (
          <p className="text-[12px] leading-snug text-amber-300">
            {pendingCount === 1 ? '1 line changed' : `${pendingCount} lines changed`} since the last Sync. The export is the dub as synced; Sync again first to take the change{pendingCount === 1 ? '' : 's'} in.
          </p>
        )}
        <div className="flex flex-col">
          <span className={`${sectionLabel} mb-1`}>What goes in the folder</span>
          {row(prefs.timeline, () => set({ timeline: !prefs.timeline }), <ListVideo className="w-4 h-4" />, 'Timeline', 'Each dub line a clip, in place. Import it with File › Import › Timeline.', 'FCPXML')}
          {videoName &&
            row(
              videoOn,
              prefs.timeline ? () => set({ video: !prefs.video }) : null,
              <Film className="w-4 h-4" />,
              'Original video on V1',
              `${videoName}${sourceIsVideo ? '' : ' (the review video)'}: copied as it is, not re-encoded. Not copied again while it's unchanged.`,
              'V1'
            )}
          {source &&
            row(
              guideOn,
              prefs.timeline ? () => set({ guide: !prefs.guide }) : null,
              <AudioLines className="w-4 h-4" />,
              'Original audio as a guide track',
              'Its own track, turned off in Resolve. Turn it on to compare with the dub.',
              'guide'
            )}
          {row(
            fullDub,
            dubForTimeline ? null : () => set({ fullDub: !prefs.fullDub }),
            <AudioWaveform className="w-4 h-4" />,
            'Full dub',
            dubForTimeline ? 'The timeline reads this file, so it goes in with it.' : 'One file with its start timecode inside; every sample as the dub has it.',
            dub && /wav|wave/i.test(dub.type) ? 'WAV' : 'MP3'
          )}
          {row(prefs.subtitles, () => set({ subtitles: !prefs.subtitles }), <Captions className="w-4 h-4" />, 'Subtitles', `${subtitleLanguage || 'Dub'}, timed to the dub, as an SRT file beside the timeline (Resolve takes subtitles only by their own import). Your edited subtitles if you edited them.`, 'SRT')}
          {row(
            prefs.markers && prefs.timeline,
            prefs.timeline ? () => set({ markers: !prefs.markers }) : null,
            <Flag className="w-4 h-4" />,
            'Problem-line markers',
            problemCount === 0 ? 'No line is flagged right now.' : `${problemCount === 1 ? '1 line' : `${problemCount} lines`} still flagged on the Dub page.`,
            'in timeline'
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>Start timecode</span>
            <input
              value={prefs.timecode}
              onChange={(e) => set({ timecode: e.target.value })}
              spellCheck={false}
              className={`h-9 px-2.5 rounded-lg bg-slate-950 border font-mono text-[13px] text-slate-100 focus:outline-none ${tcOk ? 'border-edge focus:border-indigo-500' : 'border-rose-500/70'}`}
            />
            <span className="text-[11px] text-slate-500">Resolve's default is 01:00:00:00</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>Frame rate</span>
            <select
              value={fpsAuto ? 'auto' : prefs.fps}
              onChange={(e) => (e.target.value === 'auto' ? set({ fpsAuto: true }) : set({ fps: e.target.value as DavinciFps, fpsAuto: false }))}
              className="h-9 px-2 rounded-lg bg-slate-950 border border-edge text-[13px] text-slate-100 focus:outline-none focus:border-indigo-500 cursor-default"
            >
              {videoOn && (
                <option value="auto" className="bg-slate-900">
                  From the video
                </option>
              )}
              {DAVINCI_FPS.map((f) => (
                <option key={f} value={f} className="bg-slate-900">
                  {f} fps
                </option>
              ))}
            </select>
            <span className="text-[11px] text-slate-500">
              {done?.fpsFromVideo ? `${done.fps} fps, read from the video` : fpsAuto ? 'Read when exporting' : 'Match your Resolve timeline'}
            </span>
          </label>
          <div className="flex flex-col gap-1">
            <span className={sectionLabel}>Tracks</span>
            <div className="h-9 inline-flex rounded-lg border border-slate-700 overflow-hidden text-[12px]">
              {(
                [
                  [true, 'One per speaker'],
                  [false, 'One track'],
                ] as const
              ).map(([value, label]) => {
                const on = (value ? perSpeakerPossible && prefs.perSpeaker : !(perSpeakerPossible && prefs.perSpeaker));
                return (
                  <button
                    key={label}
                    type="button"
                    disabled={value && !perSpeakerPossible}
                    onClick={() => set({ perSpeaker: value })}
                    title={value && !perSpeakerPossible ? 'Needs two or more speakers, each with their own dub track' : undefined}
                    className={`flex-1 px-2 whitespace-nowrap cursor-default disabled:opacity-40 ${on ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={sectionLabel}>How it lands in Resolve</span>
          <div className="rounded-xl border border-edge bg-slate-950/50 p-2.5 flex flex-col gap-1.5">
            {laneRow(
              'Markers',
              markers.map((u) => (
                <Flag key={u.key} className="absolute top-0.5 w-3 h-3 text-amber-400 -translate-x-1/2" style={{ left: pct(u.placedStart as number) }} />
              )),
              false,
              'h-4 !bg-transparent'
            )}
            {videoOn &&
              laneRow('V1 Video', <span className="absolute inset-y-0.5 left-0 right-0 rounded-[3px] bg-violet-400/60" />, true)}
            {prefs.timeline ? (
              tracks.map((t, i) =>
                laneRow(
                  `A${i + 1} ${t.name}`,
                  t.lines.map((l, j) => (
                    <span
                      key={j}
                      className="absolute top-1 bottom-1 rounded-[3px]"
                      style={{ left: pct(l.start), width: `max(2px, calc(${pct(l.end)} - ${pct(l.start)}))`, backgroundColor: t.color || LANE_COLORS[i % LANE_COLORS.length] }}
                    />
                  )),
                  true
                )
              )
            ) : (
              <p className="pl-[7.5rem] text-[11px] text-slate-500 py-1">Timeline off: drop the dub WAV in with "Insert Using Timecode".</p>
            )}
            {guideOn &&
              laneRow(`A${tracks.length + 1} Original (off)`, <span className="absolute inset-y-1 left-0 right-0 rounded-[3px] bg-slate-500/40" />)}
            {prefs.subtitles &&
              laneRow(
                'ST1 Subtitles',
                tracks
                  .flatMap((t) => t.lines)
                  .map((l, j) => (
                    <span key={j} className="absolute top-[3px] bottom-[3px] rounded-[2px] bg-slate-500/70" style={{ left: pct(l.start), width: `max(2px, calc(${pct(l.end)} - ${pct(l.start)}))` }} />
                  )),
                false,
                'h-3.5'
              )}
          </div>
        </div>

        <div className="flex flex-col">
          <span className={`${sectionLabel} mb-1`}>After export</span>
          {canOpenResolve &&
            row(
              prefs.openResolve,
              () => set({ openResolve: !prefs.openResolve }),
              <ExternalLink className="w-4 h-4" />,
              'Open DaVinci Resolve',
              resolve?.running ? 'Resolve is open already.' : `Found on this computer${resolve?.studio === true ? ' (Studio)' : resolve?.studio === false ? ' (free version)' : ''}.`,
              ''
            )}
          {prefs.timeline && row(prefs.copyPath, () => set({ copyPath: !prefs.copyPath }), <Clipboard className="w-4 h-4" />, "Copy the timeline's path", 'Paste it in File › Import › Timeline.', '')}
          {row(
            prefs.sameFiles,
            () => set({ sameFiles: !prefs.sameFiles }),
            <Repeat className="w-4 h-4" />,
            'Export again writes over the same files',
            prefs.sameFiles ? 'Same names, so Resolve keeps its links.' : 'Each export gets a new folder beside this one.',
            ''
          )}
          <div className={`mt-2 flex items-center gap-3 rounded-lg border px-3 py-2 ${studioOffered ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-dashed border-slate-700'}`}>
            {studioOffered ? <ExternalLink className="w-4 h-4 text-indigo-300 shrink-0" /> : <Lock className="w-4 h-4 text-slate-500 shrink-0" />}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[12.5px] text-slate-300">
                Open in DaVinci, one click
                <span className="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-300">Beta</span>
              </span>
              <span className="block text-[11.5px] text-slate-500 leading-snug">
                {!resolve
                  ? 'Resolve Studio only: it makes the project, imports the timeline and opens the Edit page.'
                  : !resolve.installed
                    ? 'DaVinci Resolve is not installed in its usual place on this computer.'
                    : studioOffered
                      ? 'Resolve Studio makes a new project at this frame rate, imports the timeline and subtitles, and opens the Edit page. Save your open Resolve project first. Needs Preferences › System › General › External scripting using: Local.'
                      : 'Resolve Studio only. This computer has the free version, which takes no outside commands.'}
              </span>
            </span>
            {studioOffered ? (
              <button
                type="button"
                onClick={() => run(true)}
                disabled={Boolean(blocked) || Boolean(busy) || !prefs.timeline}
                title={!prefs.timeline ? 'Needs the timeline' : undefined}
                className="h-8 px-2.5 rounded-lg border border-indigo-500/50 text-[12px] text-indigo-200 hover:bg-indigo-500/10 cursor-default shrink-0 whitespace-nowrap disabled:opacity-40"
              >
                Export and open in Studio
              </button>
            ) : (
              <button type="button" onClick={checkResolve} className="h-8 px-2.5 rounded-lg border border-slate-700 text-[12px] text-slate-300 hover:bg-slate-800 cursor-default shrink-0">
                Check again
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className={sectionLabel}>Folder</span>
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-slate-500 shrink-0" />
            <input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              spellCheck={false}
              aria-label="Export folder"
              className="flex-1 min-w-0 h-9 px-2.5 rounded-lg bg-slate-950 border border-edge font-mono text-[12px] text-slate-300 focus:outline-none focus:border-indigo-500"
            />
            {pickFolder && (
              <button
                type="button"
                onClick={() => pickFolder(folder).then((f) => f && setFolder(f)).catch(() => {})}
                className="h-9 px-3 rounded-lg border border-slate-700 text-[12px] text-slate-200 hover:bg-slate-800 cursor-default"
              >
                Change
              </button>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-slate-800/50 px-3.5 py-2.5 text-[12px] leading-relaxed text-slate-300">
          <div className="font-semibold text-slate-200 mb-0.5">Then in Resolve</div>
          {prefs.timeline ? (
            <>
              <div>
                1. File › Import › Timeline, pick <span className="font-mono text-slate-200">{timelineName}</span>
              </div>
              <div>2. Keep "Automatically import source clips into media pool" on</div>
              <div>{videoOn ? '3. Your video is already on V1, under the dub' : '3. Put your video on V1 at the start, or copy the dub tracks into your edit'}</div>
              {prefs.subtitles && (
                <div>
                  4. Subtitles: File › Import › Subtitle, pick <span className="font-mono text-slate-200">{srtFileName}</span>, then drag it from the Media Pool to the timeline's very start ({prefs.timecode}). Resolve makes a subtitle track for it.
                </div>
              )}
            </>
          ) : (
            <>
              <div>1. Import the files into the Media Pool</div>
              <div>2. Right-click the dub › Insert Selected Clips to Timeline Using Timecode</div>
              {prefs.subtitles && (
                <div>
                  3. Subtitles: File › Import › Subtitle, pick <span className="font-mono text-slate-200">{srtFileName}</span>, then drag it from the Media Pool to the timeline's very start. Resolve makes a subtitle track for it.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <footer className="flex items-center gap-2 px-5 py-3 border-t border-edge">
        <span className={`flex-1 min-w-0 truncate text-[12px] ${blocked && !busy ? 'text-amber-300' : 'text-slate-400'}`}>
          {busy
            ? busy
            : done
              ? [
                  `Exported ${done.files.length} ${done.files.length === 1 ? 'file' : 'files'}${done.kept.length ? `, ${done.kept.length} unchanged` : ''}`,
                  done.fpsNote,
                  ...done.notes,
                  after,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : blocked || `${files.length} ${files.length === 1 ? 'file' : 'files'}`}
        </span>
        {done && !busy && (
          <button type="button" onClick={() => revealDavinciFolder(done.folder).catch(onError)} className="h-9 px-3 flex items-center gap-1.5 rounded-lg border border-slate-700 text-[12.5px] text-slate-200 hover:bg-slate-800 cursor-default">
            <FolderOpen className="w-4 h-4" /> Open folder
          </button>
        )}
        <button type="button" onClick={close} className="h-9 px-3 rounded-lg text-[12.5px] text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-default">
          {done ? 'Close' : 'Cancel'}
        </button>
        <button
          type="button"
          onClick={() => run()}
          disabled={Boolean(blocked) || Boolean(busy)}
          className="h-9 px-4 flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold whitespace-nowrap transition-colors disabled:bg-slate-800 disabled:text-slate-500 cursor-default"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : done ? <Check className="w-4 h-4" /> : <FileOutput className="w-4 h-4" />}
          {done && !busy ? 'Export again' : prefs.openResolve && canOpenResolve ? 'Export and open' : 'Export'}
        </button>
      </footer>
    </CenteredPanel>
  );
};

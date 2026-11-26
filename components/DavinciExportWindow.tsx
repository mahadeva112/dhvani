import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, AudioWaveform, Captions, Check, Film, Flag, FolderOpen, FolderOutput, ListVideo, Loader2, X } from 'lucide-react';
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
  openInResolveFree,
  openInResolveStudio,
  openResolve,
  originalFileName,
  resolveStatus,
  revealDavinciFolder,
  saveDavinciPrefs,
} from '../services/davinciExport';

/** The desktop shell's folder picker; absent in a browser, where the path is typed. */
const desktopFiles = (window as unknown as { dhvaniFiles?: { platform?: string; pickFolder: (start?: string) => Promise<string | null> } }).dhvaniFiles;
const pickFolder = desktopFiles?.pickFolder;

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
  /** False when the synced dub has no subtitles to export: the Subtitles choice is off. */
  hasSubtitles?: boolean;
  /** The project's original media: its picture goes on V1, its sound on the guide track. */
  source?: File | null;
  /** The review video's name, when the original has no picture but one was added for review. */
  reviewVideoName?: string | null;
  /** Reads the review video when the export runs. */
  loadReviewVideo?: () => Promise<File | null>;
  onError: (err: unknown) => void;
}> = ({ open, onClose, title, fileStem, report, dub, stems, colorOf, buildSrt, subtitleLanguage, pendingCount = 0, hasSubtitles = true, source = null, reviewVideoName = null, loadReviewVideo, onError }) => {
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
  /** Resolve's own import (Studio or free) did not finish: the steps by hand are shown. */
  const [oneClickFailed, setOneClickFailed] = useState(false);
  const [resolve, setResolve] = useState<ResolveStatus | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** True once the look for Resolve came back, found or not; false while it runs. */
  const [resolveChecked, setResolveChecked] = useState(false);
  const checkResolve = () => {
    setResolveChecked(false);
    return resolveStatus()
      .then(setResolve)
      .catch(() => setResolve(null))
      .finally(() => setResolveChecked(true));
  };

  // A fresh window each time it opens: the default folder for this project, nothing left from before.
  useEffect(() => {
    if (!open) return;
    setDone(null);
    setAfter(null);
    setOneClickFailed(false);
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
  /** Subtitles go in only when the synced dub has some. */
  const subtitlesOn = prefs.subtitles && hasSubtitles;
  const videoOn = prefs.timeline && prefs.video && Boolean(videoName);
  const guideOn = prefs.timeline && prefs.guide && Boolean(source);
  const videoFileName = videoOn ? (sourceIsVideo && source ? originalFileName(fileStem, source, 'original') : originalFileName(fileStem, { name: reviewVideoName || '' , type: 'video/mp4' }, 'video')) : null;
  const guideFileName = guideOn && source ? originalFileName(fileStem, source, 'original') : null;
  const fpsAuto = videoOn && prefs.fpsAuto;
  const canOpenResolve = Boolean(resolve?.installed);
  const freeBridgeOffered = Boolean(resolve?.installed && resolve.studio === false && desktopFiles?.platform === 'win32');
  /** Studio, or a Resolve that can't be told apart (macOS): the one-click open is offered, as beta. */
  const studioOffered = Boolean(resolve?.installed && resolve.studio !== false);
  /** "Open DaVinci Resolve" on, with a timeline: Resolve also makes the project and imports it (Studio by outside script, free by the DHVANI script in Workspace › Scripts). Off = files only. */
  const oneClickMode: 'studio' | 'free' | null = !prefs.timeline || !prefs.openResolve ? null : freeBridgeOffered ? 'free' : studioOffered ? 'studio' : null;
  const files = [
    ...(videoFileName ? [videoFileName] : []),
    ...(guideFileName ? [guideFileName] : []),
    ...(prefs.timeline ? [timelineName, ...tracks.map((t) => t.fileName)] : []),
    ...(fullDub ? [dubFileName] : []),
    ...(subtitlesOn ? [srtFileName] : []),
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

  const run = async (mode: 'studio' | 'free' | null = null) => {
    if (blocked || !dub) return;
    const srtText = subtitlesOn ? buildSrt() : null;
    abort.current = new AbortController();
    setBusy('Starting…');
    setAfter(null);
    setOneClickFailed(false);
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
      if (mode === 'studio' && result.timeline) {
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
          setOneClickFailed(true);
          onError(err);
        }
        setAfter(notes.filter(Boolean).join(' · ') || null);
        return;
      }
      if (mode === 'free' && result.timeline) {
        setBusy('Opening in DaVinci Resolve… leave Resolve alone until this finishes');
        try {
          const opened = await openInResolveFree({
            timeline: result.timeline,
            srt: result.files.find((f) => /\.srt$/i.test(f)) || null,
            name: `${title} dub`,
            fps: result.fps,
          });
          notes.push(
            `Opened in Resolve as "${opened.project}"`,
            opened.subtitles === 'timeline' ? 'subtitles on ST1' : opened.subtitles === 'pool' ? 'subtitles in the Media Pool: drag them to the start' : opened.subtitles === 'failed' ? 'subtitles not imported' : '',
            opened.saved ? '' : 'save the project in Resolve'
          );
        } catch (err) {
          notes.push('Not opened in Resolve: the files are exported, so File › Import › Timeline works by hand');
          setOneClickFailed(true);
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


  // The lanes as Resolve shows them after the import: the markers above, the video, the dub tracks, the guide, the subtitles.
  const duration = Math.max(report.duration || 0, 0.001);
  const pct = (s: number) => `${Math.max(0, Math.min(100, (s / duration) * 100))}%`;
  const span = (start: number, end: number) => ({ left: pct(start), width: `max(2px, calc(${pct(end)} - ${pct(start)}))` });
  const laneRow = (key: string, label: string, body: React.ReactNode) => (
    <div key={key} className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-[11.5px] text-slate-400">{label}</span>
      <div className="relative flex-1 h-2.5 rounded-full bg-slate-800/80 overflow-hidden">{body}</div>
    </div>
  );
  const markers = prefs.timeline && prefs.markers ? report.units.filter((u) => u.placedStart !== null && lineNote(u)) : [];

  const card = (key: string, on: boolean, onToggle: (() => void) | null, icon: React.ReactNode, name: string, note: string, kind: string) => (
    <label key={key} className={`flex items-start gap-3 py-3 pr-3 border-t border-edge ${onToggle ? 'cursor-default' : 'opacity-75'}`}>
      <input type="checkbox" checked={on} disabled={!onToggle} onChange={() => onToggle?.()} aria-label={name} className="mt-0.5 accent-violet-500 w-4 h-4 shrink-0" />
      <span className="mt-0.5 text-slate-400 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className="flex-1 min-w-0 text-[13.5px] leading-tight font-semibold text-slate-100">{name}</span>
          <span className="shrink-0 text-[10.5px] font-mono text-slate-500">{kind}</span>
        </span>
        <span className="block mt-0.5 text-[12px] text-slate-400 leading-snug">{note}</span>
      </span>
    </label>
  );
  const cards = [
    card('timeline', prefs.timeline, () => set({ timeline: !prefs.timeline }), <ListVideo className="w-4 h-4" />, 'Timeline', oneClickMode ? 'Dub clips stay in place. Imported into Resolve for you.' : 'Dub clips stay in place. Import with File › Import › Timeline.', 'FCPXML'),
    videoName
      ? card('video', videoOn, prefs.timeline ? () => set({ video: !prefs.video }) : null, <Film className="w-4 h-4" />, 'Original video', `${videoName}${sourceIsVideo ? '' : ' (the review video)'}: copied unchanged to video track 1.`, 'V1')
      : null,
    source
      ? card('guide', guideOn, prefs.timeline ? () => set({ guide: !prefs.guide }) : null, <AudioLines className="w-4 h-4" />, 'Original audio', 'Guide track, turned off in Resolve.', 'guide')
      : null,
    card('dub', fullDub, dubForTimeline ? null : () => set({ fullDub: !prefs.fullDub }), <AudioWaveform className="w-4 h-4" />, 'Full dub', dubForTimeline ? 'Required by the timeline.' : 'One file with its start timecode inside.', dub && /wav|wave/i.test(dub.type) ? 'WAV' : 'MP3'),
    card('srt', subtitlesOn, hasSubtitles ? () => set({ subtitles: !prefs.subtitles }) : null, <Captions className="w-4 h-4" />, 'Subtitles', hasSubtitles ? `${subtitleLanguage || 'Dub'} subtitles timed to the dub.` : 'No subtitles for the synced dub yet.', 'SRT'),
    card(
      'markers',
      prefs.markers && prefs.timeline,
      prefs.timeline ? () => set({ markers: !prefs.markers }) : null,
      <Flag className="w-4 h-4" />,
      'Problem-line markers',
      problemCount === 0 ? 'No line is flagged right now.' : `${problemCount === 1 ? 'One flagged line' : `${problemCount} flagged lines`} from the Dub page.`,
      problemCount > 0 ? String(problemCount) : ''
    ),
  ].filter(Boolean);

  const field = 'h-10 w-full px-3 rounded-lg bg-slate-950/60 border text-[13px] text-slate-100 focus:outline-none focus:border-violet-500';
  const edition = resolve?.studio === true ? ' · Studio' : resolve?.studio === false ? ' · Free version' : '';
  const resolveNote = !resolve
    ? resolveChecked
      ? 'Could not check for DaVinci Resolve'
      : 'Looking for DaVinci Resolve…'
    : !resolve.installed
      ? 'Not found on this computer'
      : resolve.running
        ? `Open already${edition}`
        : `Found on this computer${edition}`;
  const oneClickNote = oneClickMode ? ' · makes the project and imports it (beta)' : '';
  const status = busy
    ? busy
    : done
      ? [`Exported ${done.files.length} ${done.files.length === 1 ? 'file' : 'files'}${done.kept.length ? `, ${done.kept.length} unchanged` : ''}`, done.fpsNote, ...done.notes, after].filter(Boolean).join(' · ')
      : blocked;

  return (
    <CenteredPanel open={open} onClose={close} label="Export for DaVinci Resolve" className="max-w-[46rem]">
      <header className="flex items-center gap-4 px-6 pt-5 pb-4 border-b border-edge">
        <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-violet-500/15 text-violet-300">
          <FolderOutput className="w-5 h-5" />
        </span>
        <span className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold text-slate-100">Export for DaVinci Resolve</h2>
          <p className="text-[12.5px] text-slate-400">Works in the free version · No scripts needed</p>
        </span>
        <button type="button" onClick={close} aria-label="Close" className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-default">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="px-6 py-5 flex flex-col gap-5 overflow-y-auto">
        {pendingCount > 0 && (
          <p className="text-[12px] leading-snug text-amber-300">
            {pendingCount === 1 ? '1 line changed' : `${pendingCount} lines changed`} since the last Sync. The export is the dub as synced; Sync again first to take the change{pendingCount === 1 ? '' : 's'} in.
          </p>
        )}

        <div className="flex flex-col">
          <span className={`${sectionLabel} mb-2`}>Export contents</span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-5">{cards}</div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <label className="flex flex-col gap-1.5">
            <span className={sectionLabel}>Start timecode</span>
            <input
              value={prefs.timecode}
              onChange={(e) => set({ timecode: e.target.value })}
              spellCheck={false}
              title="Resolve's default is 01:00:00:00"
              className={`${field} font-mono ${tcOk ? 'border-edge' : 'border-rose-500/70'}`}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={sectionLabel}>Frame rate</span>
            <select
              value={fpsAuto ? 'auto' : prefs.fps}
              onChange={(e) => (e.target.value === 'auto' ? set({ fpsAuto: true }) : set({ fps: e.target.value as DavinciFps, fpsAuto: false }))}
              title={done?.fpsFromVideo ? `${done.fps} fps, read from the video` : fpsAuto ? 'Read from the video when exporting' : 'Match your Resolve timeline'}
              className={`${field} border-edge cursor-default`}
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
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={sectionLabel}>Audio tracks</span>
            <select
              value={perSpeakerPossible && prefs.perSpeaker ? 'speaker' : 'one'}
              onChange={(e) => set({ perSpeaker: e.target.value === 'speaker' })}
              className={`${field} border-edge cursor-default`}
            >
              <option value="one" className="bg-slate-900">
                One track
              </option>
              <option value="speaker" disabled={!perSpeakerPossible} className="bg-slate-900">
                {perSpeakerPossible ? 'One per speaker' : 'One per speaker (needs 2+ speakers)'}
              </option>
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <span className={sectionLabel}>Timeline preview</span>
          <div className="rounded-xl border border-edge bg-slate-950/50 px-3.5 py-3 flex flex-col gap-2">
            {markers.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="w-28 shrink-0" />
                <div className="relative flex-1 h-3">
                  {markers.map((u) => (
                    <span key={u.key} title={lineNote(u) || undefined} className="absolute top-0 -translate-x-1/2 cursor-default" style={{ left: pct(u.placedStart as number) }}>
                      <Flag className="w-3 h-3 text-amber-400 fill-amber-400" />
                    </span>
                  ))}
                </div>
              </div>
            )}
            {videoOn && laneRow('v1', 'V1 Video', <span className="absolute inset-0 rounded-full bg-violet-500/80" />)}
            {prefs.timeline ? (
              tracks.map((t, i) =>
                laneRow(
                  `a${i}`,
                  `A${i + 1} ${t.name}`,
                  t.lines.map((l, j) => <span key={j} className="absolute inset-y-0 rounded-full" style={{ ...span(l.start, l.end), backgroundColor: t.color || LANE_COLORS[i % LANE_COLORS.length] }} />)
                )
              )
            ) : (
              <p className="pl-[7.75rem] text-[11.5px] text-slate-500 py-0.5">Timeline off: drop the dub WAV in with "Insert Using Timecode".</p>
            )}
            {guideOn && laneRow('guide', `A${tracks.length + 1} Original · off`, <span className="absolute inset-0 rounded-full bg-slate-600/70" />)}
            {subtitlesOn &&
              laneRow(
                'st1',
                'ST1 Subtitles',
                tracks.flatMap((t) => t.lines).map((l, j) => <span key={j} className="absolute inset-y-[2px] rounded-[2px] bg-slate-500/70" style={span(l.start, l.end)} />)
              )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className={sectionLabel}>Save to</span>
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-slate-500 shrink-0" />
            <input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              spellCheck={false}
              aria-label="Export folder"
              className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-slate-950/60 border border-edge font-mono text-[12px] text-slate-300 focus:outline-none focus:border-violet-500"
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
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pl-6 text-[12px] text-slate-400">
            <label className="flex items-center gap-2 cursor-default" title={prefs.sameFiles ? 'Same names, so Resolve keeps its links.' : 'Each export gets a new folder beside this one.'}>
              <input type="checkbox" checked={prefs.sameFiles} onChange={() => set({ sameFiles: !prefs.sameFiles })} className="accent-violet-500 w-3.5 h-3.5" />
              Export again writes over the same files
            </label>
            {prefs.timeline && !oneClickMode && (
              <label className="flex items-center gap-2 cursor-default">
                <input type="checkbox" checked={prefs.copyPath} onChange={() => set({ copyPath: !prefs.copyPath })} className="accent-violet-500 w-3.5 h-3.5" />
                Copy the timeline's path
              </label>
            )}
          </div>
        </div>

        {done && !busy && (!oneClickMode || oneClickFailed) && (
          <div className="rounded-xl bg-slate-800/50 px-4 py-3 text-[12px] leading-relaxed text-slate-300">
            <div className="font-semibold text-slate-200 mb-0.5">Then in Resolve</div>
            {prefs.timeline ? (
              <>
                <div>
                  1. File › Import › Timeline, pick <span className="font-mono text-slate-200">{timelineName}</span>
                </div>
                <div>2. Keep "Automatically import source clips into media pool" on</div>
                <div>{videoOn ? '3. Your video is already on V1, under the dub' : '3. Put your video on V1 at the start, or copy the dub tracks into your edit'}</div>
                {subtitlesOn && (
                  <div>
                    4. Subtitles: File › Import › Subtitle, pick <span className="font-mono text-slate-200">{srtFileName}</span>, then drag it to the timeline's very start ({prefs.timecode}).
                  </div>
                )}
              </>
            ) : (
              <>
                <div>1. Import the files into the Media Pool</div>
                <div>2. Right-click the dub › Insert Selected Clips to Timeline Using Timecode</div>
                {subtitlesOn && (
                  <div>
                    3. Subtitles: File › Import › Subtitle, pick <span className="font-mono text-slate-200">{srtFileName}</span>, then drag it to the timeline's very start.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {oneClickMode === 'studio' && !busy && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] leading-snug text-amber-200">
            Resolve Studio makes a new project at this frame rate, imports the timeline and subtitles, and opens the Edit page. Save your open Resolve project first. Needs
            Preferences › System › General › External scripting using: Local.
          </p>
        )}

        {oneClickMode === 'free' && !busy && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] leading-snug text-amber-200">
            DHVANI adds a "DHVANI" script to Resolve's Workspace › Scripts menu and runs it: your open project is saved, then a new project at this frame rate gets the
            timeline, its media and the subtitles, and the Edit page opens. Leave Resolve alone while it works.
          </p>
        )}

        {status && (
          <p className={`flex items-center gap-2 text-[12px] leading-snug ${blocked && !busy && !done ? 'text-amber-300' : 'text-slate-400'}`}>
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
            {done && !busy && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
            <span className="min-w-0">{status}</span>
            {done && !busy && (
              <button type="button" onClick={() => revealDavinciFolder(done.folder).catch(onError)} className="ml-auto shrink-0 text-violet-300 hover:text-violet-200 cursor-default">
                Open folder
              </button>
            )}
          </p>
        )}
      </div>

      <footer className="flex items-center gap-3 px-6 py-4 border-t border-edge">
        <div className={`flex items-start gap-3 flex-1 min-w-0 ${canOpenResolve ? '' : 'opacity-70'}`}>
          <input
            type="checkbox"
            id="davinci-open-resolve"
            checked={canOpenResolve && prefs.openResolve}
            disabled={!canOpenResolve}
            onChange={() => set({ openResolve: !prefs.openResolve })}
            className="mt-0.5 accent-violet-500 w-4 h-4 shrink-0"
          />
          <span className="min-w-0">
            <label htmlFor="davinci-open-resolve" className="block text-[13px] text-slate-200 cursor-default">
              Open DaVinci Resolve after export
            </label>
            <span className="block text-[11.5px] text-slate-400 truncate">
              {resolveNote}
              {canOpenResolve && prefs.openResolve ? oneClickNote : ''}
              {resolveChecked && !resolve?.installed && (
                <button type="button" onClick={checkResolve} className="ml-2 text-violet-300 hover:text-violet-200 cursor-default">
                  Check again
                </button>
              )}
            </span>
          </span>
        </div>
        <button type="button" onClick={close} className="h-10 px-4 rounded-lg border border-slate-700 text-[13px] text-slate-200 hover:bg-slate-800 cursor-default">
          {done ? 'Close' : 'Cancel'}
        </button>
        <button
          type="button"
          onClick={() => run(oneClickMode)}
          disabled={Boolean(blocked) || Boolean(busy)}
          className="h-10 px-5 flex items-center gap-2 rounded-lg bg-violet-500 hover:bg-violet-400 text-white text-[13.5px] font-semibold whitespace-nowrap transition-colors disabled:bg-slate-800 disabled:text-slate-500 cursor-default"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {done && !busy ? 'Export again' : 'Export package'}
        </button>
      </footer>
    </CenteredPanel>
  );
};

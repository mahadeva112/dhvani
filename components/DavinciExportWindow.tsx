import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AudioWaveform, Captions, Check, Film, Flag, FolderOpen, FolderOutput, Loader2, X } from 'lucide-react';
import { CenteredPanel } from './CenteredPanel';
import { Select } from './Select';
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
  /** Where a one-click export is: writing the files, then Resolve making the project. */
  const [phase, setPhase] = useState<'idle' | 'files' | 'resolve'>('idle');
  /** What Resolve made, once a one-click export is done. */
  const [opened, setOpened] = useState<{ project: string; subtitles: 'timeline' | 'pool' | 'failed' | 'none'; saved?: boolean } | null>(null);
  /** After a one-click export, the settings come back instead of its steps. */
  const [showSettings, setShowSettings] = useState(false);
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
    setPhase('idle');
    setOpened(null);
    setShowSettings(false);
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
  /** The name the video is saved under (and shown on its row), not the imported file's name. */
  const videoSavedName = videoName ? (sourceIsVideo && source ? originalFileName(fileStem, source, 'original') : originalFileName(fileStem, { name: reviewVideoName || '', type: 'video/mp4' }, 'video')) : null;
  const videoFileName = videoOn ? videoSavedName : null;
  const guideFileName = guideOn && source ? originalFileName(fileStem, source, 'original') : null;
  const fpsAuto = videoOn && prefs.fpsAuto;
  const canOpenResolve = Boolean(resolve?.installed);
  const freeBridgeOffered = Boolean(resolve?.installed && resolve.studio === false && desktopFiles?.platform === 'win32');
  /** Studio, or a Resolve that can't be told apart (macOS): the one-click open is offered, as beta. */
  const studioOffered = Boolean(resolve?.installed && resolve.studio !== false);
  /** "Open DaVinci Resolve" on, with a timeline: Resolve also makes the project and imports it (Studio by outside script, free by the DHVANI script in Workspace › Scripts). Off = files only. */
  const oneClickMode: 'studio' | 'free' | null = !prefs.timeline || !prefs.openResolve || !prefs.oneClick ? null : freeBridgeOffered ? 'free' : studioOffered ? 'studio' : null;
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
    setOpened(null);
    setShowSettings(false);
    setPhase('files');
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
        setPhase('resolve');
        try {
          const opened = await openInResolveStudio({
            timeline: result.timeline,
            srt: result.files.find((f) => /\.srt$/i.test(f)) || null,
            name: `${title} dub`,
            fps: result.fps,
          });
          setOpened(opened);
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
        setPhase('resolve');
        try {
          const opened = await openInResolveFree({
            timeline: result.timeline,
            srt: result.files.find((f) => /\.srt$/i.test(f)) || null,
            name: `${title} dub`,
            fps: result.fps,
          });
          setOpened(opened);
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
      setPhase('idle');
      abort.current = null;
    }
  };

  const close = () => {
    abort.current?.abort();
    onClose();
  };

  // ── The timeline as Resolve will show it after the import (Mock B): a ruler in timecode,
  // then ST1, V1, a track per speaker (or the dub), the guide; problem lines flagged.
  const duration = Math.max(report.duration || 0, 0.001);
  const pct = (s: number) => `${Math.max(0, Math.min(100, (s / duration) * 100))}%`;
  const span = (start: number, end: number) => ({ left: pct(start), width: `max(2px, calc(${pct(end)} - ${pct(start)}))` });
  const markers = prefs.timeline && prefs.markers ? report.units.filter((u) => u.placedStart !== null && lineNote(u)) : [];
  const rate = Math.round(parseFloat(prefs.fps)) || 25;
  const startFrames = (() => {
    const m = /^(\d{1,2})[:.](\d{2})[:.](\d{2})[:;.](\d{2,3})$/.exec(prefs.timecode.trim());
    return m ? ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * rate + Number(m[4]) : 3600 * rate;
  })();
  const tcAt = (seconds: number) => {
    const f = startFrames + Math.round(seconds * rate);
    return [Math.floor(f / (3600 * rate)), Math.floor(f / (60 * rate)) % 60, Math.floor(f / rate) % 60, f % rate].map((x) => String(x).padStart(2, '0')).join(':');
  };
  const placedCount = report.units.filter((u) => u.placedStart !== null).length;
  const speakerCount = new Set(report.units.map((u) => u.speaker).filter(Boolean)).size;
  const length = `${Math.floor(duration / 60)}:${String(Math.round(duration % 60)).padStart(2, '0')}`;

  const trackHead = (code: string, name: string, chip: string, extra?: React.ReactNode) => (
    <div className="w-40 shrink-0 flex items-center gap-2 px-2 border-r border-edge bg-slate-900">
      <span className={`font-mono text-[10.5px] px-1.5 py-px rounded ${chip}`}>{code}</span>
      <span className="text-[11.5px] text-slate-300 truncate flex-1">{name}</span>
      {extra}
    </div>
  );
  const trackRow = (key: string, head: React.ReactNode, body: React.ReactNode, dim = false) => (
    <div key={key} className={`flex h-9 border-b border-edge last:border-b-0 ${dim ? 'opacity-80' : ''}`}>
      {head}
      <div className="relative flex-1 min-w-0">{body}</div>
    </div>
  );
  const ticks = [0, 0.2, 0.4, 0.6, 0.8].map((f) => f * duration);
  const timelineView = (
    <div className="rounded-xl border border-edge overflow-hidden bg-slate-950/60">
      <div className="flex h-6 border-b border-edge bg-slate-950">
        <div className="w-40 shrink-0 border-r border-edge px-2 flex items-center font-mono text-[11px] text-slate-400">{tcOk ? prefs.timecode.trim() : '—'}</div>
        <div className="relative flex-1 min-w-0">
          {ticks.map((t) => (
            <React.Fragment key={t}>
              <span className="absolute top-0 bottom-0 w-px bg-slate-700" style={{ left: pct(t) }} />
              <span className="absolute top-1 font-mono text-[10px] text-slate-500 whitespace-nowrap" style={{ left: `calc(${pct(t)} + 4px)` }}>
                {tcOk ? tcAt(t) : ''}
              </span>
            </React.Fragment>
          ))}
          {markers.map((u) => (
            <span key={u.key} title={lineNote(u) || undefined} className="absolute bottom-0 -translate-x-1/2 cursor-default" style={{ left: pct(u.placedStart as number) }}>
              <Flag className="w-3 h-3 text-amber-400 fill-amber-400" />
            </span>
          ))}
        </div>
      </div>
      {subtitlesOn &&
        trackRow(
          'st1',
          trackHead('ST1', `Subtitles · ${subtitleLanguage || 'dub'}`, 'bg-[#c8bc9a]/25 text-[#e3d9b8]'),
          tracks.flatMap((t) => t.lines).map((l, j) => <span key={j} className="absolute inset-y-[4px] rounded-[2px] bg-[#c8bc9a]/90" style={span(l.start, l.end)} />)
        )}
      {videoOn &&
        trackRow(
          'v1',
          trackHead('V1', 'Video', 'bg-[#3e6b96]/30 text-blue-200'),
          <span className="absolute inset-y-[3px] left-0 right-0 rounded bg-[#3e6b96] border border-[#5b8ab8] px-2 flex items-center text-[10.5px] text-blue-50 truncate">{videoFileName}</span>
        )}
      {prefs.timeline
        ? tracks.map((t, i) => {
            const color = t.color || LANE_COLORS[i % LANE_COLORS.length];
            return trackRow(
              `a${i}`,
              trackHead(`A${i + 1}`, t.name, 'bg-emerald-500/20 text-emerald-200'),
              t.lines.map((l, j) => (
                <span
                  key={j}
                  title={l.note ? `${l.name} · ${l.note}` : l.name}
                  className={`absolute inset-y-[3px] rounded-[3px] border px-1 flex items-center text-[10px] text-white/90 overflow-hidden whitespace-nowrap ${l.note && prefs.markers ? 'ring-1 ring-amber-400/90' : ''}`}
                  style={{ ...span(l.start, l.end), backgroundColor: `${color}b3`, borderColor: color }}
                >
                  {l.name}
                </span>
              ))
            );
          })
        : trackRow(
            'dub',
            trackHead('A1', 'Full dub', 'bg-emerald-500/20 text-emerald-200'),
            <span className="absolute inset-0 flex items-center px-3 text-[11.5px] text-slate-500">No timeline: put the dub in with Insert Using Timecode.</span>
          )}
      {guideOn &&
        trackRow(
          'guide',
          trackHead(`A${tracks.length + 1}`, 'Original guide', 'bg-slate-700 text-slate-300', <span className="font-mono text-[10px] px-1 rounded bg-rose-500/20 text-rose-300">M</span>),
          <span className="absolute inset-y-[3px] left-0 right-0 rounded bg-slate-700/60 border border-slate-600 px-2 flex items-center text-[10.5px] text-slate-400 truncate">Original (guide) · off</span>,
          true
        )}
    </div>
  );

  // ── The inspector: what goes in, in three groups.
  const sw = (on: boolean, onChange: (() => void) | null, label: string, hint?: string, right?: React.ReactNode) => (
    <label className={`flex items-start gap-2.5 py-1 ${onChange ? '' : 'opacity-60'}`}>
      <input type="checkbox" checked={on} disabled={!onChange} onChange={() => onChange?.()} className="mt-0.5 accent-violet-500 w-3.5 h-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] text-slate-200">{label}</span>
        {hint && <span className="block text-[11px] text-slate-500 leading-snug">{hint}</span>}
      </span>
      {right ? <span className="shrink-0 font-mono text-[10.5px] text-slate-500 mt-0.5">{right}</span> : null}
    </label>
  );
  const group = (icon: React.ReactNode, name: string, body: React.ReactNode) => (
    <div className="rounded-xl border border-edge bg-slate-950/40 p-3 flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-200 mb-0.5">
        <span className="text-violet-300">{icon}</span>
        {name}
      </div>
      {body}
    </div>
  );
  const small = 'h-8 w-full px-2.5 rounded-md bg-slate-950/70 border text-[12.5px] text-slate-100 focus:outline-none focus:border-violet-500';
  const segment = <T extends string>(options: { value: T; label: string; disabled?: boolean; title?: string }[], value: T, onPick: (v: T) => void) => (
    <span className="inline-flex rounded-lg border border-edge overflow-hidden shrink-0">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          title={o.title}
          aria-pressed={o.value === value}
          onClick={() => onPick(o.value)}
          className={`px-2.5 py-1 text-[11.5px] cursor-default disabled:opacity-40 ${i ? 'border-l border-edge' : ''} ${o.value === value ? 'bg-violet-500/20 text-violet-100' : 'text-slate-400 hover:bg-slate-800'}`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );

  const inspector = (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {group(
        <Film className="w-4 h-4" />,
        'Picture',
        <>
          {sw(prefs.timeline, () => set({ timeline: !prefs.timeline }), 'Timeline', 'Each line a clip in place', 'FCPXML')}
          {videoName ? sw(videoOn, prefs.timeline ? () => set({ video: !prefs.video }) : null, 'Original video on V1', `${videoSavedName}${sourceIsVideo ? '' : ' (from the review video)'}, copied as is`) : null}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <label className="flex flex-col gap-1">
              <span className={sectionLabel}>Start</span>
              <input
                value={prefs.timecode}
                onChange={(e) => set({ timecode: e.target.value })}
                spellCheck={false}
                title="Resolve's default is 01:00:00:00"
                className={`${small} font-mono ${tcOk ? 'border-edge' : 'border-rose-500/70'}`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={sectionLabel}>Frame rate</span>
              <Select
                value={fpsAuto ? 'auto' : prefs.fps}
                onChange={(v) => (v === 'auto' ? set({ fpsAuto: true }) : set({ fps: v as DavinciFps, fpsAuto: false }))}
                title={done?.fpsFromVideo ? `${done.fps} fps, read from the video` : fpsAuto ? 'Read from the video when exporting' : 'Match your Resolve timeline'}
                ariaLabel="Frame rate"
                size="sm"
                className="w-full"
                options={[
                  ...(videoOn ? [{ value: 'auto', label: 'From the video' }] : []),
                  ...DAVINCI_FPS.map((f) => ({ value: f, label: `${f} fps` })),
                ]}
              />
            </label>
          </div>
        </>
      )}
      {group(
        <AudioWaveform className="w-4 h-4" />,
        'Sound',
        <>
          <div className="flex items-center justify-between gap-2 py-1">
            <span className="text-[12.5px] text-slate-200">Dub tracks</span>
            {segment(
              [
                { value: 'one', label: 'One' },
                { value: 'speaker', label: 'Per speaker', disabled: !perSpeakerPossible, title: perSpeakerPossible ? undefined : 'Needs 2 or more speakers with their own stems' },
              ],
              perSpeakerPossible && prefs.perSpeaker ? 'speaker' : 'one',
              (v) => set({ perSpeaker: v === 'speaker' })
            )}
          </div>
          {source ? sw(guideOn, prefs.timeline ? () => set({ guide: !prefs.guide }) : null, 'Original sound as a guide', 'Last track, turned off in Resolve') : null}
          {sw(fullDub, dubForTimeline ? null : () => set({ fullDub: !prefs.fullDub }), 'Full dub file', dubForTimeline ? 'The timeline reads it' : 'One file, its start timecode inside', dub && /wav|wave/i.test(dub.type) ? 'WAV' : 'MP3')}
        </>
      )}
      {group(
        <Captions className="w-4 h-4" />,
        'Text',
        <>
          {sw(subtitlesOn, hasSubtitles ? () => set({ subtitles: !prefs.subtitles }) : null, 'Subtitles', hasSubtitles ? `${subtitleLanguage || 'Dub'}, timed to the dub` : 'None for the synced dub yet', 'SRT')}
          {sw(
            prefs.markers && prefs.timeline,
            prefs.timeline ? () => set({ markers: !prefs.markers }) : null,
            'Problem-line markers',
            problemCount === 0 ? 'No line is flagged right now' : `${problemCount === 1 ? 'One line' : `${problemCount} lines`} to check, from the Dub page`,
            problemCount > 0 ? String(problemCount) : ''
          )}
        </>
      )}
    </div>
  );

  // ── After export: files only, open Resolve, or a new project in Resolve (one click).
  const oneClickAvailable = prefs.timeline && (freeBridgeOffered || studioOffered);
  const afterMode: 'files' | 'open' | 'project' = !prefs.openResolve || !canOpenResolve ? 'files' : prefs.oneClick && oneClickAvailable ? 'project' : 'open';
  const afterNote =
    afterMode === 'project'
      ? freeBridgeOffered
        ? 'Free Resolve: DHVANI runs its script from Workspace › Scripts. Your open project is saved first. Beta.'
        : 'Resolve Studio: needs Preferences › System › General › External scripting using: Local. Beta.'
      : afterMode === 'open'
        ? 'Then File › Import › Timeline in Resolve.'
        : 'The files only; import them yourself.';
  const afterRow = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className={sectionLabel}>After export</span>
        {segment(
          [
            { value: 'files' as const, label: 'Files only' },
            { value: 'open' as const, label: 'Open Resolve', disabled: !canOpenResolve, title: canOpenResolve ? undefined : 'DaVinci Resolve is not installed in its usual place' },
            {
              value: 'project' as const,
              label: 'New project in Resolve',
              disabled: !canOpenResolve || !oneClickAvailable,
              title: !prefs.timeline ? 'Needs the timeline' : oneClickAvailable ? undefined : 'Free Resolve: in the DHVANI desktop app on Windows',
            },
          ],
          afterMode,
          (v) => set(v === 'files' ? { openResolve: false } : v === 'open' ? { openResolve: true, oneClick: false } : { openResolve: true, oneClick: true })
        )}
        <span className="text-[11.5px] text-slate-500 min-w-0">{afterNote}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-slate-400">
        <label className="flex items-center gap-2 cursor-default" title={prefs.sameFiles ? 'Same names, so Resolve keeps its links.' : 'Each export gets a new folder beside this one.'}>
          <input type="checkbox" checked={prefs.sameFiles} onChange={() => set({ sameFiles: !prefs.sameFiles })} className="accent-violet-500 w-3.5 h-3.5" />
          Export again writes over the same files
        </label>
        {prefs.timeline && afterMode !== 'project' && (
          <label className="flex items-center gap-2 cursor-default">
            <input type="checkbox" checked={prefs.copyPath} onChange={() => set({ copyPath: !prefs.copyPath })} className="accent-violet-500 w-3.5 h-3.5" />
            Copy the timeline's path
          </label>
        )}
      </div>
    </div>
  );

  // ── A one-click export's steps, and what Resolve made.
  type StepState = 'done' | 'run' | 'wait' | 'off';
  const stepRows: { name: string; detail?: string; state: StepState }[] = [
    { name: 'Files written', detail: done ? `${done.files.length} files${done.kept.length ? `, ${done.kept.length} unchanged` : ''}` : busy || undefined, state: done ? 'done' : 'run' },
    {
      name: oneClickMode === 'free' ? 'DHVANI script in Resolve: new project, timeline and media' : 'Resolve Studio: new project, timeline and media',
      detail: opened ? `"${opened.project}"` : phase === 'resolve' ? 'Leave Resolve alone until this finishes' : undefined,
      state: opened ? 'done' : phase === 'resolve' ? 'run' : 'wait',
    },
    ...(subtitlesOn
      ? [
          {
            name: opened?.subtitles === 'pool' ? 'Subtitles in the Media Pool: drag them to the start' : opened?.subtitles === 'failed' ? 'Subtitles not imported' : 'Subtitles on ST1',
            state: (opened ? (opened.subtitles === 'timeline' ? 'done' : 'off') : 'wait') as StepState,
          },
        ]
      : []),
    { name: opened && opened.saved === false ? 'Save the project in Resolve' : 'Edit page open, project saved', state: opened ? (opened.saved === false ? 'off' : 'done') : 'wait' },
  ];
  const inResolve: [string, string][] = [
    ['Project', opened?.project || '…'],
    ['Timeline', opened ? `${tcAt(0)} – ${tcAt(duration)}` : '…'],
    [
      'Tracks',
      opened
        ? [subtitlesOn && opened.subtitles === 'timeline' ? 'ST1' : '', videoOn ? 'V1' : '', `A1${tracks.length > 1 ? `–A${tracks.length}` : ''}`, guideOn ? `A${tracks.length + 1} off` : ''].filter(Boolean).join(' · ')
        : '…',
    ],
  ];
  const stepsView = (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_17rem] gap-3">
      <div className="rounded-xl border border-edge bg-slate-950/40 p-3 flex flex-col gap-1">
        {stepRows.map((st) => (
          <div key={st.name} className="flex items-start gap-2.5 py-1">
            <span className={`mt-0.5 w-4 h-4 shrink-0 ${st.state === 'done' ? 'text-emerald-400' : st.state === 'run' ? 'text-violet-300' : st.state === 'off' ? 'text-amber-300' : 'text-slate-600'}`}>
              {st.state === 'done' ? (
                <Check className="w-4 h-4" />
              ) : st.state === 'run' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : st.state === 'off' ? (
                <Flag className="w-4 h-4" />
              ) : (
                <span className="block w-2 h-2 m-1 rounded-full bg-current" />
              )}
            </span>
            <span className="min-w-0">
              <span className={`block text-[12.5px] ${st.state === 'wait' ? 'text-slate-500' : 'text-slate-200'}`}>{st.name}</span>
              {st.detail && st.state !== 'wait' && <span className="block text-[11px] text-slate-500 truncate">{st.detail}</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-edge bg-slate-950/40 p-3 flex flex-col gap-1 text-[12px]">
        <span className={sectionLabel}>In Resolve</span>
        {inResolve.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-2 py-0.5">
            <span className="text-slate-400">{k}</span>
            <span className="font-mono text-slate-100 truncate">{v}</span>
          </div>
        ))}
        {done && !busy && (
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <button type="button" onClick={() => revealDavinciFolder(done.folder).catch(onError)} className="text-[11.5px] text-violet-300 hover:text-violet-200 cursor-default">
              Show the package folder
            </button>
            <button type="button" onClick={() => setShowSettings(true)} className="text-[11.5px] text-slate-400 hover:text-slate-200 cursor-default">
              Settings
            </button>
          </div>
        )}
      </div>
    </div>
  );
  const showSteps = Boolean(oneClickMode) && (phase !== 'idle' || (done !== null && opened !== null && !oneClickFailed && !showSettings));

  const edition = resolve?.studio === true ? ' · Studio' : resolve?.studio === false ? ' · Free' : '';
  const resolveChip = !resolve
    ? resolveChecked
      ? 'Could not check for Resolve'
      : 'Looking for Resolve…'
    : !resolve.installed
      ? 'Resolve not found'
      : `Resolve${edition} · ${resolve.running ? 'open' : 'closed'}`;
  const status = busy
    ? busy
    : done
      ? [`Exported ${done.files.length} ${done.files.length === 1 ? 'file' : 'files'}${done.kept.length ? `, ${done.kept.length} unchanged` : ''}`, done.fpsNote, ...done.notes, after].filter(Boolean).join(' · ')
      : blocked;
  const primary = done && !busy ? 'Export again' : afterMode === 'project' ? 'Export to Resolve' : afterMode === 'open' ? 'Export and open' : 'Export package';

  return (
    <CenteredPanel open={open} onClose={close} label="Export for DaVinci Resolve" className="max-w-[64rem]">
      <header className="flex items-center gap-3 px-5 py-3.5 border-b border-edge">
        <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-violet-500/15 text-violet-300">
          <FolderOutput className="w-5 h-5" />
        </span>
        <span className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-slate-100">Export for DaVinci Resolve</h2>
          <p className="text-[12px] text-slate-400 truncate">
            {title} · {placedCount} {placedCount === 1 ? 'line' : 'lines'} · {length}
            {speakerCount > 1 ? ` · ${speakerCount} speakers` : ''}
          </p>
        </span>
        <span
          className={`hidden sm:flex items-center gap-1.5 text-[11.5px] px-2 py-1 rounded-md border ${
            resolve?.installed ? (resolve.running ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-slate-800 text-slate-300 border-edge') : 'bg-slate-800 text-slate-400 border-edge'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          {resolveChip}
          {resolveChecked && (
            <button type="button" onClick={checkResolve} className="ml-1 text-violet-300 hover:text-violet-200 cursor-default">
              Check again
            </button>
          )}
        </span>
        <button type="button" onClick={close} aria-label="Close" className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-default">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto">
        {pendingCount > 0 && (
          <p className="text-[12px] leading-snug text-amber-300">
            {pendingCount === 1 ? '1 line changed' : `${pendingCount} lines changed`} since the last Sync. The export is the dub as synced; Sync again first to take the change{pendingCount === 1 ? '' : 's'} in.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className={sectionLabel}>Timeline</span>
            <span className="text-[11.5px] text-slate-500">what Resolve will show</span>
            <span className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              {prefs.timeline &&
                tracks.length > 1 &&
                tracks.map((t, i) => (
                  <span key={t.name} className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: t.color || LANE_COLORS[i % LANE_COLORS.length] }} />
                    {t.name}
                  </span>
                ))}
              {markers.length > 0 && (
                <span className="flex items-center gap-1 text-amber-300">
                  <Flag className="w-3 h-3" />
                  {markers.length} to check
                </span>
              )}
            </span>
          </div>
          {timelineView}
        </div>

        {showSteps ? stepsView : inspector}
        {!showSteps && afterRow}

        {done && !busy && (afterMode !== 'project' || oneClickFailed) && (
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

        {status && (
          <p className={`flex items-center gap-2 text-[12px] leading-snug ${blocked && !busy && !done ? 'text-amber-300' : 'text-slate-400'}`}>
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
            {done && !busy && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
            <span className="min-w-0">{status}</span>
          </p>
        )}
      </div>

      <footer className="flex items-center gap-3 px-5 py-3 border-t border-edge">
        <FolderOpen className="w-4 h-4 text-slate-500 shrink-0" />
        <input
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          spellCheck={false}
          aria-label="Export folder"
          className="flex-1 min-w-0 h-9 px-2.5 rounded-lg bg-slate-950/60 border border-edge font-mono text-[11.5px] text-slate-300 focus:outline-none focus:border-violet-500"
        />
        {pickFolder && (
          <button
            type="button"
            onClick={() => pickFolder(folder).then((f) => f && setFolder(f)).catch(() => {})}
            className="h-9 px-3 rounded-lg border border-slate-700 text-[12px] text-slate-200 hover:bg-slate-800 cursor-default shrink-0"
          >
            Change
          </button>
        )}
        {done && !busy && (
          <button type="button" onClick={() => revealDavinciFolder(done.folder).catch(onError)} className="shrink-0 text-[12px] text-violet-300 hover:text-violet-200 cursor-default">
            Open folder
          </button>
        )}
        <span className="hidden md:inline shrink-0 text-[11.5px] text-slate-500">
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
        <button type="button" onClick={close} className="h-9 px-4 rounded-lg border border-slate-700 text-[13px] text-slate-200 hover:bg-slate-800 cursor-default shrink-0">
          {done ? 'Close' : 'Cancel'}
        </button>
        <button
          type="button"
          onClick={() => run(oneClickMode)}
          disabled={Boolean(blocked) || Boolean(busy)}
          className="h-9 px-5 flex items-center gap-2 rounded-lg bg-violet-500 hover:bg-violet-400 text-white text-[13px] font-semibold whitespace-nowrap transition-colors disabled:bg-slate-800 disabled:text-slate-500 cursor-default shrink-0"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {primary}
        </button>
      </footer>
    </CenteredPanel>
  );
};

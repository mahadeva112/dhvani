import React, { useMemo, useRef, useState } from 'react';
import { ClipboardList, FileAudio, Film, FolderOpen, KeyRound, ListChecks, Mic, PackageOpen, Radio, Search, Tv, Upload } from 'lucide-react';
import type { BatchJob } from '../types';
import { projectName } from '../services/projects';
import { hasTranscript } from '../services/steps';
import { Select, languageOptions } from './Select';

interface ProHomeProps {
  projects: BatchJob[];
  onOpenProject: (id: string) => void;
  onFileSelect: (files: FileList | File[]) => void;
  /** Opens a .dhvani file as a new project. */
  onImportProject: (file: File) => void;
  onLoadSample: (sampleType: 'podcast' | 'keynote') => void;
  /** The full project list, with batch adding. */
  onOpenProjects: () => void;
  onOpenTextToSpeech?: () => void;
  onOpenApiSettings?: () => void;
  targetLanguage: string;
  languages: { code: string; label: string }[] | string[];
  onTargetLanguageChange: (lang: string) => void;
  /** The main voice new dubs start with. */
  voiceName: string | null;
}

/** How many projects the home page lists before "All projects". */
const SHOWN = 8;

const formatLength = (seconds: number | undefined) => {
  if (!seconds || !Number.isFinite(seconds)) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

const formatWhen = (ms: number | undefined) => {
  if (!ms) return '';
  const then = new Date(ms);
  const now = new Date();
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(then)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(then.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
};

/** Where a project has got to, in the steps' words. */
const stageOf = (job: BatchJob): { label: string; tone: string } => {
  if (job.syncBank) return { label: 'Dubbed', tone: 'bg-emerald-500/15 text-emerald-300' };
  if (hasTranscript(job.segments) && job.targetSource && job.targetSource !== 'pending')
    return { label: 'Script ready', tone: 'bg-indigo-500/15 text-indigo-200' };
  if (hasTranscript(job.segments)) return { label: 'Transcribed', tone: 'bg-slate-800 text-slate-200' };
  return { label: 'New', tone: 'bg-slate-800 text-slate-400' };
};

const short = (language: string | undefined) => (language ? language.slice(0, 2).toUpperCase() : '··');

/**
 * The first page: drop a file to start a dub, open one of the recent
 * projects, and what a new dub starts with. No video and no steps yet.
 */
export const ProHome: React.FC<ProHomeProps> = ({
  projects,
  onOpenProject,
  onFileSelect,
  onImportProject,
  onLoadSample,
  onOpenProjects,
  onOpenTextToSpeech,
  onOpenApiSettings,
  targetLanguage,
  languages,
  onTargetLanguageChange,
  voiceName,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [find, setFind] = useState('');

  const recent = useMemo(() => {
    const q = find.trim().toLowerCase();
    const sorted = [...projects].sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
    return q ? sorted.filter((job) => projectName(job).toLowerCase().includes(q)) : sorted;
  }, [projects, find]);

  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    const project = files.find((f) => /\.dhvani$/i.test(f.name));
    if (project) onImportProject(project);
    else onFileSelect(files);
  };

  return (
    <div className="flex-1 w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] gap-5 animate-in fade-in duration-200">
      <div className="min-w-0 flex flex-col gap-5">
        {/* Start a dub: the sound only, no picture */}
        <section
          aria-label="Start a dub"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={drop}
          className={`rounded-2xl border-[1.5px] border-dashed px-6 py-12 text-center transition-colors ${
            dragOver ? 'border-indigo-400 bg-indigo-950/30' : 'border-slate-700 hover:border-indigo-500/60 bg-slate-900/40'
          }`}
        >
          <span className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-indigo-500/15 text-indigo-300 flex items-center justify-center">
            <Upload className="w-6 h-6" />
          </span>
          <h1 className="text-[17px] font-semibold text-slate-100">Drop audio or video to start a dub</h1>
          <p className="mt-1 text-[12.5px] text-slate-400">WAV · MP3 · M4A · FLAC · MP4 · MOV · MKV — only the sound is used here</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="h-9 px-4 flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold cursor-default"
            >
              <FolderOpen className="w-4 h-4" />
              Choose file
            </button>
            <button
              type="button"
              onClick={() => projectRef.current?.click()}
              className="h-9 px-3 flex items-center gap-2 rounded-lg border border-edge bg-slate-950 hover:bg-slate-800 text-[13px] text-slate-200 cursor-default"
              title="Open a project someone saved as .dhvani. It opens as a new project; nothing here changes."
            >
              <PackageOpen className="w-4 h-4 text-slate-400" />
              Open .dhvani
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) onFileSelect(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={projectRef}
            type="file"
            accept=".dhvani"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportProject(file);
              e.target.value = '';
            }}
          />
        </section>

        {/* Recent projects */}
        <section aria-label="Recent projects" className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h2 className="text-[13.5px] font-semibold text-slate-100">Recent projects</h2>
            {projects.length > 5 && (
              <label className="relative ml-2">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                <input
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  placeholder="Find a project"
                  aria-label="Find a project"
                  className="h-7 w-44 pl-7 pr-2 rounded-lg border border-edge bg-slate-950 text-[12px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </label>
            )}
            {projects.length > 0 && (
              <button type="button" onClick={onOpenProjects} className="ml-auto text-[12px] text-slate-400 hover:text-slate-100 cursor-default">
                All projects ({projects.length}) ›
              </button>
            )}
          </div>
          {projects.length === 0 ? (
            <div className="rounded-xl border border-edge px-4 py-6 text-center text-[12.5px] text-slate-500">
              Your dubs show here. Nothing yet — drop a file above, or try a sample:
              <span className="inline-flex gap-1.5 ml-2 align-middle">
                <button
                  type="button"
                  onClick={() => onLoadSample('podcast')}
                  className="h-7 px-2 inline-flex items-center gap-1 rounded-lg border border-edge hover:bg-slate-800 text-[12px] text-slate-300 cursor-default"
                >
                  <Radio className="w-3.5 h-3.5" /> Podcast
                </button>
                <button
                  type="button"
                  onClick={() => onLoadSample('keynote')}
                  className="h-7 px-2 inline-flex items-center gap-1 rounded-lg border border-edge hover:bg-slate-800 text-[12px] text-slate-300 cursor-default"
                >
                  <Tv className="w-3.5 h-3.5" /> Keynote
                </button>
              </span>
            </div>
          ) : (
            <div className="rounded-xl border border-edge overflow-hidden">
              <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_7rem_6rem] gap-3 px-4 h-9 items-center text-[11px] text-slate-500 border-b border-edge bg-slate-900/60">
                <span>Project</span>
                <span>Length</span>
                <span>Languages</span>
                <span>Where</span>
                <span>Edited</span>
              </div>
              {recent.slice(0, SHOWN).map((job, i) => {
                const stage = stageOf(job);
                const isVideo = job.file?.type?.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi)$/i.test(job.file?.name || '');
                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => onOpenProject(job.id)}
                    className={`w-full grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_7rem_6rem] gap-3 px-4 h-12 items-center text-left text-[12.5px] hover:bg-slate-900 cursor-default ${
                      i > 0 ? 'border-t border-edge/70' : ''
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className="w-7 h-7 shrink-0 rounded-lg bg-slate-800 text-slate-400 flex items-center justify-center">
                        {isVideo ? <Film className="w-3.5 h-3.5" /> : <FileAudio className="w-3.5 h-3.5" />}
                      </span>
                      <span className="truncate font-medium text-slate-100">{projectName(job)}</span>
                    </span>
                    <span className="hidden sm:block font-mono text-slate-400 tabular-nums">{formatLength(job.audioMetadata?.duration ?? job.audioBuffer?.duration)}</span>
                    <span className="hidden sm:block text-slate-300">
                      {short(job.detectedLanguage || job.sourceLanguage || 'English')} → {short(job.language)}
                    </span>
                    <span>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${stage.tone}`}>{stage.label}</span>
                    </span>
                    <span className="hidden sm:block text-slate-500">{formatWhen(job.updatedAt ?? job.createdAt)}</span>
                  </button>
                );
              })}
              {recent.length === 0 && <p className="px-4 py-5 text-center text-[12.5px] text-slate-500">No project has that name.</p>}
            </div>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-4 min-w-0">
        {/* What a new dub starts with */}
        <section aria-label="New dub starts with" className="rounded-xl border border-edge bg-slate-900/50 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-[13.5px] font-semibold text-slate-100">New dub starts with</h2>
            <span className="ml-auto text-[11px] text-slate-500">Change any time</span>
          </div>
          <label className="block">
            <span className="block text-[11px] text-slate-500 mb-1">Dub into</span>
            <Select
              value={targetLanguage}
              onChange={onTargetLanguageChange}
              ariaLabel="Dub into"
              className="w-full"
              rememberAs="dub-language"
              options={languageOptions(languages)}
            />
          </label>
          <div>
            <span className="block text-[11px] text-slate-500 mb-1">Main voice</span>
            <div className="h-9 px-2.5 flex items-center gap-2 rounded-lg border border-edge bg-slate-950 text-[13px]">
              <Mic className="w-3.5 h-3.5 text-slate-500" />
              <span className="truncate font-medium text-slate-100">{voiceName || 'Not picked yet'}</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Pick another voice once the file is in.</p>
          </div>
        </section>

        <section aria-label="Other ways in" className="rounded-xl border border-edge p-3 flex flex-col gap-0.5">
          <h2 className="px-1.5 pb-1 text-[13px] font-semibold text-slate-100">Other ways in</h2>
          <button
            type="button"
            onClick={onOpenProjects}
            className="h-9 px-2 flex items-center gap-2 rounded-lg hover:bg-slate-800 text-[12.5px] text-slate-300 text-left cursor-default"
          >
            <ListChecks className="w-4 h-4 text-slate-500" />
            Many files at once — Your projects
          </button>
          {onOpenTextToSpeech && (
            <button
              type="button"
              onClick={onOpenTextToSpeech}
              className="h-9 px-2 flex items-center gap-2 rounded-lg hover:bg-slate-800 text-[12.5px] text-slate-300 text-left cursor-default"
            >
              <ClipboardList className="w-4 h-4 text-slate-500" />
              Text to speech, no source file
            </button>
          )}
          {onOpenApiSettings && (
            <button
              type="button"
              onClick={onOpenApiSettings}
              className="h-9 px-2 flex items-center gap-2 rounded-lg hover:bg-slate-800 text-[12.5px] text-slate-300 text-left cursor-default"
            >
              <KeyRound className="w-4 h-4 text-slate-500" />
              API settings and transcription model
            </button>
          )}
        </section>
      </aside>
    </div>
  );
};

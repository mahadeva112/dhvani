import React, { useRef, useState } from 'react';
import {
  X,
  FileAudio,
  Film,
  Trash2,
  Plus,
  Check,
  AlertCircle,
  Download,
  Loader2,
  Upload,
  ListOrdered,
} from 'lucide-react';
import { BatchJob, ProcessingStatus } from '../types';
import JSZip from 'jszip';
import { audioBufferToWav } from '../services/audioService';
import { generateSrtContent, DEFAULT_SRT_OPTIONS } from '../services/srtService';

type StageKind = 'dubbed' | 'review' | 'working' | 'waiting' | 'error';

/** Where a queued job has got to, read from its status and what it already holds. */
const jobStage = (job: BatchJob): { kind: StageKind; label?: string; dubbing?: boolean } => {
  switch (job.status) {
    case ProcessingStatus.ERROR:
      return { kind: 'error' };
    case ProcessingStatus.SYNTHESIZING_AUDIO:
      return { kind: 'working', label: 'Dubbing', dubbing: true };
    case ProcessingStatus.UPLOADING:
      return { kind: 'working', label: 'Uploading' };
    case ProcessingStatus.ANALYZING_AUDIO:
      return { kind: 'working', label: 'Reading audio' };
    case ProcessingStatus.GENERATING_XML:
    case ProcessingStatus.VALIDATING_XML:
      return { kind: 'working', label: 'Preparing' };
  }
  if (job.status === ProcessingStatus.COMPLETED || job.synthesizedAudioUrl) return { kind: 'dubbed' };
  if (job.segments.length > 0) return { kind: 'review' };
  return { kind: 'waiting' };
};

/** 125 -> "2:05", 3725 -> "1:02:05" */
const formatLength = (seconds: number) => {
  const t = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

const pill = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap';

interface BatchQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  queue: BatchJob[];
  activeJobId: string | null;
  onSelectJob: (id: string) => void;
  onRemoveJob: (id: string) => void;
  onClearQueue: () => void;
  onAddFiles: (files: FileList | File[]) => void;
  onProcessJob?: (job: BatchJob) => void;
  isProcessing?: boolean;
}

export const BatchQueueModal: React.FC<BatchQueueModalProps> = ({
  isOpen,
  onClose,
  queue,
  activeJobId,
  onSelectJob,
  onRemoveJob,
  onClearQueue,
  onAddFiles,
  onProcessJob,
  isProcessing = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  // Removing loses a job's translation and dub, so both removals ask first.
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const completedJobs = queue.filter((j) => jobStage(j).kind === 'dubbed');

  const handleBatchExportZip = async () => {
    if (completedJobs.length === 0) return;

    setIsExporting(true);
    setExportMessage('Preparing files…');

    try {
      const zip = new JSZip();
      
      const manifest: any = {
        exportedAt: new Date().toISOString(),
        totalJobs: completedJobs.length,
        jobs: []
      };

      for (const job of completedJobs) {
        const rawFileName = job.file?.name || `job_${job.id}`;
        // Clean filename and remove extensions/special characters safely
        const baseName = rawFileName.substring(0, rawFileName.lastIndexOf('.')) || rawFileName;
        const safeBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
        
        const jobFolder = zip.folder(safeBaseName) || zip;
        
        // 1. Generate & Add Subtitles (.srt)
        const srtContent = generateSrtContent(job.segments, DEFAULT_SRT_OPTIONS);
        jobFolder.file(`${safeBaseName}_subtitles.srt`, srtContent);
        
        // 2. Generate & Add Side-by-Side Dialogue Script (.txt)
        let scriptText = `Dhvani Batch Script Export - ${rawFileName}\n`;
        scriptText += `Target Language: ${job.language || 'Unknown'}\n`;
        scriptText += `Date: ${new Date().toLocaleDateString()}\n`;
        scriptText += `========================================================================\n\n`;
        
        job.segments.forEach((seg, index) => {
          const srcText = seg.textSource || seg.originalText || '';
          const tgtText = seg.textTarget || seg.targetText || '';
          scriptText += `[Cue #${index + 1}] (${seg.startTime.toFixed(2)}s - ${seg.endTime.toFixed(2)}s) [${seg.speaker || 'Speaker'}]:\n`;
          scriptText += `  Source Text: ${srcText}\n`;
          scriptText += `  Translation: ${tgtText}\n\n`;
        });
        
        jobFolder.file(`${safeBaseName}_script.txt`, scriptText);
        
        // 3. Extract & Add Dubbed Audio (.wav)
        let audioBlob: Blob | null = job.synthesizedBlob;
        
        if (!audioBlob && job.synthAudioBuffer) {
          try {
            audioBlob = audioBufferToWav(job.synthAudioBuffer);
          } catch (err) {
            console.error(`Failed to encode AudioBuffer for ${rawFileName}:`, err);
          }
        }
        
        if (audioBlob) {
          jobFolder.file(`${safeBaseName}_dubbed.wav`, audioBlob);
        }

        manifest.jobs.push({
          jobId: job.id,
          fileName: rawFileName,
          language: job.language,
          cueCount: job.segments.length,
          durationSeconds: job.audioMetadata?.duration || (job.audioBuffer?.duration || 0),
          hasAudio: !!audioBlob
        });
      }

      // Add Manifest report
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));

      setExportMessage('Making the .zip…');
      const content = await zip.generateAsync({ type: 'blob' });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.download = `dhvani_batch_export_${timestamp}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setExportMessage('Saved the .zip');
      setTimeout(() => {
        setExportMessage(null);
      }, 3500);
    } catch (err) {
      console.error('Failed to export batch zip:', err);
      setExportMessage('The .zip could not be made. Try again.');
      setTimeout(() => {
        setExportMessage(null);
      }, 4000);
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  const counts = queue.reduce(
    (acc, job) => {
      acc[jobStage(job).kind]++;
      return acc;
    },
    { dubbed: 0, review: 0, working: 0, waiting: 0, error: 0 } as Record<StageKind, number>
  );
  const segments: { kind: StageKind; label: string; bar: string; dot: string }[] = [
    { kind: 'dubbed', label: 'dubbed', bar: 'bg-emerald-400', dot: 'bg-emerald-400' },
    { kind: 'review', label: 'in review', bar: 'bg-indigo-400', dot: 'bg-indigo-400' },
    { kind: 'working', label: 'working', bar: 'bg-cyan-400', dot: 'bg-cyan-400' },
    { kind: 'waiting', label: 'not started', bar: 'bg-slate-600', dot: 'bg-slate-600' },
    { kind: 'error', label: 'failed', bar: 'bg-rose-400', dot: 'bg-rose-400' },
  ];

  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(true);
    },
    onDragLeave: () => setIsDragOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files?.length) onAddFiles(e.dataTransfer.files);
    },
  };

  const addButton = (primary = false) => (
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      className={
        primary
          ? 'h-[38px] px-4 flex items-center gap-2 rounded-[10px] bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold cursor-pointer'
          : 'h-[34px] px-3 flex items-center gap-1.5 rounded-[9px] border border-slate-800 bg-slate-900 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 shrink-0 cursor-pointer'
      }
    >
      <Plus className="w-3.5 h-3.5" /> Add files
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center sm:p-6 bg-slate-950/80 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="queue-title"
        {...dropHandlers}
        className={`relative w-full max-w-[51.25rem] min-h-full sm:min-h-0 sm:my-auto sm:max-h-[calc(100vh-3rem)] flex flex-col sm:rounded-[18px] bg-slate-900 border shadow-2xl text-slate-100 overflow-hidden ${
          isDragOver ? 'border-indigo-400' : 'border-slate-700/80'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="audio/*,video/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onAddFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {/* Header */}
        <div className="flex items-center gap-3.5 px-5 sm:px-6 py-4 border-b border-slate-800 shrink-0">
          <div className="w-[38px] h-[38px] rounded-[10px] bg-slate-100 text-slate-950 flex items-center justify-center shrink-0" aria-hidden="true">
            <ListOrdered className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="queue-title" className="text-lg font-semibold text-slate-100 leading-tight">
              Batch queue
            </h2>
            <p className="text-[12.5px] text-slate-400 mt-0.5">
              {queue.length === 0
                ? 'Line up several files and dub them one after another.'
                : `${queue.length} ${queue.length === 1 ? 'file' : 'files'}. Open one to work on it; the rest wait where you left them.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {queue.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2.5 px-6 py-12 text-center">
            <span className="w-[52px] h-[52px] rounded-[14px] bg-slate-950/60 border border-slate-800 text-slate-400 flex items-center justify-center">
              <ListOrdered className="w-6 h-6" />
            </span>
            <h3 className="mt-1 text-base font-semibold text-slate-100">No files in the queue</h3>
            <p className="text-[13px] text-slate-400 max-w-[44ch]">
              Add several talks at once. Each becomes its own dub, and you can switch between them from here. You can also drop files onto this window.
            </p>
            <div className="mt-2">{addButton(true)}</div>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="flex flex-wrap items-center gap-3.5 px-5 sm:px-6 py-3 border-b border-slate-800 bg-slate-950/40 shrink-0">
              <div className="flex-1 min-w-[12.5rem] flex flex-col gap-2">
                <div className="flex h-[7px] rounded-full overflow-hidden gap-0.5 bg-slate-800" aria-hidden="true">
                  {segments.map((s) =>
                    counts[s.kind] > 0 ? (
                      <span key={s.kind} className={s.bar} style={{ width: `${(counts[s.kind] / queue.length) * 100}%` }} />
                    ) : null
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-slate-400">
                  {segments
                    .filter((s) => counts[s.kind] > 0)
                    .map((s) => (
                      <span key={s.kind} className="flex items-center gap-1.5">
                        <span className={`w-[7px] h-[7px] rounded-full ${s.dot}`} />
                        <span className="font-semibold text-slate-100 tabular-nums">{counts[s.kind]}</span> {s.label}
                      </span>
                    ))}
                </div>
              </div>
              {addButton()}
            </div>

            {/* Files */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-2.5 flex flex-col gap-1.5">
              {queue.map((job) => {
                const stage = jobStage(job);
                const isOpenJob = job.id === activeJobId;
                const name = job.file?.name || `Job ${job.id}`;
                const length = job.audioMetadata?.duration || job.audioBuffer?.duration || 0;
                const isVideo = job.file ? job.file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi)$/i.test(job.file.name) : false;
                const dots: ('done' | 'now' | 'run' | '')[] =
                  stage.kind === 'dubbed'
                    ? ['done', 'done', 'done']
                    : stage.kind === 'review'
                      ? ['done', 'now', '']
                      : stage.kind === 'working'
                        ? stage.dubbing
                          ? ['done', 'done', 'run']
                          : ['run', '', '']
                        : ['', '', ''];

                return (
                  <div
                    key={job.id}
                    className={`grid grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:grid-cols-[2.25rem_minmax(0,1fr)_auto_auto] gap-x-3 gap-y-2 items-center p-3 rounded-xl border transition-colors ${
                      isOpenJob ? 'border-indigo-500 ring-4 ring-indigo-500/10 bg-slate-900' : 'border-slate-800 bg-slate-900 hover:bg-slate-800/40'
                    }`}
                  >
                    <span
                      className={`w-9 h-9 rounded-[9px] bg-slate-950/60 border border-slate-800 flex items-center justify-center ${
                        isOpenJob ? 'text-indigo-300' : 'text-slate-400'
                      }`}
                    >
                      {isVideo ? <Film className="w-4 h-4" /> : <FileAudio className="w-4 h-4" />}
                    </span>

                    <span className="min-w-0">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-[13.5px] font-semibold text-slate-100 truncate" title={name}>
                          {name}
                        </span>
                        {isOpenJob && (
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 rounded-md bg-indigo-500/15 text-indigo-300">
                            Open
                          </span>
                        )}
                      </span>
                      <span className="flex flex-wrap gap-1.5 mt-0.5 text-[11.5px] text-slate-400">
                        {length > 0 && <span className="font-mono tabular-nums">{formatLength(length)}</span>}
                        {length > 0 && <span className="text-slate-600">·</span>}
                        <span>
                          {job.detectedLanguage || job.sourceLanguage || 'Auto'} → {job.language}
                        </span>
                      </span>
                    </span>

                    {/* Stage: a pill and three steps (source, review, dub) */}
                    <span className="order-last sm:order-none col-start-2 sm:col-start-auto flex sm:flex-col items-center sm:items-end gap-2">
                      {stage.kind === 'dubbed' ? (
                        <span className={`${pill} bg-emerald-500/15 text-emerald-300`}>
                          <Check className="w-3 h-3" /> Dubbed
                        </span>
                      ) : stage.kind === 'review' ? (
                        <span className={`${pill} bg-indigo-500/15 text-indigo-300`}>In review · {job.segments.length} cues</span>
                      ) : stage.kind === 'working' ? (
                        <span className={`${pill} bg-cyan-500/15 text-cyan-300`}>
                          <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-current border-r-transparent animate-spin" />
                          {stage.label}…
                        </span>
                      ) : stage.kind === 'error' ? (
                        <span className={`${pill} bg-rose-500/15 text-rose-300`} title={job.errorMsg || undefined}>
                          <AlertCircle className="w-3 h-3" /> Failed
                        </span>
                      ) : (
                        <span className={`${pill} border border-slate-700 text-slate-400`}>Not started</span>
                      )}
                      <span className="flex gap-[3px]" title="Source · Review · Dub" aria-hidden="true">
                        {dots.map((d, i) => (
                          <span
                            key={i}
                            className={`w-[22px] h-[5px] rounded-full ${
                              d === 'done' ? 'bg-emerald-400' : d === 'now' ? 'bg-indigo-400' : d === 'run' ? 'bg-cyan-400 animate-pulse' : 'bg-slate-700'
                            }`}
                          />
                        ))}
                      </span>
                    </span>

                    <span className="row-span-2 sm:row-span-1 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (isOpenJob) return;
                          onSelectJob(job.id);
                          onClose();
                        }}
                        disabled={isOpenJob}
                        className={`h-8 px-3 rounded-[9px] text-[12.5px] font-medium whitespace-nowrap transition-colors ${
                          isOpenJob
                            ? 'text-slate-500 cursor-default'
                            : 'border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-slate-200 cursor-pointer'
                        }`}
                      >
                        {isOpenJob ? 'Open now' : 'Open'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(job.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-[9px] text-slate-500 hover:text-rose-300 hover:bg-slate-800 cursor-pointer"
                        aria-label={`Remove ${name}`}
                        title="Remove from queue"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </span>

                    {stage.kind === 'error' && job.errorMsg && (
                      <span className="col-start-2 col-span-2 sm:col-span-3 text-[11.5px] text-rose-300 leading-snug">{job.errorMsg}</span>
                    )}

                    {/* Removing loses the job's translation and dub, so it asks first. */}
                    {confirmRemoveId === job.id && (
                      <div className="col-span-3 sm:col-span-4 flex flex-wrap items-center gap-2.5 px-2.5 py-2 rounded-[9px] bg-rose-500/10 text-[12.5px] text-slate-200">
                        <span className="min-w-0 flex-1">
                          Remove <span className="font-semibold">{name}</span> from the queue? Its translation and dub are lost.
                        </span>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(null)}
                          className="h-7 px-2.5 rounded-md text-xs font-semibold text-slate-400 hover:text-slate-200 cursor-pointer"
                        >
                          Keep
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onRemoveJob(job.id);
                            setConfirmRemoveId(null);
                          }}
                          className="h-7 px-2.5 rounded-md bg-rose-500 hover:bg-rose-400 text-xs font-semibold text-white cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`mt-1 flex items-center gap-3 px-3.5 py-3 rounded-xl border-[1.5px] border-dashed text-left text-[12.5px] text-slate-400 transition-colors cursor-pointer ${
                  isDragOver ? 'border-indigo-400 bg-indigo-950/30' : 'border-slate-700 hover:border-indigo-500/70'
                }`}
              >
                <span className="w-[34px] h-[34px] rounded-[9px] bg-indigo-500/15 text-indigo-400 flex items-center justify-center shrink-0">
                  <Upload className="w-4 h-4" />
                </span>
                <span>
                  <span className="block text-[13px] font-semibold text-slate-100">Drop more audio or video here</span>
                  Each file becomes its own dub.
                </span>
              </button>
            </div>
          </>
        )}

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-2.5 px-5 sm:px-6 py-3.5 border-t border-slate-800 shrink-0">
          {queue.length > 0 &&
            (confirmClear ? (
              <span className="flex items-center gap-2 text-[12.5px] text-slate-300">
                {queue.length === 1 ? 'Remove the file?' : `Remove all ${queue.length} files?`}
                <button type="button" onClick={() => setConfirmClear(false)} className="px-2 py-1 text-xs font-semibold text-slate-400 hover:text-slate-200 cursor-pointer">
                  Keep
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClearQueue();
                    setConfirmClear(false);
                  }}
                  className="px-2.5 py-1 rounded-md bg-rose-500 hover:bg-rose-400 text-xs font-semibold text-white cursor-pointer"
                >
                  Clear
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmClear(true)} className="text-[12.5px] text-slate-400 hover:text-rose-300 px-1 cursor-pointer">
                Clear queue
              </button>
            ))}
          <span className="flex-1" />
          {queue.length > 0 && (
            <span className="text-[11.5px] text-slate-500" role="status" aria-live="polite">
              {exportMessage || 'One folder per dub: audio .wav, subtitles .srt, script .txt'}
            </span>
          )}
          {queue.length > 0 && (
            <button
              type="button"
              onClick={handleBatchExportZip}
              disabled={completedJobs.length === 0 || isExporting}
              className="h-[38px] px-4 flex items-center gap-2 rounded-[10px] bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold whitespace-nowrap disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {completedJobs.length === 0
                ? 'No dubs to download yet'
                : `Download ${completedJobs.length} ${completedJobs.length === 1 ? 'dub' : 'dubs'} as .zip`}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-[38px] px-3.5 rounded-[10px] border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-[13px] font-medium text-slate-200 cursor-pointer"
          >
            Done
          </button>
        </div>
      </section>
    </div>
  );
};

import React, { useRef, useState } from 'react';
import {
  X,
  Layers,
  FileAudio,
  Trash2,
  Plus,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Download,
  Loader2,
} from 'lucide-react';
import { BatchJob, ProcessingStatus } from '../types';
import JSZip from 'jszip';
import { audioBufferToWav } from '../services/audioService';
import { generateSrtContent, DEFAULT_SRT_OPTIONS } from '../services/srtService';

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

  const completedJobs = queue.filter((j) => j.status === ProcessingStatus.COMPLETED);

  const handleBatchExportZip = async () => {
    if (completedJobs.length === 0) return;

    setIsExporting(true);
    setExportMessage('Preparing files...');

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

      setExportMessage('Compressing structured archive...');
      const content = await zip.generateAsync({ type: 'blob' });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.download = `dhvani_batch_export_${timestamp}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setExportMessage('Export completed successfully!');
      setTimeout(() => {
        setExportMessage(null);
      }, 3500);
    } catch (err) {
      console.error('Failed to export batch zip:', err);
      setExportMessage('Export failed. Please try again.');
      setTimeout(() => {
        setExportMessage(null);
      }, 4000);
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  const getStatusBadge = (status: ProcessingStatus) => {
    switch (status) {
      case ProcessingStatus.COMPLETED:
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-800/60">
            <CheckCircle2 className="w-2.5 h-2.5" /> Ready
          </span>
        );
      case ProcessingStatus.ERROR:
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-rose-400 bg-rose-950/80 px-2 py-0.5 rounded-full border border-rose-800/60">
            <AlertCircle className="w-2.5 h-2.5" /> Error
          </span>
        );
      case ProcessingStatus.SYNTHESIZING_AUDIO:
      case ProcessingStatus.ANALYZING_AUDIO:
      case ProcessingStatus.GENERATING_XML:
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-indigo-400 bg-indigo-950/80 px-2 py-0.5 rounded-full border border-indigo-800/60 animate-pulse">
            <RefreshCw className="w-2.5 h-2.5 animate-spin" /> {status.replace(/_/g, ' ')}
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-full border border-slate-700/60">
            Standby
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white font-display">Batch Queue Manager</h3>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-700/50">
                  {queue.length} {queue.length === 1 ? 'Job' : 'Jobs'}
                </span>
              </div>
              <p className="text-xs text-slate-400">Manage, switch, and process queued audio dubbing jobs</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Action Bar */}
        <div className="px-6 py-3 border-b border-slate-800/80 bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Audio to Queue</span>
            </button>

            {completedJobs.length > 0 && (
              <button
                type="button"
                onClick={handleBatchExportZip}
                disabled={isExporting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-xs transition-all shadow-sm active:scale-95 cursor-pointer animate-in fade-in slide-in-from-left-2 duration-200"
                title="Download all processed dub jobs as a structured ZIP folder"
              >
                {isExporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-300" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>Export ZIP ({completedJobs.length} Ready)</span>
              </button>
            )}
          </div>

          {queue.length > 0 && (
            <button
              type="button"
              onClick={onClearQueue}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 border border-slate-800 hover:border-rose-900/50 text-xs font-medium transition-all cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear All</span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onAddFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />
        </div>

        {/* Real-time Export Status Banner */}
        {exportMessage && (
          <div className="px-6 py-2 bg-indigo-950/30 border-b border-indigo-900/50 flex items-center justify-between text-xs text-indigo-300 animate-in slide-in-from-top-3 duration-200 font-medium">
            <div className="flex items-center gap-2">
              {isExporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 animate-bounce" />
              )}
              <span>{exportMessage}</span>
            </div>
          </div>
        )}

        {/* Modal Body: Job List */}
        <div className="p-6 overflow-y-auto space-y-3 flex-1 min-h-[220px]">
          {queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
              <div className="w-14 h-14 rounded-3xl bg-indigo-50 text-indigo-600 border border-indigo-200/70 dark:bg-slate-800/80 dark:text-slate-400 dark:border-slate-700/80 flex items-center justify-center shadow-xs">
                <FileAudio className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-sm">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Your Batch Queue is Empty</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Add multiple audio or video files to transcribe and dub them into different languages.
                </p>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-indigo-200 text-xs font-semibold border border-slate-700 hover:border-indigo-500/40 transition-all shadow-xs active:scale-95"
              >
                <Plus className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                <span>Select Files to Queue</span>
              </button>
            </div>
          ) : (
            queue.map((job, idx) => {
              const isActive = job.id === activeJobId;
              const fileName = job.file?.name || `Job #${idx + 1}`;
              const cueCount = job.segments?.length || 0;
              const duration = job.audioMetadata?.duration || (job.audioBuffer?.duration ?? 0);
              const durationStr = duration > 0 ? `${Math.round(duration)}s` : 'Unknown duration';

              return (
                <div
                  key={job.id}
                  className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                    isActive
                      ? 'bg-indigo-950/40 border-indigo-500/60 shadow-md ring-1 ring-indigo-500/30'
                      : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* Left: Job Meta */}
                  <div
                    onClick={() => {
                      onSelectJob(job.id);
                      onClose();
                    }}
                    className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
                  >
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                        isActive
                          ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm'
                          : 'bg-slate-900 text-slate-400 border-slate-800'
                      }`}
                    >
                      <FileAudio className="w-4 h-4" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-white truncate max-w-[220px] sm:max-w-[300px]">
                          {fileName}
                        </span>
                        {isActive && (
                          <span className="text-[9px] font-bold font-mono px-1.5 py-0.2 rounded bg-indigo-600 text-white">
                            ACTIVE
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                        <span className="font-mono text-cyan-400 font-semibold">{job.language || 'Bengali'}</span>
                        <span>•</span>
                        <span>{durationStr}</span>
                        {cueCount > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-slate-300 font-mono">{cueCount} cues</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Status & Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {getStatusBadge(job.status)}

                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectJob(job.id);
                          onClose();
                        }}
                        className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-semibold border border-slate-700 transition-all"
                      >
                        Open
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onRemoveJob(job.id)}
                      className="p-1.5 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                      title="Remove from queue"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>Click any audio job to switch and edit its dialogue translation.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs border border-slate-700 transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

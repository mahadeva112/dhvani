import React, { useEffect, useRef, useState } from 'react';
import { Upload, Film, Music, Radio, Tv, RefreshCw } from 'lucide-react';

interface MediaStripProps {
  file: File | null;
  audioBuffer: AudioBuffer | null;
  onFileSelect: (files: FileList | File[]) => void;
  onLoadSample: (sampleType: 'podcast' | 'keynote') => void;
}

const formatDuration = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    : bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Peak overview of the source audio, drawn at the canvas's own width. */
const MiniWaveform: React.FC<{ buffer: AudioBuffer }> = ({ buffer }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const data = buffer.getChannelData(0);
      const barCount = Math.floor(width / 3);
      const step = Math.max(1, Math.floor(data.length / barCount));
      const peaks: number[] = [];
      let max = 0;
      for (let i = 0; i < barCount; i++) {
        let peak = 0;
        const start = i * step;
        // Sampling every 16th value is plenty for an overview of a long file.
        for (let j = start; j < Math.min(start + step, data.length); j += 16) {
          const v = Math.abs(data[j]);
          if (v > peak) peak = v;
        }
        peaks.push(peak);
        if (peak > max) max = peak;
      }

      ctx.fillStyle = getComputedStyle(canvas).color;
      peaks.forEach((peak, i) => {
        const h = Math.max(2, (peak / (max || 1)) * (height - 4));
        ctx.fillRect(i * 3, (height - h) / 2, 2, h);
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [buffer]);

  return <canvas ref={canvasRef} className="w-full h-full block text-cyan-400/70" aria-hidden="true" />;
};

/**
 * Slim media bar at the top of step 1: a drop target before a file is loaded,
 * then the loaded file's name, length and waveform with a Replace button.
 */
export const MediaStrip: React.FC<MediaStripProps> = ({ file, audioBuffer, onFileSelect, onLoadSample }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(true);
    },
    onDragLeave: () => setIsDragOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) onFileSelect(e.dataTransfer.files);
    },
  };

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="audio/*,video/*"
      className="hidden"
      onChange={(e) => {
        if (e.target.files && e.target.files.length > 0) onFileSelect(e.target.files);
        // Picking the same file again after a reset should still fire.
        e.target.value = '';
      }}
    />
  );

  if (file) {
    const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi)$/i.test(file.name);
    const meta = [
      audioBuffer ? formatDuration(audioBuffer.duration) : null,
      audioBuffer ? `${Math.round(audioBuffer.sampleRate / 1000)} kHz ${audioBuffer.numberOfChannels > 1 ? 'stereo' : 'mono'}` : null,
      formatSize(file.size),
    ].filter(Boolean);

    return (
      <section
        {...dropHandlers}
        aria-label="Loaded media"
        className={`flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-4 min-h-[72px] px-3 py-3 rounded-2xl border bg-slate-900/90 transition-colors ${
          isDragOver ? 'border-indigo-400 bg-indigo-950/30' : 'border-slate-800'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1 sm:flex-none sm:w-72">
          <div className="w-11 h-11 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center shrink-0">
            {isVideo ? <Film className="w-5 h-5" /> : <Music className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-100 truncate" title={file.name}>
              {file.name}
            </p>
            <p className="text-xs font-mono text-slate-400 truncate tabular-nums">{meta.join(' · ')}</p>
          </div>
        </div>

        <div className="order-3 sm:order-none basis-full sm:basis-auto flex-1 min-w-0 h-11">
          {audioBuffer ? (
            <MiniWaveform buffer={audioBuffer} />
          ) : (
            <div className="h-full flex items-center gap-2 text-xs text-slate-500">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Reading audio…
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-800 text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
        >
          Replace
        </button>
        {fileInput}
      </section>
    );
  }

  return (
    <section
      {...dropHandlers}
      aria-label="Add media"
      className={`flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-4 min-h-[72px] px-3 py-3 rounded-2xl border-[1.5px] border-dashed transition-colors ${
        isDragOver
          ? 'border-indigo-400 bg-indigo-950/30'
          : 'border-slate-700 hover:border-indigo-500/70 bg-slate-900/90'
      }`}
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1 text-left cursor-pointer group"
      >
        <span className="w-11 h-11 rounded-xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center shrink-0 group-hover:bg-indigo-500/25 transition-colors">
          <Upload className="w-5 h-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-100">
            Drop audio or video here, or{' '}
            <span className="text-indigo-400 border-b border-indigo-400/50">browse files</span>
          </span>
          <span className="block text-xs text-slate-400 mt-0.5">
            WAV · MP3 · M4A · FLAC · MP4 · MOV · MKV. For video, only the audio track is uploaded.
          </span>
        </span>
      </button>

      <div className="flex items-center gap-1.5 w-full sm:w-auto sm:pl-4 sm:border-l border-slate-800 shrink-0">
        <span className="text-xs text-slate-500 mr-0.5">Try a sample</span>
        <button
          type="button"
          onClick={() => onLoadSample('podcast')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
        >
          <Radio className="w-3.5 h-3.5 text-slate-400" /> Podcast
        </button>
        <button
          type="button"
          onClick={() => onLoadSample('keynote')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
        >
          <Tv className="w-3.5 h-3.5 text-slate-400" /> Keynote
        </button>
      </div>
      {fileInput}
    </section>
  );
};

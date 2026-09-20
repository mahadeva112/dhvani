import React from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, AlertTriangle, CircleDashed } from 'lucide-react';
import {
  detectProvider,
  detectModelFamily,
  maskKey,
  PROBE_WORDS,
  ProbeStatus,
} from '../services/providerDetect';

export interface DetectionRow {
  id: 'elevenlabs' | 'translation';
  label: string;
  status: ProbeStatus;
  message: string;
  models: string[];
  model?: string;
  url?: string;
  latencyMs?: number;
}

export interface DetectionResult {
  elevenlabs: DetectionRow;
  translation: DetectionRow;
  mode: 'gateway' | 'google';
  checkedAt: string;
}

interface DetectionCardProps {
  result: DetectionResult | null;
  isChecking: boolean;
  onRecheck: () => void;
  /** The keys as currently typed, for instant offline identification. */
  keys: { elevenLabs?: string; translation?: string; translationUrl?: string };
  /**
   * Which credentials the backend already holds. A stored secret is never sent
   * to the browser, so without this the rows would claim "no credential set"
   * while happily reporting the stored one as working.
   */
  stored?: { elevenLabs?: boolean; translation?: boolean };
  /** Picking a model writes it back, so "model missing" is one click from fixed. */
  onPickModel?: (model: string) => void;
}

const TONE_CLASSES = {
  ok: 'bg-emerald-950/70 border-emerald-700/70 text-emerald-300',
  warn: 'bg-amber-950/70 border-amber-700/70 text-amber-300',
  error: 'bg-rose-950/70 border-rose-700/70 text-rose-300',
  muted: 'bg-slate-900 border-slate-700 text-slate-400',
} as const;

const MESSAGE_CLASSES = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-rose-400',
  muted: 'text-slate-400',
} as const;

const StatusIcon: React.FC<{ tone: keyof typeof TONE_CLASSES; className?: string }> = ({
  tone,
  className = 'w-3.5 h-3.5',
}) => {
  if (tone === 'ok') return <CheckCircle2 className={className} />;
  if (tone === 'warn') return <AlertTriangle className={className} />;
  if (tone === 'error') return <AlertCircle className={className} />;
  return <CircleDashed className={className} />;
};

/**
 * One credential's row: what it is, whether it works, and what to do about it.
 */
const Row: React.FC<{
  row: DetectionRow;
  typedKey?: string;
  typedUrl?: string;
  hasStoredKey?: boolean;
  isChecking: boolean;
  onPickModel?: (model: string) => void;
}> = ({ row, typedKey, typedUrl, hasStoredKey, isChecking, onPickModel }) => {
  // While a check is in flight, say so rather than showing a stale verdict.
  const status: ProbeStatus = isChecking ? 'checking' : row.status;
  const badge = PROBE_WORDS[status] || PROBE_WORDS.unverified;

  // Identified from the prefix with no network call, so it appears immediately.
  const guess = detectProvider(typedKey, typedUrl || row.url);
  const family = detectModelFamily(row.model);

  // What the second line says about the credential itself.
  const credentialHint = typedKey
    ? `${guess?.hint ?? 'key'} · ${maskKey(typedKey)}`
    : hasStoredKey
      ? 'Saved on this computer'
      : guess?.hint || 'No credential set';

  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold text-slate-100">{guess?.label || row.label}</div>
          <p className="text-[10px] text-slate-500 mt-0.5 truncate">{credentialHint}</p>
        </div>

        <span
          className={`shrink-0 flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${TONE_CLASSES[badge.tone]}`}
        >
          {status === 'checking' ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <StatusIcon tone={badge.tone} className="w-3 h-3" />
          )}
          {badge.word}
        </span>
      </div>

      {family && <p className="text-[10px] text-slate-500">{family}</p>}

      {!isChecking && row.message && (
        <p className={`text-[11px] leading-relaxed ${MESSAGE_CLASSES[badge.tone]}`}>
          {row.message}
          {row.latencyMs ? ` (${row.latencyMs}ms)` : ''}
        </p>
      )}

      {/*
        The live list. Picking from it writes the model back into the field, so
        a "model missing" verdict is one click from fixed. Shown even when there
        is nothing to write to, because "12 models available" with no way to see
        which twelve is a dead end.
      */}
      {!isChecking && row.models.length > 0 && (
        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-[10px] text-slate-500 shrink-0">Available</span>
          <select
            value={row.model && row.models.includes(row.model) ? row.model : ''}
            onChange={(e) => onPickModel?.(e.target.value)}
            disabled={!onPickModel}
            className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-[10px] font-mono text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-60 disabled:cursor-default cursor-pointer"
          >
            {(!row.model || !row.models.includes(row.model)) && (
              <option value="">
                {row.model
                  ? `${row.model} (not on this endpoint)`
                  : onPickModel
                    ? 'Choose a model'
                    : `${row.models.length} available`}
              </option>
            )}
            {row.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          {!onPickModel && <span className="text-[10px] text-slate-600 shrink-0">reference</span>}
        </div>
      )}
    </div>
  );
};

/**
 * The "Detected" panel.
 *
 * Shows both halves of the pipeline side by side — transcription and
 * translation — because a user debugging their setup wants the whole picture,
 * not one answer at a time.
 */
export const DetectionCard: React.FC<DetectionCardProps> = ({
  result,
  isChecking,
  onRecheck,
  keys,
  stored,
  onPickModel,
}) => {
  const placeholder = (id: DetectionRow['id'], label: string): DetectionRow => ({
    id,
    label,
    status: 'unverified',
    message: '',
    models: [],
  });

  const elevenlabs = result?.elevenlabs || placeholder('elevenlabs', 'ElevenLabs');
  const translation = result?.translation || placeholder('translation', 'Translation');

  return (
    <div className="rounded-2xl bg-slate-950/60 border border-slate-800 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3.5 py-2 border-b border-slate-800/80 bg-slate-950/80">
        <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">
          Detected
        </span>
        <button
          type="button"
          onClick={onRecheck}
          disabled={isChecking}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-semibold text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin' : ''}`} />
          Re-check
        </button>
      </div>

      {/* Two columns once there is room; stacked with a rule between below that. */}
      <div className="px-3.5 py-2.5 grid sm:grid-cols-2 gap-x-5">
        <Row
          row={elevenlabs}
          typedKey={keys.elevenLabs}
          hasStoredKey={stored?.elevenLabs}
          isChecking={isChecking}
        />

        <div className="mt-3 pt-3 border-t border-slate-800/80 sm:mt-0 sm:pt-0 sm:border-t-0 sm:border-l sm:pl-5">
          <Row
            row={translation}
            typedKey={keys.translation}
            typedUrl={keys.translationUrl}
            hasStoredKey={stored?.translation}
            isChecking={isChecking}
            onPickModel={onPickModel}
          />
        </div>
      </div>

      <p className="px-3.5 pb-2 text-[10px] text-slate-600 leading-relaxed">
        Transcription always uses ElevenLabs. The translation engine only ever sees cue text — never
        the audio, never timestamps.
      </p>
    </div>
  );
};

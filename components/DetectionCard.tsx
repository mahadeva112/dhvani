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

  const iconTone = {
    ok: 'bg-emerald-500/15 text-emerald-300',
    warn: 'bg-amber-500/15 text-amber-300',
    error: 'bg-rose-500/15 text-rose-300',
    muted: 'bg-slate-900 border border-slate-800 text-slate-500',
  }[badge.tone];

  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <span className={`w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 ${iconTone}`}>
        {status === 'checking' ? (
          <RefreshCw className="w-3 h-3 animate-spin" />
        ) : (
          <StatusIcon tone={badge.tone} className="w-3 h-3" />
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-slate-100 truncate">{guess?.label || row.label}</span>
        <span className={`shrink-0 text-[11px] font-medium ${MESSAGE_CLASSES[badge.tone]}`}>{badge.word}</span>
      </div>
      <p className="text-[11.5px] text-slate-400 truncate">{credentialHint}</p>
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
      {/* Only where picking writes the model back; elsewhere the message already gives the count. */}
      {!isChecking && row.models.length > 0 && onPickModel && (
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
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Checks</span>
        <button
          type="button"
          onClick={onRecheck}
          disabled={isChecking}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin' : ''}`} />
          Re-check
        </button>
      </div>

      <Row row={elevenlabs} typedKey={keys.elevenLabs} hasStoredKey={stored?.elevenLabs} isChecking={isChecking} />
      <Row
        row={translation}
        typedKey={keys.translation}
        typedUrl={keys.translationUrl}
        hasStoredKey={stored?.translation}
        isChecking={isChecking}
        onPickModel={onPickModel}
      />
    </div>
  );
};

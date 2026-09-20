import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, RefreshCw, Info } from 'lucide-react';
import { testGatewayConnection, GatewayTestResult } from '../services/apiClient';

export interface GatewayValues {
  url: string;
  apiKey: string;
  protocol: 'openai' | 'gemini';
  model: string;
}

interface GatewayFieldsProps {
  values: GatewayValues;
  onChange: (values: GatewayValues) => void;
  /** Reports the latest probe so the parent can gate its save button. */
  onStatusChange?: (result: GatewayTestResult | null) => void;
  /** Shown as the key placeholder when one is already stored. */
  hasSavedKey?: boolean;
}

type Status =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; result: GatewayTestResult }
  | { state: 'error'; message: string; result?: GatewayTestResult };

/**
 * Gateway connection fields that check themselves.
 *
 * Gateways differ in ways a user should not have to reason about: some are
 * mounted at `/v1`, some at the root, some publish a model list and some do
 * not, and a local one often needs no key. Rather than documenting all that,
 * this probes the URL shortly after it stops changing and reports what it
 * found — including the model names the gateway actually offers.
 */
export const GatewayFields: React.FC<GatewayFieldsProps> = ({
  values,
  onChange,
  onStatusChange,
  hasSavedKey = false,
}) => {
  const [status, setStatus] = useState<Status>({ state: 'idle' });

  // Tracks the in-flight probe so a newer edit supersedes an older request.
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = (patch: Partial<GatewayValues>) => onChange({ ...values, ...patch });

  const runProbe = useCallback(
    async (candidate: GatewayValues) => {
      if (!candidate.url.trim()) {
        setStatus({ state: 'idle' });
        onStatusChange?.(null);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      setStatus({ state: 'checking' });

      try {
        const result = await testGatewayConnection(
          {
            url: candidate.url.trim(),
            apiKey: candidate.apiKey.trim(),
            protocol: candidate.protocol,
            model: candidate.model.trim() || undefined,
          },
          controller.signal
        );

        // A later edit already started its own probe; discard this answer.
        if (requestId !== requestIdRef.current) return;

        if (result.valid) {
          setStatus({ state: 'ok', result });
          onStatusChange?.(result);

          // Adopt what discovery resolved so the saved values are the working
          // ones, not the shorthand that happened to be typed.
          const adopted: Partial<GatewayValues> = {};
          if (result.url && result.url !== candidate.url) adopted.url = result.url;
          if (result.model && result.model !== candidate.model) adopted.model = result.model;
          if (Object.keys(adopted).length > 0) onChange({ ...candidate, ...adopted });
        } else {
          setStatus({ state: 'error', message: result.error || 'Could not reach the gateway.', result });
          onStatusChange?.(result);
        }
      } catch (err: any) {
        if (requestId !== requestIdRef.current || controller.signal.aborted) return;
        setStatus({ state: 'error', message: err?.message || 'Could not reach the gateway.' });
        onStatusChange?.(null);
      }
    },
    [onChange, onStatusChange]
  );

  /*
   * Debounce so typing a URL does not fire a probe per keystroke. 700ms is long
   * enough to finish pasting a host and short enough to feel immediate.
   */
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!values.url.trim()) {
      setStatus({ state: 'idle' });
      return undefined;
    }

    timerRef.current = setTimeout(() => runProbe(values), 700);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Re-probe when any connection detail changes.
  }, [values.url, values.apiKey, values.protocol, values.model, runProbe]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const borderFor = (active: boolean) =>
    active && status.state === 'ok'
      ? 'border-emerald-500/80 focus:border-emerald-400'
      : active && status.state === 'error'
        ? 'border-rose-500/80 focus:border-rose-400'
        : 'border-slate-700 focus:border-indigo-500';

  const inputClasses = (active = true) =>
    `w-full bg-slate-950 border rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none font-mono transition-all ${borderFor(active)}`;

  const discovered = status.state === 'ok' ? status.result.availableModels : status.state === 'error' ? status.result?.availableModels || [] : [];

  return (
    /*
     * A container, so the rows below pair up on the card's own width rather
     * than the window's. The card is a third of the dialog on a wide screen and
     * a full row on a narrow one; keying off the viewport put two fields in a
     * 130px column on a small laptop.
     */
    <div className="@container space-y-2.5">
      <div className="grid @sm:grid-cols-2 gap-2.5">
      <div>
        <label className="text-[11px] font-semibold text-slate-300 block mb-1">Base URL</label>
        <input
          type="text"
          value={values.url}
          onChange={(e) => set({ url: e.target.value })}
          placeholder="http://172.18.1.17:14005"
          autoComplete="off"
          spellCheck={false}
          className={inputClasses()}
        />
        <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
          With or without <span className="font-mono">/v1</span> — whichever your gateway uses is
          detected automatically.
        </p>
      </div>

      <div>
        <label className="text-[11px] font-semibold text-slate-300 block mb-1">
          API key <span className="font-normal text-slate-500">— optional for local gateways</span>
        </label>
        <input
          type="password"
          value={values.apiKey}
          onChange={(e) => set({ apiKey: e.target.value })}
          placeholder={hasSavedKey ? 'Saved — paste a new key to replace it' : 'sk-…  (leave blank if not required)'}
          autoComplete="off"
          spellCheck={false}
          className={inputClasses(false)}
        />
      </div>
      </div>

      <div className="grid @sm:grid-cols-2 gap-2.5">
        <div>
          <label className="text-[11px] font-semibold text-slate-300 block mb-1">Wire format</label>
          <select
            value={values.protocol}
            onChange={(e) => set({ protocol: e.target.value as 'openai' | 'gemini' })}
            className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none cursor-pointer"
          >
            <option value="openai">OpenAI-compatible</option>
            <option value="gemini">Gemini REST</option>
          </select>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-300 block mb-1">Model</label>
          <input
            type="text"
            value={values.model}
            onChange={(e) => set({ model: e.target.value })}
            placeholder="auto-detected"
            autoComplete="off"
            spellCheck={false}
            list="dhvani-gateway-models"
            className={`w-full bg-slate-950 border rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none font-mono transition-all ${borderFor(true)}`}
          />
          {/* Native autocomplete over whatever the gateway reported. */}
          <datalist id="dhvani-gateway-models">
            {discovered.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </div>
      </div>

      {/* Live connection status */}
      {status.state === 'checking' && (
        <p className="text-xs text-slate-400 flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span>Checking the gateway...</span>
        </p>
      )}

      {status.state === 'ok' && (
        <div className="space-y-1">
          <p className="text-xs text-emerald-400 flex items-start gap-1.5 leading-relaxed">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Connected — <span className="font-mono">{status.result.model}</span>
              {status.result.latencyMs ? ` (${status.result.latencyMs}ms)` : ''}
              {status.result.availableModels.length > 0
                ? `, ${status.result.availableModels.length} models available`
                : ''}
            </span>
          </p>
          {status.result.url && status.result.url !== values.url.trim() && (
            <p className="text-[10px] text-slate-500 font-mono break-all">
              Using {status.result.url}
            </p>
          )}
          {status.result.note && (
            <p className="text-[10px] text-slate-500 flex items-start gap-1.5 leading-relaxed">
              <Info className="w-3 h-3 shrink-0 mt-0.5" />
              <span>{status.result.note}</span>
            </p>
          )}
        </div>
      )}

      {status.state === 'error' && (
        <p className="text-xs text-rose-400 flex items-start gap-1.5 leading-relaxed">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{status.message}</span>
        </p>
      )}

      {discovered.length > 0 && status.state === 'ok' && (
        <details className="text-[10px] text-slate-500">
          <summary className="cursor-pointer hover:text-slate-300 transition-colors">
            Models on this gateway ({discovered.length})
          </summary>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {discovered.slice(0, 24).map((model) => (
              <button
                key={model}
                type="button"
                onClick={() => set({ model })}
                className={`px-1.5 py-0.5 rounded font-mono border transition-colors cursor-pointer ${
                  model === values.model
                    ? 'bg-indigo-950 border-indigo-600 text-indigo-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                }`}
              >
                {model}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

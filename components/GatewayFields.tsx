import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, RefreshCw, ServerCrash, Check, X, ArrowRight, List, Copy } from 'lucide-react';
import { testGatewayConnection, GatewayTestResult } from '../services/apiClient';
import { ModelPicker } from './ApiSettingsParts';

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
  /** Models found by an earlier check, offered while this probe has not answered yet. */
  knownModels?: string[];
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
  knownModels = [],
}) => {
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [copied, setCopied] = useState(false);

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

  /*
   * The gateway took the key but its own upstream key for this model failed.
   * Nothing the user typed is wrong, so no field turns red; only the model,
   * the one thing they can change to get going, is marked.
   */
  const upstream = status.state === 'error' && status.result?.upstreamKeyInvalid ? status.result : null;

  const borderFor = (active: boolean) =>
    upstream
      ? 'border-slate-700 focus:border-indigo-500'
      : active && status.state === 'ok'
      ? 'border-emerald-500/80 focus:border-emerald-400'
      : active && status.state === 'error'
        ? 'border-rose-500/80 focus:border-rose-400'
        : 'border-slate-700 focus:border-indigo-500';

  const inputClasses = (active = true) =>
    `w-full h-[42px] bg-slate-950/60 border rounded-[10px] px-3 text-[13px] text-slate-100 placeholder:font-sans placeholder-slate-500 focus:outline-none font-mono transition-all ${borderFor(active)}`;

  const probed = status.state === 'ok' ? status.result.availableModels : status.state === 'error' ? status.result?.availableModels || [] : [];
  const discovered = probed?.length ? probed : knownModels;

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
        <label htmlFor="gateway-url" className="text-xs text-slate-400 block mb-1.5">Server address</label>
        <input
          type="text"
          id="gateway-url"
          value={values.url}
          onChange={(e) => set({ url: e.target.value })}
          placeholder="http://172.18.1.17:14005"
          autoComplete="off"
          spellCheck={false}
          className={inputClasses()}
        />
        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
          With or without <span className="font-mono">/v1</span>; either is found automatically.
        </p>
      </div>

      <div>
        <label htmlFor="gateway-key" className="flex justify-between gap-2 text-xs text-slate-400 mb-1.5">
          <span>API key</span>
          <span className="text-slate-500">optional</span>
        </label>
        <input
          type="password"
          id="gateway-key"
          value={values.apiKey}
          onChange={(e) => set({ apiKey: e.target.value })}
          placeholder={hasSavedKey ? 'Saved. Paste a new key to replace it' : 'Leave blank if none'}
          autoComplete="off"
          spellCheck={false}
          className={inputClasses(false)}
        />
      </div>
      </div>

      <div className="grid @sm:grid-cols-2 gap-2.5">
        <div>
          <label htmlFor="gateway-model" className="flex justify-between gap-2 text-xs text-slate-400 mb-1.5">
            <span>Model</span>
            {discovered.length > 0 && <span className="font-mono text-slate-500">{discovered.length} found</span>}
          </label>
          {/* Any name can be typed; the list offers what the gateway reported, searchable. */}
          <ModelPicker
            id="gateway-model"
            value={values.model}
            models={discovered}
            onChange={(model) => set({ model })}
            placeholder="Found automatically"
            className={`${inputClasses(true)} ${upstream ? '!border-amber-500/70' : ''}`}
          />
        </div>

        <div>
          <span className="text-xs text-slate-400 block mb-1.5">Speaks</span>
          {/* Most gateways speak the OpenAI format; Gemini is for one that proxies Google's own API shape. */}
          <div role="group" aria-label="Wire format" className="flex h-[42px] p-[3px] gap-0.5 bg-slate-950/60 border border-slate-700 rounded-[10px]">
            {([
              ['openai', 'OpenAI format'],
              ['gemini', 'Gemini format'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={values.protocol === value}
                onClick={() => set({ protocol: value })}
                className={`flex-1 rounded-[7px] text-xs font-medium whitespace-nowrap transition-colors cursor-default ${
                  values.protocol === value ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live connection status */}
      {status.state === 'checking' && (
        <p className="text-xs text-slate-400 flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span>Checking the gateway...</span>
        </p>
      )}

      {upstream && (
        <div className="rounded-[10px] border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
          <div className="flex items-start gap-2.5">
            <ServerCrash className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-amber-200">
                The gateway's own {upstream.upstreamProvider || 'provider'} key isn't working
              </p>
              <p className="text-xs text-slate-300 leading-relaxed mt-1">{status.state === 'error' && status.message}</p>

              <div className="flex flex-wrap items-center gap-1.5 mt-2.5 text-[11px]">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                  <Check className="w-3 h-3" /> Dhvani
                </span>
                <ArrowRight className="w-3 h-3 text-slate-500" />
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                  <Check className="w-3 h-3" /> Your gateway
                </span>
                <ArrowRight className="w-3 h-3 text-slate-500" />
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300">
                  <X className="w-3 h-3" /> {upstream.upstreamProvider || 'Provider'} (gateway's key)
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5 mt-3">
                <button
                  type="button"
                  onClick={() => document.getElementById('gateway-model')?.focus()}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-slate-600 text-xs text-slate-200 hover:bg-slate-800 cursor-default"
                >
                  <List className="w-3.5 h-3.5" /> Pick another model
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const note =
                      `Dhvani can reach ${upstream.url || values.url} and the key is accepted, but ` +
                      `${upstream.upstreamProvider || 'the upstream provider'} rejects the gateway's own key for ` +
                      `"${upstream.model || values.model}". Please replace that key in the gateway config.` +
                      (upstream.upstreamDetail ? `\n\nWhat the gateway said: ${upstream.upstreamDetail}` : '');
                    try {
                      await navigator.clipboard.writeText(note);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    } catch {
                      /* Clipboard blocked; the details below can still be selected by hand. */
                    }
                  }}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-slate-600 text-xs text-slate-200 hover:bg-slate-800 cursor-default"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy message for admin'}
                </button>
                <button
                  type="button"
                  onClick={() => runProbe(values)}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-slate-600 text-xs text-slate-200 hover:bg-slate-800 cursor-default"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Test again
                </button>
              </div>

              {upstream.upstreamDetail && (
                <details className="mt-2.5 text-[11px] text-slate-400">
                  <summary className="cursor-default hover:text-slate-200 transition-colors">Technical details</summary>
                  <p className="mt-1.5 p-2 rounded bg-slate-950/60 font-mono text-[10px] leading-relaxed break-words select-text">
                    {upstream.upstreamDetail}
                  </p>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      {status.state === 'error' && !upstream && (
        <p className="text-xs text-rose-400 flex items-start gap-1.5 leading-relaxed">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{status.message}</span>
        </p>
      )}

    </div>
  );
};

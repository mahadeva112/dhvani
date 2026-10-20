/**
 * Every failure the user should know about opens one centred popup: what went
 * wrong in a sentence, what the server said, and what to do next. Callers hand
 * over the error they caught; this file decides the wording.
 */
import type { DhvaniApiError } from './apiClient';

/* By shape, not instanceof, so this file loads in node tests without the fetch client. */
const asApiError = (err: unknown): DhvaniApiError | null =>
  (err as { name?: string } | null)?.name === 'DhvaniApiError' ? (err as DhvaniApiError) : null;

export interface ErrorReport {
  id: number;
  /** What the user was doing — "Translation failed". */
  title: string;
  /** The problem in one or two plain sentences. */
  summary: string;
  /** What the server or provider said, when it said something useful. */
  serverSaid: string | null;
  /** What to do next, in order. */
  steps: string[];
  /** A note that nothing was lost, when the caller knows that. */
  safe: string | null;
  /** Everything a support request needs, for Copy details. */
  details: string;
  /** Run the failed action again; offered as Try again. */
  retry?: () => void;
}

export interface ReportOptions {
  title?: string;
  /** "Your transcript and timestamps are intact." */
  safe?: string;
  retry?: () => void;
}

const PROVIDER_NAMES: Record<string, string> = {
  'llm-gateway': 'LLM gateway',
  elevenlabs: 'ElevenLabs',
  gemini: 'Gemini',
  cartesia: 'Cartesia',
};

const providerName = (provider: string | null | undefined): string =>
  (provider && (PROVIDER_NAMES[provider] || PROVIDER_NAMES[provider.toLowerCase()] || provider)) || 'The service';

/** Markup left in a message from an older backend or a proxy, reduced to its <title> or its text. */
export const stripMarkup = (text: string): string => {
  if (!/<(!doctype|html|head|body|title)\b/i.test(text)) return text;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1];
  const before = text.slice(0, text.search(/<(!doctype|html|head|body|title)\b/i)).trim();
  const words = (title || text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>?/g, ' '))
    .replace(/&amp;/g, '&')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  const page = title ? `The server answered with an error page: "${words}"` : words;
  return before ? `${before} ${page}` : page;
};

/** Splits "X service error (502). This is usually temporary. — <what it said>" into its two halves. */
const splitMessage = (message: string): { head: string; said: string | null } => {
  const clean = stripMarkup(message).trim();
  const at = clean.indexOf(' — ');
  if (at < 0) return { head: clean, said: null };
  return { head: clean.slice(0, at).trim(), said: clean.slice(at + 3).replace(/\.$/, '').trim() || null };
};

const SETTINGS = 'Tools and settings (Ctrl K)';

/** The next steps for an error, by its code. */
const stepsFor = (code: string, provider: string, details: unknown): string[] => {
  switch (code) {
    case 'missing_api_key':
    case 'missing_gateway_url':
      return [`Open ${SETTINGS} → API settings and add the ${provider} key.`, 'Then press the same button again.'];
    case 'invalid_api_key':
      return [
        `Open ${SETTINGS} → API settings and check the ${provider} key — copy it again from the provider if unsure.`,
        'Make sure the key has not expired and is allowed to use this feature.',
        'Then try again.',
      ];
    case 'upstream_key_invalid': {
      const info = details as { upstream?: string; model?: string } | null;
      return [
        `Your ${provider} key works. The gateway's own ${info?.upstream || 'provider'} key${info?.model ? ` for ${info.model}` : ''} was rejected, so this is not fixed in Dhvani.`,
        'Press Change next to the model and pick a different one.',
        'Ask the gateway admin to replace that key, then try again.',
      ];
    }
    case 'model_not_permitted': {
      const permitted = (details as { permitted?: string[] } | null)?.permitted;
      return [
        `Press Change next to the model and pick one this key may use${permitted?.length ? `: ${permitted.join(', ')}` : ''}.`,
        'Or ask whoever issued the key to open this model for it.',
      ];
    }
    case 'rate_limited':
      return [`${provider} is asking for a pause. Wait a minute, then press Try again.`, 'If it keeps happening, do fewer lines at a time.'];
    case 'provider_unavailable':
    case 'timeout':
    case 'empty_response':
      return [
        `The ${provider} server is having trouble — not your file or settings. Wait a minute, then press Try again.`,
        'If it fails again, press Change next to the model and pick a different one.',
        `If every model fails, the ${provider} service itself is down — try later or ask its owner.`,
      ];
    case 'output_truncated':
      return ['The model ran out of room for its answer. Try again with fewer lines, or pick a larger model with Change.'];
    case 'network_error':
      return ['Check this computer is online (open any website).', 'If you use a VPN or proxy, check it is connected.', 'Then press Try again.'];
    case 'backend_unreachable':
      return ['Close Dhvani completely and open it again.', 'Then press Try again — your project is saved.'];
    case 'output_format_not_allowed':
      return [`Your ${provider} plan does not allow this audio quality. Pick a lower Audio quality in the Dub step, then try again.`];
    case 'payload_too_large':
      return ['The file is too big to send. Use a shorter clip or a smaller file, then try again.'];
    case 'ffmpeg_missing':
      return ['Reinstall Dhvani from the in-app download, then try again.'];
    case 'cancelled':
      return [];
    default:
      return ['Press Try again.', 'If the same thing happens, press Copy details and send them to whoever supports Dhvani.'];
  }
};

let nextId = 1;
type Listener = (report: ErrorReport) => void;
const listeners = new Set<Listener>();

export const onErrorReport = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Builds the popup's wording for an error, without showing it. */
export const explainError = (err: unknown, options: ReportOptions = {}): ErrorReport => {
  const api = asApiError(err);
  const rawMessage =
    typeof err === 'string' ? err : (err as { message?: string } | null)?.message || 'Something went wrong.';
  const code = api?.code || 'unknown_error';
  const provider = providerName(api?.provider);
  const { head, said } = splitMessage(rawMessage);

  const details = [
    options.title || 'Error',
    stripMarkup(rawMessage),
    api ? `code: ${code}${api.status ? `, status: ${api.status}` : ''}${api.provider ? `, provider: ${api.provider}` : ''}` : null,
    `time: ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    id: nextId++,
    title: options.title || 'Something went wrong',
    summary: head,
    serverSaid: said,
    // Without a retry there is no Try again button to point at.
    steps: stepsFor(code, provider, api?.details).map((step) =>
      options.retry ? step : step.replace(/^Press Try again\./, 'Try again.').replace(/press Try again/g, 'try again')
    ),
    safe: options.safe || null,
    details,
    retry: options.retry,
  };
};

const isCancel = (err: unknown) =>
  (err as { name?: string } | null)?.name === 'AbortError' || asApiError(err)?.code === 'cancelled';

/* An error rethrown up the stack is shown once: by whoever caught it first, who knows the most about it. */
const shown = new WeakSet<object>();

/** Shows the error popup. A cancelled request, or an error already shown, shows nothing. */
export const reportError = (err: unknown, options: ReportOptions = {}): void => {
  if (isCancel(err)) return;
  if (err && typeof err === 'object') {
    if (shown.has(err)) return;
    shown.add(err);
  }
  const report = explainError(err, options);
  listeners.forEach((listener) => listener(report));
};

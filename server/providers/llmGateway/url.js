/**
 * Gateway URL handling.
 *
 * People paste whatever their gateway's dashboard shows them: a bare
 * `http://10.0.0.5:4000`, a `.../v1`, sometimes the full
 * `.../v1/chat/completions`. All three mean the same gateway, so normalise them
 * rather than making the user guess which shape this app wants.
 */

/** Strips trailing slashes and any endpoint path the user pasted along with it. */
export const cleanGatewayUrl = (raw) =>
  String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/\/+$/, '')
    // Endpoint paths a user might copy from docs or a curl example.
    .replace(/\/(chat\/completions|completions|embeddings)$/i, '')
    .replace(/\/models\/[^/]+:generateContent$/i, '')
    .replace(/\/models$/i, '')
    /*
     * The gateway's own chat UI. Pasting that address is an easy mistake and a
     * confusing one: it serves HTML and bounces API calls to a login page, so
     * the failure looks like a broken key rather than a wrong path.
     */
    .replace(/\/(ui|chat|playground|docs)$/i, '')
    .replace(/\/+$/, '');

/**
 * Base URLs to try, most likely first.
 *
 * OpenAI-compatible gateways almost always serve under `/v1`, but some are
 * mounted at the root, and a user who already typed `/v1` should not end up
 * with `/v1/v1`.
 */
export const candidateBases = (raw, protocol = 'openai') => {
  const base = cleanGatewayUrl(raw);
  if (!base) return [];

  const versionSuffix = protocol === 'gemini' ? 'v1beta' : 'v1';
  const alreadyVersioned = new RegExp(`/${versionSuffix}$|/v\\d+(beta\\d*)?$`, 'i').test(base);

  if (alreadyVersioned) {
    // Try as given, then the root in case the gateway is mounted there.
    const withoutVersion = base.replace(/\/v\d+(beta\d*)?$/i, '');
    return [base, withoutVersion].filter((value, index, all) => value && all.indexOf(value) === index);
  }

  return [`${base}/${versionSuffix}`, base];
};

const PRIVATE_IPV4 =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0$)/;

/**
 * True when the gateway is on this machine or a private network.
 *
 * A local proxy usually needs no bearer token at all, so requiring one would
 * block a perfectly working setup.
 */
export const isLocalGateway = (raw) => {
  try {
    const { hostname } = new URL(cleanGatewayUrl(raw));
    const host = hostname.replace(/^\[|\]$/g, '');

    if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
    if (host.endsWith('.internal') || host.endsWith('.lan')) return true;
    if (PRIVATE_IPV4.test(host)) return true;
    // Unique-local IPv6 (fc00::/7).
    if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;

    return false;
  } catch {
    return false;
  }
};

/** True when the URL is remote and unencrypted, which is worth warning about. */
export const isInsecureRemote = (raw) => {
  try {
    const url = new URL(cleanGatewayUrl(raw));
    return url.protocol === 'http:' && !isLocalGateway(raw);
  } catch {
    return false;
  }
};

/**
 * Ranks discovered models so the best default floats to the top.
 *
 * DHVANI's job here is translation, so a fast, current, instruction-following
 * model beats a large reasoning one. Anything embedding- or image-shaped is
 * excluded outright.
 */
const EXCLUDE = /(embed|embedding|rerank|moderation|whisper|tts|audio|vision|image|dall|stable-diffusion)/i;

export const rankModels = (models = []) => {
  const score = (name) => {
    const id = String(name).toLowerCase();
    let points = 0;

    if (/gemini/.test(id)) points += 100;
    if (/flash/.test(id)) points += 40;
    if (/pro/.test(id)) points += 30;
    if (/\b(2\.5|3\.\d)\b/.test(id) || /-(2\.5|3\.\d)/.test(id)) points += 20;
    if (/gpt-4|gpt-5|claude|llama|mistral|qwen/.test(id)) points += 10;
    // Previews are fine but a stable name is a safer default.
    if (/preview|exp|experimental|beta/.test(id)) points -= 5;
    if (/lite|nano|tiny|mini|8b|1b/.test(id)) points -= 10;

    return points;
  };

  /*
   * Deduplicate: a gateway can list the same model twice (LiteLLM does, when
   * one name is served by more than one deployment), and a picker showing the
   * same entry twice looks like a bug in this app.
   */
  return [...new Set(models.map((model) => String(model)))]
    .filter((model) => model && !EXCLUDE.test(model))
    .sort((a, b) => score(b) - score(a) || a.localeCompare(b));
};

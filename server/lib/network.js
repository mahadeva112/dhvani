import tls from 'node:tls';

/**
 * Outbound networking that behaves like the rest of the machine.
 *
 * Node ships its own list of root certificates and ignores the operating
 * system's. On an office network with an SSL-inspecting firewall (Zscaler,
 * Netskope, Fortinet...), IT installs the firewall's root certificate into
 * Windows, so Chrome, curl.exe and Python-with-truststore all accept the
 * re-signed connection, while Node rejects it and every call to ElevenLabs,
 * Cartesia or Gemini ends in "fetch failed".
 *
 * Adding the system store on top of Node's bundled list fixes that without
 * loosening anything: a certificate still has to chain to a root this machine
 * already trusts. Verification is never turned off.
 */
const useSystemCertificates = () => {
  if (typeof tls.setDefaultCACertificates !== 'function' || typeof tls.getCACertificates !== 'function') {
    return 0;
  }
  try {
    const system = tls.getCACertificates('system');
    if (!system.length) return 0;
    const bundled = tls.getCACertificates('bundled');
    tls.setDefaultCACertificates([...new Set([...bundled, ...system])]);
    return system.length;
  } catch {
    // An unreadable system store leaves Node's own list in place.
    return 0;
  }
};

export const systemCertificateCount = useSystemCertificates();

/** The proxy the desktop shell found in the OS settings, if any. */
export const proxyInUse = () =>
  process.env.NODE_USE_ENV_PROXY === '1' ? process.env.HTTPS_PROXY || process.env.https_proxy || null : null;

const CERT_CODES = new Set([
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_UNTRUSTED',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** The innermost error code: fetch() wraps the socket error in `cause`. */
const rootCause = (err) => {
  let current = err;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current.code && current.code !== 'UND_ERR_SOCKET') return current;
    if (!current.cause) return current;
    current = current.cause;
  }
  return current || err;
};

/**
 * Turns "fetch failed" into the reason and what to do about it.
 *
 * The bare message is useless on someone else's PC; the code underneath says
 * whether it is a firewall certificate, a proxy, DNS or a dead server.
 */
export const describeNetworkError = (err) => {
  const cause = rootCause(err);
  const code = cause?.code || '';
  const detail = (cause?.message && cause.message !== err?.message ? cause.message : err?.message || 'network error')
    // Node's own hint; the system store is already in use (see above).
    .replace(/; if the root CA is installed locally, try running Node\.js with --use-system-ca/i, '');
  const proxy = proxyInUse();

  if (CERT_CODES.has(code)) {
    return (
      `${detail} (${code}). A firewall or antivirus on this network is re-signing HTTPS traffic with a ` +
      'certificate this PC does not trust. Ask IT to install their root certificate in Windows.'
    );
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `${detail} (${code}). The server name could not be looked up — check the URL and the internet connection.`;
  }
  if (code === 'ECONNREFUSED') {
    return proxy
      ? `${detail} (${code}). The proxy ${proxy} refused the connection.`
      : `${detail} (${code}). Nothing is listening at that address — check the URL and that the server is running.`;
  }
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ECONNRESET') {
    return proxy
      ? `${detail} (${code}). The connection through the proxy ${proxy} timed out or was cut.`
      : `${detail} (${code}). The connection timed out or was cut — a firewall or proxy may be blocking it.`;
  }
  if (/407|proxy authentication/i.test(detail)) {
    return `${detail}. The proxy ${proxy || ''} needs a sign-in, which DHVANI cannot provide. Ask IT to allow this host.`;
  }
  return code ? `${detail} (${code})` : detail;
};

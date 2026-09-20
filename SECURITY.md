# Security

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue.

Use GitHub's [private vulnerability reporting](https://github.com/dhvani-studio/dhvani/security/advisories/new),
or email the maintainers. Include what you found, how to reproduce it, and what an attacker could do
with it. You can expect an acknowledgement within a few days.

Please do not test against anyone else's instance.

---

## How DHVANI handles your API keys

This is the part most people want to know about, so it is written out in full.

### Keys never reach the browser

The frontend has no ElevenLabs or Gemini SDK and no credential. Every provider call goes through the
local backend, which holds the keys. If you open your browser's devtools and inspect the network
traffic or the JavaScript bundle, there is no key to find.

### Where keys are stored

In priority order:

1. **Environment variables** — `ELEVENLABS_API_KEY`, `GEMINI_API_KEY`, and the `LLM_GATEWAY_*`
   settings. Set these however your setup prefers (a `.env` file, your shell, Docker env, a secret
   manager).
2. **The machine's config file** — written only when you use the in-app setup screen:

   | Platform | Location |
   | --- | --- |
   | Windows | `%APPDATA%\dhvani\config.json` |
   | macOS | `~/Library/Application Support/dhvani/config.json` |
   | Linux | `~/.config/dhvani/config.json` |
   | Desktop app | Electron's user-data folder for your account |
   | Docker | the `/config` volume |

   The file is written with owner-only permissions (`0600`) where the platform supports them.

A setting saved from the UI wins over the environment, because DHVANI is installed per person and
each person has their own keys. The environment seeds an install that has never been configured.

To pin credentials that the UI cannot overwrite — a container, or a shared machine — set
`ALLOW_KEY_SETUP=false`. The settings routes then refuse every write, whatever its origin.

### Keys are never logged or returned

`/api/health` and `/api/settings` report only where a key came from (`env`, `saved`, `none`) — never
the value, never a prefix, never a masked fragment. Keys do not appear in request logs or error
messages.

The one credential-adjacent value these endpoints do return is your **LLM gateway URL**, so the
setup screen can show which gateway is active. The gateway's bearer token is never returned. If
your gateway URL is itself sensitive, set it from the environment and put
`ALLOW_KEY_SETUP=false` so the settings endpoint is disabled.

### The setup screen is loopback-only

`POST /api/settings/keys` is rejected unless the request originates from `127.0.0.1` or `::1`. If you
put DHVANI behind a reverse proxy, a remote visitor cannot change your credentials. Set
`ALLOW_KEY_SETUP=false` to disable the endpoint entirely.

---

## Deployment guidance

### DHVANI is built for one person on one machine

There is **no authentication and no per-user accounting**, by design. It binds to `127.0.0.1` by
default so only you can reach it.

Anyone who can reach the server can spend your ElevenLabs and Gemini credits, and transcription of a
long recording is not cheap. Treat the port as you would treat the keys themselves.

### If you expose it anyway

You are taking on the security model yourself. At minimum:

- Put authentication in front of it — a reverse proxy with SSO, basic auth, or a VPN.
- Terminate TLS at the proxy.
- Set `ALLOW_KEY_SETUP=false`.
- Set `CORS_ORIGIN` to exactly your origin.
- Keep `RATE_LIMIT_PER_MINUTE` low, and set `MAX_UPLOAD_MB` to something you can afford.
- Watch your provider billing dashboards.

Starting with `HOST=0.0.0.0` prints a warning in the server log for this reason.

---

## What the app does defensively

| Concern | Measure |
| --- | --- |
| Credentials in client code | None exist; all provider calls are proxied |
| Remote key tampering | Setup endpoint is loopback-only and can be disabled |
| Data exfiltration by a compromised dependency | CSP `connect-src 'self'` — the page cannot reach any other host |
| Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options` |
| MIME sniffing, referrer leakage | Helmet defaults |
| Runaway retry loops spending money | Per-IP rate limit on `/api` |
| Oversized uploads | `MAX_UPLOAD_MB`, streamed to disk rather than memory |
| Proxy header spoofing | `trust proxy` is restricted to loopback |
| Temp file buildup | Uploads and extracted audio are removed when the response ends |
| Header injection via `X-Forwarded-For` | Not trusted from non-loopback peers |

## What leaves your machine

Only what the work requires:

- **To ElevenLabs** — the audio you upload (or the audio track extracted from your video), for
  transcription and voice synthesis.
- **To your translation engine** — subtitle *text* only. Never timestamps, never the audio, never
  the media file. That engine is Google Gemini by default, or your own LLM gateway if you configure
  one, in which case subtitle text never reaches Google at all.

Nothing is sent anywhere else. There is no telemetry, no analytics, no crash reporting, and no
update check. Your media, transcripts and subtitles stay on your machine unless you export them.

### Self-hosted gateways

Pointing translation at your own gateway keeps subtitle text inside your infrastructure. Two things
to keep in mind:

- DHVANI does not pin certificates or disable TLS verification. Use an `https://` gateway URL on
  anything but localhost.
- The bearer token is stored exactly like the other keys — config file with owner-only permissions,
  never returned to the browser.

## Supported versions

Security fixes land on the latest minor release. There are no long-term support branches.

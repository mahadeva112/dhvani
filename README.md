# DHVANI — Local AI Dubbing & Subtitle Studio

A standalone dubbing and subtitling studio that runs entirely on your own machine.

**ElevenLabs is the source of truth for transcription and subtitle timestamps. Gemini is used only
for translation, and never creates or alters subtitle timing.**

```
Upload audio/video
   ↓
ElevenLabs Scribe  →  transcript + word-level timestamps
   ↓
Original-language .srt  (cut on real word boundaries)
   ↓
Gemini  →  translates cue TEXT only
   ↓
Translated .srt  (identical timestamps, identical cue numbering)
   ↓
Preview / edit / download  →  optional ElevenLabs voice dub
```

---

## Install

Pick whichever suits you. All four run the same app, entirely on your machine.

| | Best for | You need |
| --- | --- | --- |
| **[Desktop app](#desktop-app)** | Most people | Nothing — double-click and go |
| **[Portable zip](#portable-zip)** | No installer, no admin rights | Node.js 20+ |
| **[Docker](#docker)** | Servers, homelabs, reproducible setups | Docker |
| **[From source](#from-source)** | Developing or modifying DHVANI | Node.js 20+, git |

Whichever you choose, you supply your own credentials:

- **ElevenLabs** — <https://elevenlabs.io/app/settings/api-keys> — transcription, timestamps, voice
- **Translation** — either a **Gemini API key** (<https://aistudio.google.com/apikey>) *or*
  **your own LLM gateway** (see [Using your own gateway](#using-your-own-llm-gateway))

The first time you open DHVANI it asks for these and saves them on your computer. Nothing else to
set up.

### Desktop app

Download the installer for your platform from the
[latest release](https://github.com/dhvani-studio/dhvani/releases/latest):

| Platform | File |
| --- | --- |
| Windows | `DHVANI-1.0.0-Setup-x64.exe` |
| macOS (Apple silicon) | `DHVANI-1.0.0-arm64.dmg` |
| macOS (Intel) | `DHVANI-1.0.0-x64.dmg` |
| Linux | `DHVANI-1.0.0-x64.AppImage` |

Install it, open it, paste your two API keys. Node.js and ffmpeg are bundled — nothing else to
install.

> The builds are not code-signed, so Windows SmartScreen shows "More info → Run anyway", and macOS
> needs right-click → Open the first time.

### Portable zip

Download `dhvani-1.0.0.zip`, unzip it anywhere, and read `FIRST-RUN.txt`.

- **Windows** — double-click `START-WINDOWS.bat`
- **macOS / Linux** — run `./start-macos-linux.sh`

The first launch installs dependencies (about a minute), then opens
<http://localhost:8787> and asks for your keys.

Requires [Node.js 20+](https://nodejs.org). ffmpeg is fetched automatically; without it, video files
are uploaded whole instead of having their audio extracted.

### Docker

```bash
git clone https://github.com/dhvani-studio/dhvani.git
cd dhvani
```

Create a `.env` file next to `docker-compose.yml`:

```
ELEVENLABS_API_KEY=your_elevenlabs_key
GEMINI_API_KEY=your_gemini_key
```

```bash
docker compose up -d
```

Open <http://localhost:8787>. ffmpeg is in the image.

The container binds to `127.0.0.1` by default. Read
[SECURITY.md](SECURITY.md#deployment-guidance) before changing that — anyone who can reach the port
can spend your API credits.

### From source

```bash
git clone https://github.com/dhvani-studio/dhvani.git
cd dhvani
npm install
```

```bash
npm run dev
```

Open <http://localhost:3000>. The backend runs on `:8787` and Vite proxies `/api` to it; both
reload on change.

For a production run from source:

```bash
npm start
```

That builds the frontend and serves everything from <http://localhost:8787>.

Prefer a file over the setup screen? Copy `.env.example` to `.env`, paste your keys, and restart.

`.env` is a **starting point, not a lock**: it seeds an install that has never been configured, and
anything you then enter in **API Settings** — keys, endpoints, model names — is saved to this
computer's own config file and takes over from there. That is what lets one build be handed to
several people who each have their own keys, gateway host and models. To make the environment the
last word instead, set `ALLOW_KEY_SETUP=false`, which refuses UI writes outright.

### All scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Backend (watch mode) + Vite dev server together |
| `npm run dev:server` / `dev:client` | Either half on its own |
| `npm run server` | Backend, no watcher |
| `npm run build` | Builds the frontend into `dist/` |
| `npm start` | Build, then serve everything from the backend |
| `npm test` | Subtitle-timing and pipeline tests |
| `npm run typecheck` | TypeScript check, no emit |
| `npm run verify` | Typecheck + tests + build (what CI runs) |
| `npm run desktop` | Runs the desktop shell against a local build |
| `npm run dist:win` / `dist:mac` / `dist:linux` | Builds that platform's installer into `release/` |
| `npm run dist:zip` | Builds the portable zip into `release/` |
| `npm run docker:build` / `docker:run` | Builds and starts the container |
| `npm run icon` | Regenerates the app icon and favicon |

## Using your own LLM gateway

If you already run an LLM gateway — LiteLLM, vLLM, OpenRouter, one-api, Portkey, LocalAI — you can
point translation at it instead of calling Google directly. You do not need a Google key at all.

Pick **My own gateway** on the setup screen — or later, from **Voice Settings → Advanced Settings →
API & Translation Engine** — and paste your base URL. That is usually the whole job:
DHVANI probes the URL as you type, works out the right path, lists the models your gateway exposes
and picks a sensible default, then confirms with one tiny completion before anything is saved.

Or set it in `.env`:

```
LLM_GATEWAY_URL=http://172.18.1.17:14005
LLM_GATEWAY_KEY=sk-your-bearer-token
LLM_GATEWAY_PROTOCOL=openai
LLM_GATEWAY_MODELS=vertex_ai/gemini-3.1-pro-preview
```

### The URL

Paste whatever your gateway's dashboard shows. All of these work:

```
http://172.18.1.17:14005                    ← bare host and port
http://172.18.1.17:14005/v1                 ← already versioned
http://172.18.1.17:14005/v1/chat/completions ← the full endpoint
```

DHVANI tries `/v1` first, falls back to the bare root for gateways mounted there, and never produces
`/v1/v1`. The resolved URL is what gets saved.

### The API key is optional on a local gateway

A gateway on localhost or a private network (`10.x`, `172.16–31.x`, `192.168.x`, `*.local`) is used
with no `Authorization` header at all when you leave the key blank — local LiteLLM and vLLM
deployments commonly run without auth. A gateway on a public address still requires one.

### The model

Leave it blank and DHVANI picks the best chat model your gateway lists, preferring a current Gemini
model and filtering out embedding, speech and image models. Or type one — LiteLLM's provider-prefixed
names like `vertex_ai/gemini-3.1-pro-preview` are passed through verbatim. The setup screen shows
every model your gateway offers as a clickable list.

If your gateway does not implement `/models`, name the model yourself and it is validated by sending
one real completion instead.

### Which wire format?

| Setting | Request | Auth header | Use when |
| --- | --- | --- | --- |
| `openai` *(default)* | `POST {url}/chat/completions` | `Authorization: Bearer sk-…` | Your gateway is OpenAI-compatible. This covers almost all of them. |
| `gemini` | `POST {url}/models/<model>:generateContent` | `x-goog-api-key: …` | Your gateway is a thin proxy for Google's own API shape. |

A bearer token beginning `sk-` almost always means `openai`. The setup screen round-trips one small
prompt and reports the model and latency before saving, so a wrong guess is obvious immediately.

### What still needs a Google key

Transcription, translation, subtitles and the ElevenLabs dub all work through a gateway. Two
optional extras send **audio** to the model, which the OpenAI wire format cannot carry:

- **Audio expression detection** — falls back to a neutral tone
- **Gemini text-to-speech** — only relevant if you switch the voice engine away from ElevenLabs

Set `GEMINI_API_KEY` alongside the gateway if you want those, or use
`LLM_GATEWAY_PROTOCOL=gemini` if your proxy forwards multimodal requests. **Subtitle timing is
byte-identical either way** — it comes from ElevenLabs, never from the translator.

### The Detected panel

Both dialogs carry a **Detected** panel that reports each credential in one
vocabulary, so "it doesn't work" becomes something you can act on:

| Badge | Means |
| --- | --- |
| **Working** | Reachable, key accepted, the chosen model answered |
| **Key rejected** | The endpoint is there; the credential is not accepted |
| **Wrong URL** | Nothing serves that path — check the base URL |
| **Model missing** | Connected, but the endpoint does not serve that model |
| **Rate limited** | The key works, but is throttled right now |
| **Provider down** | The service answered 5xx |
| **Unverified** | No reply — service not running, or the wrong address |

The provider is identified the instant you paste a key, from its prefix alone
and with no network call (`AIza…` Google, `sk_…` ElevenLabs, `sk-ant-…`
Anthropic, `sk-…` OpenAI-compatible). Each row lists the models the endpoint
actually serves, and picking one writes it into the field — so **Model missing**
is one click from fixed.

### Reasoning models

A reasoning model (`gemini-2.5-pro`, `gemini-3-pro-preview`, the o-series) spends tokens on hidden
reasoning before it emits a single visible character. With too small an output budget it stops at
`finish_reason: "length"` having produced no text at all — which looks like a broken model when
nothing is wrong except the budget.

DHVANI sends `LLM_GATEWAY_MAX_TOKENS` (default 8192) on every gateway call for exactly this reason.
If a reasoning model still truncates, raise it.

### Keys scoped to a subset of models

A gateway key is often entitled to only some of the gateway's models. LiteLLM reports that as a 401
with `type: "key_model_access_denied"` — the same status as a bad key, though the fix is entirely
different.

DHVANI tells the two apart. A model restriction never aborts the run: it moves to the next model in
your list, and if you named only one, it switches to a model the key *is* allowed to use and says
so. A genuinely bad key still fails immediately.

### Changing it later

The first-run screen only appears once. To change keys or switch engines afterwards, open **Voice
Settings** in the header, expand **Advanced Settings**, and choose **API & Translation Engine**. The
form opens prefilled with what is currently running and re-validates as you edit.

That entry point is hidden when the backend will not accept a change — behind a reverse proxy, or
with `ALLOW_KEY_SETUP=false` — and explains that credentials come from the environment instead.

### Checking it works

```bash
curl -s http://localhost:8787/api/health | grep -o '"translation":{[^}]*}'
```

`"mode":"gateway"` means translation is going through your server.

---

## How the app is put together

The browser never holds an API key and never calls ElevenLabs or Gemini directly. It talks only to
the local backend, which holds the keys.

```
Browser (React + Vite, port 3000)
   │  fetch /api/...        ← no credentials in client code
   ▼
Local backend (Express, port 8787)
   ├── ElevenLabs  — transcription, word timestamps, TTS, speech-to-speech, voice cloning
   └── Translation — Google Gemini, or your own LLM gateway
                     (translation, script alignment, Indic polish, SSML)
```

In development, Vite proxies `/api` to the backend. In production, the backend serves the built
frontend, so it is all one origin.

### Project structure

```
server/                          Local backend — the only place API keys exist
  index.js                       Express app, static hosting, graceful shutdown
  env.js                         .env loading, config, key resolution
  errors.js                      ApiError + provider error translation
  logger.js
  lib/
    srt.js                       Cue building, SRT/VTT output, timing-integrity checks
    srt.test.js                  Tests for the timing guarantee
    pipeline.js                  The end-to-end workflow
    pipeline.test.js             Tests with stubbed providers
    http.js                      fetch with timeout, retry and backoff
    media.js                     Format detection, ffmpeg audio extraction, probing
    languages.js                 Display name ↔ ISO-639 ↔ BCP-47
    wav.js                       PCM → WAV container
  providers/
    index.js                     Provider registry — where you add a new backend
    elevenlabs/
      client.js                  Keyed REST client
      transcription.js           Scribe speech-to-text with word timestamps
      speech.js                  TTS, speech-to-speech, cloning, voices, models
    gemini/
      client.js                  SDK client with model cascade
      translation.js             Batched cue translation, alignment, Indic polish
      studio.js                  Expression detection, cue split, SSML, Gemini TTS
    llmGateway/
      client.js                  Self-hosted gateway (OpenAI or Gemini wire format)
      client.test.js             Tests against a stub gateway
    textModel.js                 Picks Google or the gateway for each text call
  routes/                        health, settings, pipeline, transcription,
                                 translation, elevenlabs, gemini
  middleware/                    upload (disk-backed), error handler, asyncHandler

services/                        Frontend service layer
  apiClient.ts                   The single backend gateway (JSON, upload, audio, NDJSON stream)
  subtitleService.ts             Pipeline client, cue ↔ segment conversion
  geminiService.ts               Translation + text features, via the backend
  elevenLabsService.ts           Voice features, via the backend
  srtService.ts                  Client-side SRT shaping, word-timestamp aware
  audioService.ts                Waveform analysis and decoding (browser-only)

components/                      React UI (unchanged 3-step workflow)
  SetupWizard.tsx                Credential setup: first run and Advanced Settings
  GatewayFields.tsx              Self-validating gateway URL / key / model fields
App.tsx                          Studio shell and state
types.ts                         Shared types, incl. WordTimestamp

desktop/main.cjs                 Electron shell: forks the backend, opens a window
Dockerfile, docker-compose.yml   Container build and run
electron-builder.yml             Desktop installer configuration
scripts/                         Icon generator, portable-zip packager
.github/workflows/               CI (typecheck, test, build, Docker) and release

docs/ARCHITECTURE.md             How timing integrity is enforced
docs/MIGRATION.md                What changed from the AI Studio build
SECURITY.md                      How your API keys are handled
CONTRIBUTING.md                  Development setup and the rules that govern changes
```

---

## The timing guarantee

This is the property the whole design protects, enforced in four independent places:

1. **Cues are cut on measured words.** `buildCuesFromWords` groups ElevenLabs words into cues. A
   cue's start is its first word's start; its end is its last word's end. Nothing is interpolated.
2. **Gemini never sees a timestamp.** Translation prompts contain `{ id, text }` pairs only. There
   is no timing in the request, so there is none in the response to go wrong.
3. **Translation is a text swap.** `retextCues` copies each cue and replaces one string field.
   `startTime`, `endTime` and the word list are carried over by reference.
4. **The result is verified.** `assertTimingsPreserved` compares the translated cue list against the
   source cue list and throws if any id or timestamp differs.

`npm test` covers all four, including a test that feeds the pipeline a deliberately hostile
translator which returns timecode-shaped text — the exported SRT is unaffected.

One place does re-time on purpose: subtitles for a **synthesized dub**. That dub is a new recording
with its own length, so the source timestamps cannot apply. Those captions are generated separately
and the original ElevenLabs timings stay untouched on the source track.

---

## Using it

1. **Pick the source language** (or leave it on *Auto Detect*) and the target language.
2. **Drop in an audio or video file.** Video is not modified — only its audio track is extracted and
   sent for transcription.
3. Transcription, SRT generation and translation run automatically, with the current stage shown
   live.
4. **Review and edit** the cues in step 2. Use the phonetic keyboard for Indic scripts.
5. **Export** from the SRT dialog: choose the translated or the original track, `.srt` or `.vtt`, and
   a formatting preset. The dialog marks the export "Exact ElevenLabs timings" when every cue edge
   is a measured word.
6. Optionally **synthesize the dub** with an ElevenLabs voice.

### If translation fails

Transcription is never discarded. If Gemini is rate-limited or errors out, the transcript, the word
timestamps and the original-language SRT are all kept, and a banner explains what happened. Changing
the target language or hitting re-translate retries translation alone — the audio is not re-sent and
the timestamps are reused.

---

## Configuration

Everything below is optional; `.env.example` documents each one.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ELEVENLABS_API_KEY` | — | **Required.** Transcription and voice. |
| `GEMINI_API_KEY` | — | Translation, unless you use a gateway instead. |
| `LLM_GATEWAY_URL` | — | Your own gateway's base URL. Replaces `GEMINI_API_KEY` when set with a key. |
| `LLM_GATEWAY_KEY` | — | Bearer token for that gateway. |
| `LLM_GATEWAY_PROTOCOL` | `openai` | `openai` or `gemini` wire format. |
| `LLM_GATEWAY_MODELS` | `gemini-2.5-flash` | Model names as your gateway exposes them, tried in order. |
| `PORT` | `8787` | Backend port. |
| `CLIENT_PORT` | `3000` | Vite dev server port. |
| `HOST` | `127.0.0.1` | Interface to bind. See [SECURITY.md](SECURITY.md) before changing. |
| `CORS_ORIGIN` | localhost:3000 | Extra allowed origins; the server's own is always allowed. |
| `RATE_LIMIT_PER_MINUTE` | `120` | Per-IP cap on `/api`. `0` disables it. |
| `ALLOW_KEY_SETUP` | `true` | Lets the in-app setup screen save keys. Loopback-only regardless. |
| `DHVANI_CONFIG_DIR` | OS config dir | Where keys saved from the UI are stored. |
| `ELEVENLABS_STT_MODEL` | `scribe_v1` | Speech-to-text model. |
| `ELEVENLABS_TTS_MODEL` | `eleven_multilingual_v2` | Default voice model. |
| `GEMINI_TRANSLATION_MODELS` | `gemini-2.5-flash,gemini-2.0-flash` | Tried in order. |
| `GEMINI_TTS_MODEL` | `gemini-2.5-flash-preview-tts` | Only for the Gemini TTS provider. |
| `MAX_UPLOAD_MB` | `1024` | Upload size limit. |
| `TRANSLATION_BATCH_SIZE` | `40` | Cues per Gemini request. |
| `EXTRACT_AUDIO_FROM_VIDEO` | `true` | Set `false` to upload video as-is. |

### Adding another provider

Providers are addressed by capability, not imported directly by the pipeline:

```js
// server/providers/index.js
registerProvider('transcription', 'whisper', {
  label: 'Local Whisper',
  providesWordTimestamps: true,
  isConfigured: () => true,
  transcribe: async (file, options) => ({ text, words, cues, languageName, ... }),
});

activeProviders.transcription = 'whisper';
```

No route or pipeline code changes. A transcription provider must return word-level timestamps to
preserve the timing guarantee.

---

## API reference

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Version, capabilities, which keys are configured, ffmpeg status |
| `GET` | `/api/settings` | Where each key came from — never the key itself |
| `POST` | `/api/settings/keys` | Validate and save keys (loopback only) |
| `POST` | `/api/settings/gateway/test` | Round-trip a candidate gateway without saving it |
| `DELETE` | `/api/settings/keys` | Forget the saved keys (loopback only) |
| `POST` | `/api/pipeline/subtitles` | Full workflow; streams NDJSON progress |
| `POST` | `/api/pipeline/retranslate` | Re-translate existing cues, no re-transcription |
| `POST` | `/api/transcription` | Transcription only → words, cues, SRT, VTT |
| `POST` | `/api/translation/segments` | Translate cue text by id |
| `POST` | `/api/translation/srt` | Translate a whole `.srt`, timestamps preserved |
| `POST` | `/api/translation/align` | Spread a pasted script across cues |
| `POST` | `/api/translation/polish` | Indic matra/conjunct repair |
| `GET` | `/api/elevenlabs/user` | Validate key, read subscription |
| `GET` | `/api/elevenlabs/voices` · `/models` | Voice and model catalogs |
| `POST` | `/api/elevenlabs/tts` | Text to speech |
| `POST` | `/api/elevenlabs/speech-to-speech` | Voice conversion |
| `POST` | `/api/elevenlabs/voices/add` | Instant voice clone |
| `POST` | `/api/gemini/expression` · `/split` · `/ssml` · `/validate-ssml` · `/tts` | Studio features |

Errors come back as `{ "error": { message, code, provider, retryable, details } }`.

`x-elevenlabs-key` and `x-gemini-key` headers are accepted as an optional per-request override for
trying a personal key from the UI. A configured key always takes precedence.

---

## Troubleshooting

**"The local DHVANI backend is not running."**
Start it with `npm run dev`. Check whether something else holds port 8787 and change `PORT` if so.
In the desktop app, use Help → Open Engine Log to see why the engine stopped.

**"ElevenLabs API key is not configured."**
Open **API Settings** in the header and paste your key there — it saves immediately, no restart. If
you prefer a file, `.env` belongs next to `package.json`, and the server must be restarted after you
edit it.

**A key or endpoint from `.env` is not the one I entered.**
It should be: saved settings win. If a field still shows "from .env", nothing has been saved over it
yet — enter your value and save. To go back the other way, use **Reset to defaults** in the
endpoint group, which drops the saved value and falls back to `.env`.

**The setup screen never appears.**
It only shows when the backend can save keys. It is hidden behind a reverse proxy, when
`ALLOW_KEY_SETUP=false`, or once you have dismissed it — clear the site data to bring it back. Use
environment variables in those cases.

**"Too many requests to the local DHVANI backend in one minute."**
Something is retrying in a loop. Reload the page; raise `RATE_LIMIT_PER_MINUTE` if you legitimately
need a higher ceiling.

**"ElevenLabs returned an empty transcription."**
The file has no intelligible speech, or the chosen source language does not match the audio. Try
*Auto Detect*.

**Video uploads are slow.**
ffmpeg is probably missing, so the whole video is being uploaded. Run `npm install` to get
`ffmpeg-static`, or install ffmpeg and put it on your `PATH`. The banner tells you which state
you are in.

**Rate limits during translation.**
Lower `TRANSLATION_BATCH_SIZE`, or add a second model to `GEMINI_TRANSLATION_MODELS` (or
`LLM_GATEWAY_MODELS`). Batches that already succeeded are kept.

**"The gateway returned no message content for model X."**
That model name does not exist on your gateway. List what it actually exposes with
`curl -H "Authorization: Bearer $LLM_GATEWAY_KEY" $LLM_GATEWAY_URL/models`, then set
`LLM_GATEWAY_MODELS` to a name from that list.

**"This feature sends audio to the model, which an OpenAI-compatible gateway cannot carry."**
Expected — see [What still needs a Google key](#what-still-needs-a-google-key). Transcription,
translation and subtitles are unaffected.

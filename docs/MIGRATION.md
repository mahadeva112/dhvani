# Migration: Google AI Studio → standalone local app

What changed when DHVANI was converted from a Google AI Studio app into a self-hosted one, and why.

---

## 1. What tied the app to AI Studio

| Dependency | Where | Replacement |
| --- | --- | --- |
| `aistudiocdn.com` import map for React and `@google/genai` | `index.html` | Removed. Vite bundles these from `node_modules`. |
| `process.env.API_KEY` / `process.env.GEMINI_API_KEY` compiled into the bundle | `vite.config.ts` `define` block | Removed. Keys live in the backend's `.env` only. |
| `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` platform manifest | `metadata.json` | File deleted. |
| Gemini SDK running in the browser with a live key | `services/geminiService.ts` | SDK moved to `server/providers/gemini/`. |
| ElevenLabs called from the browser with a key pasted into `localStorage` | `services/elevenLabsService.ts` | Proxied through `server/routes/elevenlabs.js`. |
| AI Studio project link and setup steps | `README.md` | Rewritten for local setup. |

After the change, the browser bundle contains no provider SDK and no credential.

## 2. The workflow change

The original app asked Gemini to listen to the audio and return a transcript **with timestamps it
estimated**. Those estimates drifted, and every re-run produced different timings.

The workflow is now:

```
before:  audio ──────────── Gemini (transcribe + estimate timing + translate) ── SRT

after:   audio ── ElevenLabs Scribe (transcribe + MEASURED word timestamps) ── original SRT
                                          │ timestamps held fixed
                                          ▼
                             Gemini (translate text only) ── translated SRT
```

Gemini no longer receives audio for transcription and never sees a timestamp during translation.

## 3. Files created

**Backend** (all new — `server/`)

| File | Purpose |
| --- | --- |
| `index.js` | Express app, CORS, static hosting, shutdown handling |
| `env.js` | `.env` loading, typed config, key resolution |
| `errors.js` | `ApiError` and provider-status → message translation |
| `logger.js` | Timestamped console logging |
| `lib/srt.js` | Cue building from word timestamps, SRT/VTT, integrity checks |
| `lib/srt.test.js` | Tests for the timing guarantee |
| `lib/pipeline.js` | The end-to-end workflow |
| `lib/pipeline.test.js` | Pipeline tests with stubbed providers |
| `lib/http.js` | `fetch` with timeout, retry, backoff |
| `lib/media.js` | Format detection, ffmpeg extraction, duration probe |
| `lib/languages.js` | Display name ↔ ISO-639 ↔ BCP-47 |
| `lib/wav.js` | PCM → WAV container |
| `providers/index.js` | Capability-based provider registry |
| `providers/elevenlabs/client.js` | Keyed REST client |
| `providers/elevenlabs/transcription.js` | Scribe speech-to-text |
| `providers/elevenlabs/speech.js` | TTS, STS, cloning, catalogs |
| `providers/gemini/client.js` | SDK client with model cascade |
| `providers/gemini/translation.js` | Batched translation, alignment, polish |
| `providers/gemini/studio.js` | Expression, cue split, SSML, Gemini TTS |
| `routes/*.js` | health, pipeline, transcription, translation, elevenlabs, gemini |
| `middleware/*.js` | Disk-backed upload, error handler, async wrapper |

**Frontend**

| File | Purpose |
| --- | --- |
| `services/apiClient.ts` | The single gateway to the backend, incl. NDJSON streaming |
| `services/subtitleService.ts` | Pipeline client and cue ↔ segment conversion |

**Config and docs**

`.env.example`, `docs/ARCHITECTURE.md`, `docs/MIGRATION.md`, `.claude/launch.json`

## 4. Files modified

| File | Change |
| --- | --- |
| `package.json` | Added express, multer, cors, dotenv, concurrently, optional ffmpeg-static. New `dev` / `server` / `start` / `test` / `typecheck` scripts. |
| `vite.config.ts` | Dropped the key-injecting `define` block; added an `/api` proxy with no timeout. |
| `index.html` | Removed the `aistudiocdn.com` import map; updated the description. |
| `.gitignore` | Added `.env`, `dist`, upload scratch directories. |
| `README.md` | Rewritten for local install, architecture, API and troubleshooting. |
| `types.ts` | Added `WordTimestamp`; `AudioSegment.words` / `timingSource`; `BatchJob.sourceLanguage` / `detectedLanguage` / `originalSrt` / `translatedSrt` / `translationWarning`; `ProcessingStatus.READY`; legacy text aliases. |
| `services/geminiService.ts` | Rewritten. No SDK, no key; translation and text features go through the backend. `transcribeMedia` now drives the ElevenLabs → Gemini pipeline. |
| `services/elevenLabsService.ts` | Rewritten to call the backend. Public signatures unchanged, so no call site had to move. |
| `services/srtService.ts` | Cue splitting now snaps to ElevenLabs word timestamps when available; added `resegmentByWordTimestamps`. |
| `App.tsx` | Source-language state, backend health probe, live pipeline status, setup and warning banners, timestamp-safe retranslation. |
| `components/ExpressDubWizard.tsx` | Source-language selector, live stage indicator, video-aware upload copy. |
| `components/SrtExportModal.tsx` | Translated/original track toggle, exact-timing indicator, track-aware filenames. |
| `components/VoiceSelectorCard.tsx` | Server-managed key handling; fixed a pre-existing `filtered` reference bug. |
| `components/VoiceSettingsModal.tsx` | Server-managed key handling. |

## 5. Files deleted

| File | Why |
| --- | --- |
| `metadata.json` | AI Studio app manifest — no meaning outside the platform. |

## 6. Behaviour that changed for the user

| Area | Before | After |
| --- | --- | --- |
| Subtitle timing | Estimated by a language model; drifted between runs | Measured by ElevenLabs; identical every run |
| API keys | Gemini key compiled into the bundle; ElevenLabs key pasted into `localStorage` | Both in the backend's `.env`; never sent to the browser |
| Source language | Prompt-limited to English/Tamil | Any Scribe-supported language, or auto-detect |
| Video input | Whole file sent to the model | Audio track extracted first; original file untouched |
| Progress | One indeterminate spinner | Live per-stage messages over a streamed response |
| Failed translation | Whole run lost | Transcript, timestamps and original SRT kept; translation retryable alone |
| Long files | Single oversized request | Translation batched, merged by cue id, order preserved |
| SRT export | Translated track only | Translated or original track, with an exact-timing indicator |

## 7. What deliberately stayed the same

The three-step wizard, the review layouts, waveform players, batch queue, phonetic Indic keyboard,
translation prompt presets, voice changer, voice cloning, SRT presets and the theme system are all
unchanged. The service-layer signatures were kept stable specifically so the UI components did not
need rewriting.

## 8. Pre-existing bugs fixed along the way

`npm run typecheck` did not exist before, so these had never surfaced:

- `components/VoiceSelectorCard.tsx` referenced an undeclared `filtered` variable in the voice
  filter — the voice list would throw a `ReferenceError` at runtime.
- `ProcessingStatus.READY` was used in `App.tsx` but missing from the enum, so those jobs were set to
  `undefined`.
- `AudioSegment` lacked the `originalText` / `targetText` / `text` aliases that several components
  read and write.
- `server/lib/srt.js` `parseSrt` accumulated float error when converting timecodes, which was caught
  by the round-trip test and fixed by summing in integer milliseconds.
